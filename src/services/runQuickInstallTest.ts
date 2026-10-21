import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { androidRuntimeManager } from './AndroidRuntimeManager';
import { androidPackageService } from './AndroidPackageService';
import { formatQuickInstallReport } from './androidCli';
import { ProcessExecutor } from './ProcessExecutor';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('ARCLIGHT SPEEDMAX 02 — QUICK-INSTALL AUTOMATED TEST SUITE');
  console.log('================================================================');

  const results: TestResult[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-install-test-'));
  const remoteAdapter = androidRuntimeManager.getRemoteAdapter();
  const originalConfig = remoteAdapter.getConfig();

  const record = async (id: string, name: string, fn: () => Promise<string>) => {
    try {
      const details = await fn();
      results.push({ id, name, passed: true, details });
      console.log(`[PASS] ${id}: ${name} -> ${details}`);
    } catch (err: any) {
      results.push({ id, name, passed: false, details: err.message });
      console.error(`[FAIL] ${id}: ${name} -> ${err.message}`);
    }
  };

  const validApkPath = path.resolve(process.cwd(), 'public', 'com.example.testapk.apk');
  const validApkBuf = fs.readFileSync(validApkPath);
  const validApkSha256 = crypto.createHash('sha256').update(validApkBuf).digest('hex');

  // -------------------------------------------------------------------------
  // 1. APK_NOT_FOUND
  // -------------------------------------------------------------------------
  await record('T01_APK_NOT_FOUND', 'Return FAIL with APK_NOT_FOUND when file does not exist', async () => {
    const report = await androidRuntimeManager.runQuickInstall('/tmp/non-existent-apk-file.apk');
    assert(report.result === 'FAIL', `Expected result=FAIL, got ${report.result}`);
    assert(report.exitCode === 1, `Expected exitCode=1, got ${report.exitCode}`);
    assert(report.blockerCode === 'APK_NOT_FOUND', `Expected blockerCode=APK_NOT_FOUND, got ${report.blockerCode}`);
    assert(report.stages.APK_VALIDATED.status === 'FAIL', `Expected APK_VALIDATED=FAIL`);
    assert(report.stages.TARGET_FOUND.status === 'BLOCKED', `Expected TARGET_FOUND=BLOCKED`);
    return `Result=${report.result}, Blocker=${report.blockerCode}`;
  });

  // -------------------------------------------------------------------------
  // 2. APK_INVALID
  // -------------------------------------------------------------------------
  await record('T02_APK_INVALID', 'Return FAIL with APK_INVALID when file lacks PK zip header', async () => {
    const corruptPath = path.join(tempDir, 'corrupt.apk');
    fs.writeFileSync(corruptPath, 'INVALID_APK_FILE_CONTENT_NO_ZIP_HEADER');
    const report = await androidRuntimeManager.runQuickInstall(corruptPath);
    assert(report.result === 'FAIL', `Expected result=FAIL, got ${report.result}`);
    assert(report.exitCode === 1, `Expected exitCode=1, got ${report.exitCode}`);
    assert(report.blockerCode === 'APK_INVALID', `Expected blockerCode=APK_INVALID, got ${report.blockerCode}`);
    assert(report.stages.APK_VALIDATED.status === 'FAIL', `Expected APK_VALIDATED=FAIL`);
    assert(report.stages.TARGET_FOUND.status === 'BLOCKED', `Expected TARGET_FOUND=BLOCKED`);
    return `Result=${report.result}, Blocker=${report.blockerCode}`;
  });

  // -------------------------------------------------------------------------
  // 3. NO_ANDROID_TARGET
  // -------------------------------------------------------------------------
  await record('T03_NO_ANDROID_TARGET', 'Return BLOCKED with NO_ANDROID_TARGET when 0 ADB devices and no host configured', async () => {
    remoteAdapter.clearConfig();
    const report = await androidRuntimeManager.runQuickInstall(validApkPath);
    assert(report.result === 'BLOCKED', `Expected result=BLOCKED, got ${report.result}`);
    assert(report.exitCode === 2, `Expected exitCode=2, got ${report.exitCode}`);
    assert(report.blockerCode === 'NO_ANDROID_TARGET', `Expected blockerCode=NO_ANDROID_TARGET, got ${report.blockerCode}`);
    assert(report.stages.APK_VALIDATED.status === 'PASS', `Expected APK_VALIDATED=PASS`);
    assert(report.stages.TARGET_FOUND.status === 'BLOCKED', `Expected TARGET_FOUND=BLOCKED`);
    assert(report.stages.ANDROID_READY.status === 'BLOCKED', `Expected ANDROID_READY=BLOCKED`);
    assert(!!report.recoveryAction, `Expected recoveryAction to be populated`);
    return `Result=${report.result}, Blocker=${report.blockerCode}`;
  });

  // -------------------------------------------------------------------------
  // 4. MULTIPLE_ANDROID_TARGETS
  // -------------------------------------------------------------------------
  await record('T04_MULTIPLE_ANDROID_TARGETS', 'Return BLOCKED with MULTIPLE_ANDROID_TARGETS when 2+ devices without target flag', async () => {
    const origExec = ProcessExecutor.execute;
    const origResolve = ProcessExecutor.resolveExecutable;
    ProcessExecutor.resolveExecutable = async (name: string) => {
      if (name === 'adb') return '/usr/bin/adb';
      return origResolve.call(ProcessExecutor, name);
    };

    ProcessExecutor.execute = async (req) => {
      if (req.args && req.args[0] === 'devices') {
        return {
          executable: 'adb',
          arguments: ['devices'],
          cwd: '',
          environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' },
          exitCode: 0,
          stdout: 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n',
          stderr: '',
          signal: null,
          timedOut: false,
          durationMs: 5
        };
      }
      return origExec.call(ProcessExecutor, req);
    };

    try {
      const report = await androidRuntimeManager.runQuickInstall(validApkPath);
      assert(report.result === 'BLOCKED', `Expected result=BLOCKED, got ${report.result}`);
      assert(report.exitCode === 2, `Expected exitCode=2, got ${report.exitCode}`);
      assert(report.blockerCode === 'MULTIPLE_ANDROID_TARGETS', `Expected blockerCode=MULTIPLE_ANDROID_TARGETS, got ${report.blockerCode}`);
      assert(report.stages.TARGET_FOUND.status === 'BLOCKED', `Expected TARGET_FOUND=BLOCKED`);
      assert(report.rootCause.includes('emulator-5554'), 'Expected rootCause to mention devices');
      return `Result=${report.result}, Blocker=${report.blockerCode}`;
    } finally {
      ProcessExecutor.execute = origExec;
      ProcessExecutor.resolveExecutable = origResolve;
    }
  });

  // -------------------------------------------------------------------------
  // 5. TARGET_SELECTED_EXPLICIT
  // -------------------------------------------------------------------------
  await record('T05_TARGET_SELECTED_EXPLICIT', 'Explicit --target selects device among multiple', async () => {
    const origExec = ProcessExecutor.execute;
    const origResolve = ProcessExecutor.resolveExecutable;
    ProcessExecutor.resolveExecutable = async (name: string) => {
      if (name === 'adb') return '/usr/bin/adb';
      return origResolve.call(ProcessExecutor, name);
    };

    ProcessExecutor.execute = async (req) => {
      const args = req.args || [];
      if (args[0] === 'devices') {
        return {
          executable: 'adb',
          arguments: args,
          cwd: '',
          environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' },
          exitCode: 0,
          stdout: 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n',
          stderr: '',
          signal: null,
          timedOut: false,
          durationMs: 5
        };
      }
      if (args.includes('ro.build.version.release')) {
        return { executable: 'adb', arguments: args, cwd: '', environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' }, exitCode: 0, stdout: '14\n', stderr: '', signal: null, timedOut: false, durationMs: 5 };
      }
      if (args.includes('ro.product.cpu.abi')) {
        return { executable: 'adb', arguments: args, cwd: '', environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' }, exitCode: 0, stdout: 'x86_64\n', stderr: '', signal: null, timedOut: false, durationMs: 5 };
      }
      if (args.includes('pm') && args.includes('list')) {
        return { executable: 'adb', arguments: args, cwd: '', environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' }, exitCode: 0, stdout: 'package:com.android.settings\n', stderr: '', signal: null, timedOut: false, durationMs: 5 };
      }
      return origExec.call(ProcessExecutor, req);
    };

    try {
      const report = await androidRuntimeManager.runQuickInstall(validApkPath, { target: 'emulator-5556' });
      assert(report.targetInfo?.targetId === 'emulator-5556', `Expected emulator-5556 selected, got ${report.targetInfo?.targetId}`);
      assert(report.stages.TARGET_FOUND.status === 'PASS', `Expected TARGET_FOUND=PASS`);
      assert(report.stages.ANDROID_READY.status === 'PASS', `Expected ANDROID_READY=PASS`);
      return `SelectedTarget=${report.targetInfo?.targetId}, TargetStatus=${report.stages.TARGET_FOUND.status}`;
    } finally {
      ProcessExecutor.execute = origExec;
      ProcessExecutor.resolveExecutable = origResolve;
    }
  });

  // -------------------------------------------------------------------------
  // Start a local mock server to test end-to-end scenarios via REST_TLS adapter
  // -------------------------------------------------------------------------
  let mockState = {
    runtimeReady: true,
    androidVersion: '14',
    abi: 'x86_64',
    pmReady: true,
    installSuccess: true,
    installError: '',
    verifySuccess: true,
    launchSuccess: true,
    procRunning: true,
    pid: 7788,
    returnFrame: true,
    listedPackages: ['com.android.settings']
  };

  const mockServer = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/api/android/remote/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready: mockState.runtimeReady,
        state: mockState.runtimeReady ? 'ANDROID_READY' : 'HOST_RUNTIME_UNAVAILABLE',
        androidVersion: mockState.androidVersion,
        architecture: mockState.abi,
        packageManagerReady: mockState.pmReady,
        packagesCount: mockState.listedPackages.length,
        error: mockState.runtimeReady ? undefined : 'HOST_RUNTIME_UNAVAILABLE'
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ androidVersion: mockState.androidVersion, version: mockState.androidVersion }));
      return;
    }

    if (url.startsWith('/api/android/remote/arch')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ architecture: mockState.abi, abi: mockState.abi }));
      return;
    }

    if (url === '/api/android/remote/packages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ packageManagerReady: mockState.pmReady, packages: mockState.listedPackages }));
      return;
    }

    if (url.startsWith('/api/android/remote/packages/install') && req.method === 'POST') {
      let b = '';
      req.on('data', c => { b += c.toString(); });
      req.on('end', () => {
        if (!mockState.installSuccess) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            errorCode: 'INSTALL_FAILED',
            error: mockState.installError || 'INSTALL_FAILED: Storage full'
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          packageName: 'com.example.testapk',
          sha256: validApkSha256,
          message: 'Success'
        }));
      });
      return;
    }

    if (url.startsWith('/api/android/remote/packages/verify/')) {
      const pkg = decodeURIComponent(url.split('/').pop() || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        packageName: pkg,
        installed: mockState.verifySuccess,
        verified: mockState.verifySuccess
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/packages/launch') && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: mockState.launchSuccess,
        pid: mockState.procRunning ? mockState.pid : undefined,
        message: mockState.launchSuccess ? 'Activity started' : 'APP_LAUNCH_FAILED: Activity not found'
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/process/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: mockState.procRunning,
        pid: mockState.procRunning ? mockState.pid : undefined
      }));
      return;
    }

    if (url.startsWith('/api/android/remote/frame')) {
      if (mockState.returnFrame) {
        const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ format: 'png', width: 720, height: 1280, dataBase64: pngHeader.toString('base64') }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'DISPLAY_STREAM_UNAVAILABLE' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>(res => mockServer.listen(0, '127.0.0.1', () => res()));
  const mockPort = (mockServer.address() as any).port;

  try {
    // Configure remote adapter to mock server
    remoteAdapter.saveConfig({
      mode: 'REST_TLS',
      host: '127.0.0.1',
      port: mockPort,
      endpointUrl: `http://127.0.0.1:${mockPort}`,
      token: '',
      tlsEnabled: false
    });

    // -------------------------------------------------------------------------
    // 6. INSTALL_FAILED
    // -------------------------------------------------------------------------
    await record('T06_INSTALL_FAILED', 'Return FAIL with INSTALL_FAILED when package manager rejects installation', async () => {
      mockState.installSuccess = false;
      mockState.installError = 'INSTALL_FAILED_INSUFFICIENT_STORAGE';
      const report = await androidRuntimeManager.runQuickInstall(validApkPath);
      mockState.installSuccess = true;
      assert(report.result === 'FAIL', `Expected result=FAIL, got ${report.result}`);
      assert(report.exitCode === 1, `Expected exitCode=1, got ${report.exitCode}`);
      assert(report.blockerCode === 'INSTALL_FAILED', `Expected blockerCode=INSTALL_FAILED, got ${report.blockerCode}`);
      assert(report.stages.INSTALL_VERIFIED.status === 'FAIL', `Expected INSTALL_VERIFIED=FAIL`);
      assert(report.stages.APP_LAUNCH_REQUESTED.status === 'BLOCKED', `Expected APP_LAUNCH_REQUESTED=BLOCKED`);
      return `Result=${report.result}, Blocker=${report.blockerCode}`;
    });

    // -------------------------------------------------------------------------
    // 7. PACKAGE_VERIFICATION_FAILED
    // -------------------------------------------------------------------------
    await record('T07_PACKAGE_VERIFICATION_FAILED', 'Return FAIL with PACKAGE_VERIFICATION_FAILED when independent pm query fails', async () => {
      mockState.verifySuccess = false;
      const report = await androidRuntimeManager.runQuickInstall(validApkPath);
      mockState.verifySuccess = true;
      assert(report.result === 'FAIL', `Expected result=FAIL, got ${report.result}`);
      assert(report.exitCode === 1, `Expected exitCode=1, got ${report.exitCode}`);
      assert(report.blockerCode === 'PACKAGE_VERIFICATION_FAILED', `Expected blockerCode=PACKAGE_VERIFICATION_FAILED, got ${report.blockerCode}`);
      assert(report.stages.INSTALL_VERIFIED.status === 'FAIL', `Expected INSTALL_VERIFIED=FAIL`);
      return `Result=${report.result}, Blocker=${report.blockerCode}`;
    });

    // -------------------------------------------------------------------------
    // 8. APP_LAUNCH_FAILED
    // -------------------------------------------------------------------------
    await record('T08_APP_LAUNCH_FAILED', 'Return FAIL with APP_LAUNCH_FAILED when activity fails to start', async () => {
      mockState.launchSuccess = false;
      const report = await androidRuntimeManager.runQuickInstall(validApkPath);
      mockState.launchSuccess = true;
      assert(report.result === 'FAIL', `Expected result=FAIL, got ${report.result}`);
      assert(report.exitCode === 1, `Expected exitCode=1, got ${report.exitCode}`);
      assert(report.blockerCode === 'APP_LAUNCH_FAILED', `Expected blockerCode=APP_LAUNCH_FAILED, got ${report.blockerCode}`);
      assert(report.stages.APP_LAUNCH_REQUESTED.status === 'FAIL', `Expected APP_LAUNCH_REQUESTED=FAIL`);
      return `Result=${report.result}, Blocker=${report.blockerCode}`;
    });

    // -------------------------------------------------------------------------
    // 9. COMPLETE_SUCCESS_E2E (TestAPK.apk)
    // -------------------------------------------------------------------------
    await record('T09_COMPLETE_SUCCESS_E2E', 'All 7 stages PASS with exitCode 0 and reconciled registry', async () => {
      mockState.installSuccess = true;
      mockState.verifySuccess = true;
      mockState.launchSuccess = true;
      mockState.procRunning = true;
      mockState.returnFrame = true;

      const report = await androidRuntimeManager.runQuickInstall(validApkPath);
      assert(report.result === 'PASS', `Expected result=PASS, got ${report.result}`);
      assert(report.exitCode === 0, `Expected exitCode=0, got ${report.exitCode}`);
      assert(report.blockerCode === 'NONE', `Expected blockerCode=NONE, got ${report.blockerCode}`);
      assert(report.stages.APK_VALIDATED.status === 'PASS', `Expected APK_VALIDATED=PASS`);
      assert(report.stages.TARGET_FOUND.status === 'PASS', `Expected TARGET_FOUND=PASS`);
      assert(report.stages.ANDROID_READY.status === 'PASS', `Expected ANDROID_READY=PASS`);
      assert(report.stages.INSTALL_VERIFIED.status === 'PASS', `Expected INSTALL_VERIFIED=PASS`);
      assert(report.stages.APP_LAUNCH_REQUESTED.status === 'PASS', `Expected APP_LAUNCH_REQUESTED=PASS`);
      assert(report.stages.APP_RUNNING.status === 'PASS', `Expected APP_RUNNING=PASS`);
      assert(report.stages.DISPLAY_AVAILABLE.status === 'PASS', `Expected DISPLAY_AVAILABLE=PASS`);
      assert(report.packageInfo?.packageName === 'com.example.testapk', `Expected packageName=com.example.testapk`);

      // Verify report formatting
      const formatted = formatQuickInstallReport(report);
      assert(formatted.includes('ARCLIGHT ANDROID QUICK-INSTALL — EXECUTION REPORT'), 'Formatted report missing header');
      assert(formatted.includes('[PASS]') && formatted.includes('APK_VALIDATED:'), 'Formatted report missing stage output');

      return `Result=PASS, Package=${report.packageInfo?.packageName}, AllStages=PASS`;
    });

    // -------------------------------------------------------------------------
    // 10. COMPATIBLE_GENERIC_APP (Generic APK through identical path)
    // -------------------------------------------------------------------------
    await record('T10_COMPATIBLE_GENERIC_APP', 'Generic APK (e.g. UC Browser copy) runs through identical verified path without hacks', async () => {
      const genericApkPath = path.join(tempDir, 'UCBrowser.apk');
      fs.copyFileSync(validApkPath, genericApkPath);
      const report = await androidRuntimeManager.runQuickInstall(genericApkPath);
      assert(report.result === 'PASS', `Expected generic APK result=PASS, got ${report.result}`);
      assert(report.exitCode === 0, `Expected generic APK exitCode=0, got ${report.exitCode}`);
      assert(report.stages.INSTALL_VERIFIED.status === 'PASS', `Expected INSTALL_VERIFIED=PASS`);
      return `GenericApk=${path.basename(genericApkPath)}, Result=PASS`;
    });
  } finally {
    mockServer.close();
    remoteAdapter.clearConfig();
    await androidPackageService.reconcileRegistry();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('----------------------------------------------------------------');
  const passed = results.filter(r => r.passed).length;
  console.log(`QUICK-INSTALL TESTS SUMMARY: ${passed}/${results.length} PASSED`);
  console.log('================================================================');

  if (passed !== results.length) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
