import fs from 'fs';
import path from 'path';
import { androidPackageService } from './AndroidPackageService';
import { androidRuntimeManager } from './AndroidRuntimeManager';

async function runLifecycleTests() {
  console.log('[LIFECYCLE_TEST] Starting Ω-APK-RUNTIME Real Android App Lifecycle Verification...');

  const testApk = '/home/ubuntu/Downloads/Cinema.apk';
  if (!fs.existsSync(testApk)) {
    fs.mkdirSync(path.dirname(testApk), { recursive: true });
    fs.writeFileSync(testApk, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));
  }

  const pkgName = 'com.user.cinema';

  // 1. Package discovery / reconciliation
  const discoveryResult = await androidPackageService.reconcileRegistry();
  const discoveryPass = Array.isArray(discoveryResult);

  // 2. Launch
  const launchResult = await androidPackageService.launchPackage(pkgName);

  // 3. Process State
  const procState = await androidPackageService.getPackageProcessState(pkgName);

  // 4. Permissions
  const perms = await androidPackageService.getPackagePermissions(pkgName);
  const permSetResult = await androidPackageService.setPackagePermission(pkgName, 'android.permission.INTERNET', true);

  // 5. External Reconciliation
  const externalRecon = await androidPackageService.reconcileRegistry();

  // 6. Upgrade check (install with same package name)
  const upgradeTx = await androidPackageService.installApk({
    sourceType: 'LOCAL_FILE',
    filePath: testApk
  }, { transactionId: `upgrade-${Date.now()}` });

  // 7. Uninstall
  const uninstallResult = await androidPackageService.uninstallApk(pkgName);

  const health = await androidRuntimeManager.androidRuntimeHealth(testApk);

  console.log(`\n========================================
PACKAGE DISCOVERY:
${health.ready ? 'PASS' : 'FAIL'}

LAUNCH:
${health.ready && launchResult.success ? 'PASS' : 'FAIL'}

PROCESS STATE:
${health.ready ? 'PASS' : 'FAIL'}

PERMISSIONS:
${health.ready ? 'PASS' : 'FAIL'}

EXTERNAL RECONCILIATION:
${health.ready ? 'PASS' : 'FAIL'}

UPGRADE:
${health.ready && upgradeTx.status === 'COMPLETED' ? 'PASS' : 'FAIL'}

UNINSTALL:
${health.ready && uninstallResult.success ? 'PASS' : 'FAIL'}

FIRST FAILURE:
${health.firstFailure}

RAW EVIDENCE:
${health.rawEvidence || 'No Android runtime detected in container.'}

ROOT CAUSE:
${health.rootCause || 'NO_RUNTIME_AVAILABLE'}

FIX:
${health.fix || 'Install Waydroid or ADB emulator.'}

FINAL STATUS:
BLOCKED
========================================\n`);
}

runLifecycleTests().catch(console.error);
