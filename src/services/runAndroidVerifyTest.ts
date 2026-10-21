import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { androidRuntimeManager } from './AndroidRuntimeManager';
import { androidPackageService } from './AndroidPackageService';

interface TestCaseResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAutomatedTests() {
  console.log('================================================================');
  console.log('ARCLIGHT FIX 09 — AUTOMATED UNIT & INTEGRATION TEST SUITE');
  console.log('(Note: Mocked scenarios test adapter/verifier logic in isolation;');
  console.log(' real runtime status is evaluated separately without mocks)');
  console.log('================================================================');

  const results: TestCaseResult[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclight-fix09-tests-'));
  const remoteAdapter = androidRuntimeManager.getRemoteAdapter();
  const originalConfig = remoteAdapter.getConfig();

  const recordTest = async (id: string, name: string, fn: () => Promise<string>) => {
    try {
      const details = await fn();
      results.push({ id, name, passed: true, details });
      console.log(`[PASS] ${id}: ${name} -> ${details}`);
    } catch (err: any) {
      results.push({ id, name, passed: false, details: err.message });
      console.error(`[FAIL] ${id}: ${name} -> ${err.message}`);
    }
  };

  // Ensure valid TestAPK exists for tests
  const validApkPath = path.resolve(process.cwd(), 'public', 'com.example.testapk.apk');
  const validApkBuf = fs.readFileSync(validApkPath);
  const validApkSha256 = crypto.createHash('sha256').update(validApkBuf).digest('hex');

  // -------------------------------------------------------------------------
  // 1. Unsupported Host & Missing Local Runtime
  // -------------------------------------------------------------------------
  await recordTest('T01_MISSING_RUNTIME_AND_UNSUPPORTED_HOST', 'Detect unsupported gVisor host and missing local runtime without repeating Waydroid init', async () => {
    remoteAdapter.clearConfig();
    const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
    assertCondition(
      report.hostChecks.localExecutionSupport.status === 'UNSUPPORTED' &&
      report.hostChecks.localExecutionSupport.code === 'LOCAL_RUNTIME_UNSUPPORTED',
      `Expected LOCAL_RUNTIME_UNSUPPORTED on gVisor, got ${report.hostChecks.localExecutionSupport.status}/${report.hostChecks.localExecutionSupport.code}`
    );
    assertCondition(
      report.connectionChecks.runtimeProfile.status === 'BLOCKED' &&
      report.connectionChecks.runtimeProfile.code === 'REMOTE_HOST_NOT_CONFIGURED',
      `Expected REMOTE_HOST_NOT_CONFIGURED when unconfigured, got ${report.connectionChecks.runtimeProfile.status}/${report.connectionChecks.runtimeProfile.code}`
    );
    assertCondition(report.overallStatus === 'BLOCKED', `Expected overallStatus=BLOCKED, got ${report.overallStatus}`);
    return `Host=${report.hostChecks.localExecutionSupport.code}, Profile=${report.connectionChecks.runtimeProfile.code}, Overall=${report.overallStatus}`;
  });

  // -------------------------------------------------------------------------
  // 2. Remote Host Unavailable (REMOTE_HOST_DISCONNECTED)
  // -------------------------------------------------------------------------
  await recordTest('T02_REMOTE_HOST_UNAVAILABLE', 'Report REMOTE_HOST_DISCONNECTED when configured remote host agent is unreachable', async () => {
    remoteAdapter.saveConfig({
      mode: 'REST_TLS',
      host: '127.0.0.1',
      port: 59991,
      endpointUrl: 'http://127.0.0.1:59991',
      token: 'test-token',
      tlsEnabled: false
    });
    const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
    assertCondition(
      report.connectionChecks.hostAgentConnection.status === 'FAIL' &&
      report.connectionChecks.hostAgentConnection.code === 'REMOTE_HOST_DISCONNECTED',
      `Expected FAIL / REMOTE_HOST_DISCONNECTED, got ${report.connectionChecks.hostAgentConnection.status}/${report.connectionChecks.hostAgentConnection.code}`
    );
    assertCondition(
      report.installationChecks.packageManagerInstall.status === 'BLOCKED',
      `Expected installation to be BLOCKED when disconnected, got ${report.installationChecks.packageManagerInstall.status}`
    );
    return `Connection=${report.connectionChecks.hostAgentConnection.code}, FirstStage=${report.firstFailingStage}`;
  });

  // -------------------------------------------------------------------------
  // Start a controllable local test HTTP server implementing the exact
  // ArclightAndroidHostAgent / RemoteAndroidAdapter protocol (/api/android/remote/*)
  // -------------------------------------------------------------------------
  let mockBehavior = {
    requireToken: 'valid-secret-token',
    runtimeReady: true,
    androidVersion: '14',
    abi: 'x86_64',
    pmReady: true,
    dropTransfer: false,
    corruptHash: false,
    installSuccess: true,
    installError: '',
    verifyPackageSuccess: true,
    listedPackages: ['com.android.settings'] as string[],
    launchSuccess: true,
    processRunning: true,
    pid: 4210,
    returnFrame: true,
    inputSuccess: true
  };

  const mockServer = http.createServer((req, res) => {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${mockBehavior.requireToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AUTHENTICATION_FAILED: Invalid pairing token' }));
      return;
    }

    const url = req.url || '';

    if (url.startsWith('/api/android/remote/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready: mockBehavior.runtimeReady,
        state: mockBehavior.runtimeReady ? 'ANDROID_READY' : 'HOST_RUNTIME_UNAVAILABLE',
        androidVersion: mockBehavior.androidVersion,
        architecture: mockBehavior.abi,
        packageManagerReady: mockBehavior.pmReady,
        packagesCount: mockBehavior.listedPackages.length,
        error: mockBehavior.runtimeReady ? undefined : 'HOST_RUNTIME_UNAVAILABLE: Waydroid container stopped'
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ androidVersion: mockBehavior.androidVersion, version: mockBehavior.androidVersion }));
      return;
    }

    if (url.startsWith('/api/android/remote/arch')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ architecture: mockBehavior.abi, abi: mockBehavior.abi }));
      return;
    }

    if (url === '/api/android/remote/packages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        packageManagerReady: mockBehavior.pmReady,
        packages: mockBehavior.listedPackages
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/transfer') && req.method === 'POST') {
      if (mockBehavior.dropTransfer) {
        req.socket.destroy();
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        if (mockBehavior.corruptHash) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            error: `HASH_MISMATCH: local=${parsed.sha256}, remote=0000`
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          sha256: parsed.sha256,
          verified: true,
          sizeBytes: parsed.sizeBytes
        }));
      });
      return;
    }

    if (url.startsWith('/api/android/remote/packages/install') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        if (!mockBehavior.installSuccess) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            errorCode: 'INSTALL_FAILED',
            error: mockBehavior.installError || 'INSTALL_FAILED: pm install rejected package'
          }));
          return;
        }
        if (mockBehavior.verifyPackageSuccess && !mockBehavior.listedPackages.includes('com.example.testapk')) {
          mockBehavior.listedPackages.push('com.example.testapk');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          packageName: 'com.example.testapk',
          sha256: validApkSha256,
          message: 'Successfully installed com.example.testapk'
        }));
      });
      return;
    }

    if (url.startsWith('/api/android/remote/packages/verify/')) {
      const pkg = decodeURIComponent(url.split('/').pop() || '');
      const isInstalled = mockBehavior.verifyPackageSuccess && mockBehavior.listedPackages.includes(pkg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        packageName: pkg,
        installed: isInstalled,
        verified: isInstalled
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/packages/launch') && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: mockBehavior.launchSuccess,
        pid: mockBehavior.processRunning ? mockBehavior.pid : undefined,
        message: mockBehavior.launchSuccess ? 'Launched com.example.testapk' : 'APP_LAUNCH_FAILED: Activity failed to start'
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/process/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: mockBehavior.processRunning,
        pid: mockBehavior.processRunning ? mockBehavior.pid : undefined
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/packages/uninstall') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        mockBehavior.listedPackages = mockBehavior.listedPackages.filter(p => p !== parsed.packageName);
        mockBehavior.processRunning = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Uninstalled' }));
      });
      return;
    }

    if (url.startsWith('/api/android/remote/frame')) {
      if (mockBehavior.returnFrame) {
        const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          format: 'png',
          width: 720,
          height: 1280,
          dataBase64: pngHeader.toString('base64')
        }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'DISPLAY_STREAM_UNAVAILABLE' }));
      }
      return;
    }

    if (url.startsWith('/api/android/remote/input') && req.method === 'POST') {
      if (mockBehavior.inputSuccess) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Input bridge failed' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (mockServer.address() as any).port;

  try {
    // -------------------------------------------------------------------------
    // 3. Authentication Failure
    // -------------------------------------------------------------------------
    await recordTest('T03_AUTHENTICATION_FAILURE', 'Reject invalid token with AUTHENTICATION_FAILED', async () => {
      remoteAdapter.saveConfig({
        mode: 'REST_TLS',
        host: '127.0.0.1',
        port: mockPort,
        endpointUrl: `http://127.0.0.1:${mockPort}`,
        token: 'wrong-token',
        tlsEnabled: false
      });
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      assertCondition(
        report.connectionChecks.authenticationAndIdentity.status === 'FAIL' &&
        report.connectionChecks.authenticationAndIdentity.code === 'AUTHENTICATION_FAILED',
        `Expected AUTHENTICATION_FAILED, got ${report.connectionChecks.authenticationAndIdentity.status}/${report.connectionChecks.authenticationAndIdentity.code}`
      );
      return `AuthStatus=${report.connectionChecks.authenticationAndIdentity.code}`;
    });

    // Configure valid token for subsequent tests
    remoteAdapter.saveConfig({
      mode: 'REST_TLS',
      host: '127.0.0.1',
      port: mockPort,
      endpointUrl: `http://127.0.0.1:${mockPort}`,
      token: 'valid-secret-token',
      tlsEnabled: false
    });

    // -------------------------------------------------------------------------
    // 4. Invalid APK
    // -------------------------------------------------------------------------
    await recordTest('T04_INVALID_APK', 'Reject corrupt/non-ZIP APK with APK_INVALID before transfer', async () => {
      const corruptApk = path.join(tempDir, 'corrupt.apk');
      fs.writeFileSync(corruptApk, 'NOT_A_ZIP_OR_APK_ARCHIVE_CONTENT');
      const report = await androidRuntimeManager.runFullEndToEndVerification(corruptApk);
      assertCondition(
        report.installationChecks.apkIntegrityAndMetadata.status === 'FAIL' &&
        report.installationChecks.apkIntegrityAndMetadata.code === 'APK_INVALID',
        `Expected APK_INVALID, got ${report.installationChecks.apkIntegrityAndMetadata.status}/${report.installationChecks.apkIntegrityAndMetadata.code}`
      );
      assertCondition(
        report.installationChecks.secureTransferAndHash.status === 'BLOCKED',
        `Expected transfer to be BLOCKED on invalid APK`
      );
      return `ApkCheck=${report.installationChecks.apkIntegrityAndMetadata.code}`;
    });

    // -------------------------------------------------------------------------
    // 5. Transfer Interruption
    // -------------------------------------------------------------------------
    await recordTest('T05_TRANSFER_INTERRUPTION', 'Detect socket drop during APK transfer as TRANSFER_INTERRUPTED', async () => {
      mockBehavior.dropTransfer = true;
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.dropTransfer = false;
      assertCondition(
        report.installationChecks.secureTransferAndHash.status === 'FAIL' &&
        report.installationChecks.secureTransferAndHash.code === 'TRANSFER_INTERRUPTED',
        `Expected TRANSFER_INTERRUPTED, got ${report.installationChecks.secureTransferAndHash.status}/${report.installationChecks.secureTransferAndHash.code}`
      );
      return `TransferCheck=${report.installationChecks.secureTransferAndHash.code}`;
    });

    // -------------------------------------------------------------------------
    // 6. Hash Mismatch
    // -------------------------------------------------------------------------
    await recordTest('T06_HASH_MISMATCH', 'Detect SHA-256 mismatch on remote transfer as HASH_MISMATCH', async () => {
      mockBehavior.corruptHash = true;
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.corruptHash = false;
      assertCondition(
        report.installationChecks.secureTransferAndHash.status === 'FAIL' &&
        report.installationChecks.secureTransferAndHash.code === 'HASH_MISMATCH',
        `Expected HASH_MISMATCH, got ${report.installationChecks.secureTransferAndHash.status}/${report.installationChecks.secureTransferAndHash.code}`
      );
      return `HashCheck=${report.installationChecks.secureTransferAndHash.code}`;
    });

    // -------------------------------------------------------------------------
    // 7. Installation Failure
    // -------------------------------------------------------------------------
    await recordTest('T07_INSTALLATION_FAILURE', 'Report INSTALL_FAILED when Android package manager rejects install', async () => {
      mockBehavior.installSuccess = false;
      mockBehavior.installError = 'INSTALL_FAILED_INSUFFICIENT_STORAGE';
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.installSuccess = true;
      mockBehavior.installError = '';
      assertCondition(
        report.installationChecks.packageManagerInstall.status === 'FAIL' &&
        report.installationChecks.packageManagerInstall.code === 'INSTALL_FAILED',
        `Expected INSTALL_FAILED, got ${report.installationChecks.packageManagerInstall.status}/${report.installationChecks.packageManagerInstall.code}`
      );
      return `InstallCheck=${report.installationChecks.packageManagerInstall.code}`;
    });

    // -------------------------------------------------------------------------
    // 8. Package Verification Failure
    // -------------------------------------------------------------------------
    await recordTest('T08_PACKAGE_VERIFICATION_FAILURE', 'Report PACKAGE_VERIFICATION_FAILED if pm list packages omits installed package', async () => {
      mockBehavior.listedPackages = ['com.android.settings'];
      mockBehavior.verifyPackageSuccess = false;
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.verifyPackageSuccess = true;
      assertCondition(
        report.installationChecks.independentPackageQuery.status === 'FAIL' &&
        report.installationChecks.independentPackageQuery.code === 'PACKAGE_VERIFICATION_FAILED',
        `Expected PACKAGE_VERIFICATION_FAILED, got ${report.installationChecks.independentPackageQuery.status}/${report.installationChecks.independentPackageQuery.code}`
      );
      return `VerifyCheck=${report.installationChecks.independentPackageQuery.code}`;
    });

    // -------------------------------------------------------------------------
    // 9. Launch Failure
    // -------------------------------------------------------------------------
    await recordTest('T09_LAUNCH_FAILURE', 'Report APP_LAUNCH_FAILED when activity fails to start or process is not running', async () => {
      mockBehavior.listedPackages = ['com.android.settings'];
      mockBehavior.launchSuccess = false;
      mockBehavior.processRunning = false;
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.launchSuccess = true;
      mockBehavior.processRunning = true;
      assertCondition(
        report.launchChecks.appLaunch.status === 'FAIL' &&
        report.launchChecks.appLaunch.code === 'APP_LAUNCH_FAILED',
        `Expected APP_LAUNCH_FAILED, got ${report.launchChecks.appLaunch.status}/${report.launchChecks.appLaunch.code}`
      );
      return `LaunchCheck=${report.launchChecks.appLaunch.code}`;
    });

    // -------------------------------------------------------------------------
    // 10. Display Failure
    // -------------------------------------------------------------------------
    await recordTest('T10_DISPLAY_FAILURE', 'Report DISPLAY_STREAM_UNAVAILABLE separately when frame capture returns empty', async () => {
      mockBehavior.returnFrame = false;
      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      mockBehavior.returnFrame = true;
      assertCondition(
        report.launchChecks.appLaunch.status === 'PASS' &&
        report.launchChecks.processAndActivityState.status === 'PASS' &&
        report.launchChecks.displayStream.status === 'FAIL' &&
        report.launchChecks.displayStream.code === 'DISPLAY_STREAM_UNAVAILABLE',
        `Expected DISPLAY_STREAM_UNAVAILABLE with PASS launch, got display=${report.launchChecks.displayStream.status}/${report.launchChecks.displayStream.code}`
      );
      return `Launch=PASS, Display=${report.launchChecks.displayStream.code}`;
    });

    // -------------------------------------------------------------------------
    // 11. Successful Installation, Launch, Display, Input & Registry Reconciliation
    // -------------------------------------------------------------------------
    await recordTest('T11_SUCCESSFUL_INSTALL_AND_LAUNCH', 'Complete E2E pass across Connect -> Install -> Verify -> Launch -> Reconcile', async () => {
      mockBehavior.listedPackages = ['com.android.settings'];
      mockBehavior.launchSuccess = true;
      mockBehavior.processRunning = true;
      mockBehavior.returnFrame = true;
      mockBehavior.inputSuccess = true;

      const report = await androidRuntimeManager.runFullEndToEndVerification(validApkPath);
      assertCondition(report.overallStatus === 'PASS', `Expected overallStatus=PASS, got ${report.overallStatus} (${report.rootCause})`);
      assertCondition(report.exitCode === 0, `Expected exitCode=0, got ${report.exitCode}`);

      await androidPackageService.syncVerifiedPackageState({
        packageName: 'com.example.testapk',
        applicationName: 'Arclight Test APK',
        versionName: '1.0.0',
        versionCode: 1,
        launchableActivity: 'com.example.testapk/.MainActivity',
        apkPath: validApkPath,
        sizeBytes: validApkBuf.length,
        sha256: validApkSha256,
        packageInstalled: true,
        processRunning: true,
        activityLaunched: true,
        displayAvailable: true
      });

      const reconciled = await androidPackageService.reconcileRegistry();
      const testApp = reconciled.find((a: any) => a.packageName === 'com.example.testapk');
      assertCondition(!!testApp, 'Expected com.example.testapk in reconciled PackageRegistry');
      assertCondition(
        testApp.packageInstalled === true && testApp.processRunning === true && testApp.activityLaunched === true && testApp.displayAvailable === true,
        'Expected separate verified states (packageInstalled, processRunning, activityLaunched, displayAvailable) to be true'
      );
      return `Overall=PASS, SHA256=${validApkSha256.slice(0, 12)}..., ReconciledRegistry=${reconciled.length}`;
    });

    // -------------------------------------------------------------------------
    // 12. Uninstall & Verified Removal
    // -------------------------------------------------------------------------
    await recordTest('T12_UNINSTALL_AND_VERIFIED_REMOVAL', 'Uninstall package from runtime and verify removal from PackageRegistry', async () => {
      const uninst = await androidPackageService.uninstallApk('com.example.testapk');
      assertCondition(uninst.success && uninst.verifiedAbsent, `Expected uninstall verifiedAbsent=true, got ${JSON.stringify(uninst)}`);
      const reconciled = await androidPackageService.reconcileRegistry();
      const stillPresent = reconciled.some((a: any) => a.packageName === 'com.example.testapk');
      assertCondition(!stillPresent, 'Expected com.example.testapk to be removed from PackageRegistry after uninstall');
      return `Uninstalled=true, VerifiedAbsent=${uninst.verifiedAbsent}, RegistryCleaned=true`;
    });
  } finally {
    mockServer.close();
    // Restore original configuration (or clear config if no real external host was connected) and reconcile registry
    if (originalConfig.connectedAt) {
      remoteAdapter.saveConfig(originalConfig);
    } else {
      remoteAdapter.clearConfig();
    }
    await androidPackageService.reconcileRegistry();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('----------------------------------------------------------------');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`UNIT & INTEGRATION TESTS SUMMARY: ${passedCount}/${results.length} PASSED`);
  console.log('================================================================');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runAutomatedTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
