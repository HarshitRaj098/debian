import fs from 'fs';
import path from 'path';
import { androidRuntimeManager } from './AndroidRuntimeManager';
import { remoteAndroidAdapter } from './RemoteAndroidAdapter';
import { QuickInstallReport } from '../types/android';

function printHelp() {
  console.log(`
============================================================
ARCLIGHT ANDROID RUNTIME CLI — REMOTE & LOCAL ADAPTER SUITE
============================================================
Usage:
  android <command> [arguments...]

Commands:
  quick-install <apkPath>  One-command verified path (APK -> Target -> PM Install -> Verify -> Launch)
  verify [--full] [apk]    Run end-to-end Android verification (Host -> Connect -> Install -> Launch)
  status                   Show runtime state, connection, version, arch, and local limitation
  doctor                   Run full 11-stage Android doctor diagnostic audit
  connect <target> [token] Connect to remote Android runtime (REST endpoint or ADB target)
  disconnect               Disconnect remote Android runtime
  test-connection [target] Test reachability and probe remote Android runtime without saving
  test-apk [apkPath]       Execute canonical 7-stage TestAPK.apk cryptographic acceptance test
  packages                 List installed packages from authoritative Android package manager
  install <apkPath>        Transfer and install APK on the active Android runtime
  launch <packageName>     Launch application on the active Android runtime
  stop <packageName>       Force-stop application on the active Android runtime
  logs [lines]             Display recent Android logcat / runtime event logs
  help                     Show this help message

Examples:
  android quick-install ./TestAPK.apk
  android quick-install ./TestAPK.apk --target 192.168.1.100:5555
  android verify --full
  android status
  android connect 192.168.1.50:8555 mySecretToken
  android connect 192.168.1.100:5555
  android test-apk /home/ubuntu/Downloads/com.example.testapk.apk
  android packages
  android launch com.example.testapk
============================================================
`);
}

export function formatQuickInstallReport(report: QuickInstallReport): string {
  const isPass = report.result === 'PASS';
  const lines: string[] = [];

  lines.push('============================================================');
  lines.push(`ARCLIGHT ANDROID QUICK-INSTALL — EXECUTION REPORT [${isPass ? 'SUCCESS' : (report.result === 'BLOCKED' ? 'BLOCKED' : 'ERROR')}]`);
  lines.push('============================================================');
  lines.push(`Command                : ${report.command}`);
  lines.push(`Result                 : ${report.result} (exit=${report.exitCode})`);

  if (isPass) {
    if (report.targetInfo) {
      lines.push(`Target Selected        : ${report.targetInfo.targetId} (${report.targetInfo.mode})`);
      if (report.targetInfo.androidVersion) {
        lines.push(`Android Version        : ${report.targetInfo.androidVersion}`);
      }
      if (report.targetInfo.architecture) {
        lines.push(`Target Architecture    : ${report.targetInfo.architecture}`);
      }
    }
    if (report.packageInfo) {
      lines.push(`Package                : ${report.packageInfo.packageName} v${report.packageInfo.versionName} (code ${report.packageInfo.versionCode})`);
      if (report.packageInfo.launchableActivity) {
        lines.push(`Launchable Activity    : ${report.packageInfo.launchableActivity}`);
      }
      lines.push(`SHA-256                : ${report.packageInfo.sha256}`);
    }
  } else {
    lines.push(`Blocker Code           : ${report.blockerCode}`);
    lines.push(`Failing Stage          : ${report.failingStage || 'NONE'}`);
    lines.push(`Root Cause             : ${report.rootCause}`);
  }
  lines.push('');
  lines.push('[STAGE-BY-STAGE VERIFICATION]');
  for (const [stageName, detail] of Object.entries(report.stages)) {
    const padStatus = `[${detail.status}]`.padEnd(10, ' ');
    const padName = `${stageName}:`.padEnd(23, ' ');
    lines.push(`  ${padStatus} ${padName} ${detail.evidence} (${detail.durationMs}ms)`);
  }

  if (isPass) {
    lines.push('');
    lines.push(`Reconciled Registry    : Synced to Arclight Package Registry (${report.reconciledRegistryCount ?? 1} package(s))`);
  } else if (report.recoveryAction) {
    lines.push('');
    lines.push('[RECOVERY ACTION]');
    report.recoveryAction.split('\n').forEach(l => lines.push(`  ${l}`));
  }
  lines.push('============================================================');

  return lines.join('\n');
}

export function printVerificationReport(report: Awaited<ReturnType<typeof androidRuntimeManager.runFullEndToEndVerification>>) {
  console.log('============================================================');
  console.log('ARCLIGHT ANDROID END-TO-END VERIFICATION (android verify --full)');
  console.log('============================================================');
  console.log(`Timestamp              : ${report.timestamp}`);
  console.log(`Command                : ${report.command}`);
  console.log(`Overall Status         : ${report.overallStatus} (exit=${report.exitCode})`);
  console.log(`First Failing Stage    : ${report.firstFailingStage || 'NONE'}`);
  console.log(`First Blocker Code     : ${report.firstBlockerCode}`);
  console.log(`Root Cause             : ${report.rootCause}`);
  if (report.remainingExternalRequirement) {
    console.log(`External Requirement   : ${report.remainingExternalRequirement}`);
  }
  console.log('============================================================\n');

  const printSection = (title: string, checks: Record<string, any>) => {
    console.log(title);
    for (const c of Object.values(checks)) {
      const statusPad = `[${c.status}]`.padEnd(13, ' ');
      const namePad = c.name.padEnd(50, ' ');
      console.log(`  ${statusPad} ${namePad} (${c.durationMs}ms)`);
      console.log(`                └─ Code: ${c.code} | Evidence: ${c.evidence}`);
    }
    console.log('');
  };

  printSection('[1] HOST CHECKS:', report.hostChecks);
  printSection('[2] CONNECTION CHECKS:', report.connectionChecks);
  printSection('[3] INSTALLATION CHECKS:', report.installationChecks);
  printSection('[4] LAUNCH, DISPLAY & INPUT CHECKS:', report.launchChecks);

  console.log('============================================================');
  console.log('VERIFICATION SUMMARY');
  console.log('============================================================');
  console.log(`  Runtime Connection   : ${report.summary.runtimeConnectionStatus}`);
  console.log(`  APK Installation     : ${report.summary.apkInstallationStatus}`);
  console.log(`  Application Launch   : ${report.summary.applicationLaunchStatus}`);
  console.log(`  Display Stream       : ${report.summary.displayStatus}`);
  console.log(`  Input Forwarding     : ${report.summary.inputStatus}`);
  console.log(`  Reconciled Packages  : ${report.summary.reconciledRegistryCount}`);
  console.log('============================================================');
}

async function main() {
  const args = process.argv.slice(2);
  const subcommand = (args[0] || 'help').toLowerCase();

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    process.exit(0);
  }

  if (subcommand === 'quick-install' || subcommand === 'quickinstall') {
    const rawArgs = args.slice(1);
    const targetIdx = rawArgs.indexOf('--target');
    let explicitTarget: string | undefined = undefined;
    if (targetIdx !== -1 && rawArgs[targetIdx + 1]) {
      explicitTarget = rawArgs[targetIdx + 1];
      rawArgs.splice(targetIdx, 2);
    }
    const apkArg = rawArgs.find(a => !a.startsWith('--'));

    if (!apkArg) {
      console.log(`
============================================================
ARCLIGHT ANDROID QUICK-INSTALL — EXECUTION REPORT [ERROR]
============================================================
Command                : android quick-install
Result                 : FAIL (exit=1)
Blocker Code           : APK_NOT_FOUND
Failing Stage          : APK_VALIDATED
Root Cause             : Missing required argument: <apk-path>.

[STAGE-BY-STAGE VERIFICATION]
  [FAIL]     APK_VALIDATED:          Missing required argument: <apk-path> (0ms)
  [BLOCKED]  TARGET_FOUND:           BLOCKED: Missing APK path (0ms)
  [BLOCKED]  ANDROID_READY:          BLOCKED: Missing APK path (0ms)
  [BLOCKED]  INSTALL_VERIFIED:       BLOCKED: Missing APK path (0ms)
  [BLOCKED]  APP_LAUNCH_REQUESTED:   BLOCKED: Missing APK path (0ms)
  [BLOCKED]  APP_RUNNING:            BLOCKED: Missing APK path (0ms)
  [BLOCKED]  DISPLAY_AVAILABLE:      BLOCKED: Missing APK path (0ms)

[RECOVERY ACTION]
  Usage: android quick-install <apk-path> [--target <device-id>]
  Example: android quick-install ./TestAPK.apk
============================================================
`);
      process.exit(1);
    }

    const report = await androidRuntimeManager.runQuickInstall(apkArg, { target: explicitTarget });
    console.log(formatQuickInstallReport(report));

    if (process.argv.includes('--json')) {
      console.log('\n[JSON REPORT]');
      console.log(JSON.stringify(report, null, 2));
    }

    process.exit(report.exitCode);
  }

  if (subcommand === 'verify') {
    const customApk = args.slice(1).find(a => !a.startsWith('--'));
    const report = await androidRuntimeManager.runFullEndToEndVerification(customApk);
    printVerificationReport(report);
    if (process.argv.includes('--json')) {
      console.log('\n[JSON REPORT]');
      console.log(JSON.stringify(report, null, 2));
    }

    process.exit(report.exitCode);
  }

  if (subcommand === 'status') {
    const st = await remoteAndroidAdapter.getStatus();
    const { status: bestStatus } = await androidRuntimeManager.detectBest();

    console.log('============================================================');
    console.log('ARCLIGHT ANDROID RUNTIME STATUS');
    console.log('============================================================');
    console.log(`Runtime State          : ${st.state}`);
    console.log(`Connected              : ${st.connected ? 'YES' : 'NO'}`);
    console.log(`Bridge Mode            : ${st.mode}`);
    console.log(`Endpoint               : ${st.endpoint}`);
    console.log(`Android Version        : ${st.androidVersion || 'UNREACHABLE'}`);
    console.log(`Architecture           : ${st.architecture || 'N/A'}`);
    console.log(`Package Manager        : ${st.packageManagerReady ? 'ONLINE' : 'UNREACHABLE'}`);
    console.log(`Installed Packages     : ${st.packagesCount ?? 0}`);
    console.log(`Last Checked           : ${st.lastChecked}`);
    console.log(`Last Error             : ${st.lastError || 'None'}`);
    console.log('\n[LOCAL ENVIRONMENT SUPPORT]');
    console.log(`  Local Container Ready: ${st.localSupport.supported ? 'YES' : 'NO'}`);
    console.log(`  Kernel               : ${st.localSupport.kernel} (gVisor=${st.localSupport.isGvisor})`);
    console.log(`  /dev/binder          : ${st.localSupport.hasBinder ? 'PRESENT' : 'MISSING'}`);
    console.log(`  /dev/kvm             : ${st.localSupport.hasKvm ? 'PRESENT' : 'MISSING'}`);
    console.log(`  Limitation Analysis  : ${st.localSupport.reason}`);
    console.log('============================================================');
    process.exit(0);
  }

  if (subcommand === 'doctor') {
    const doc = await androidRuntimeManager.runAndroidDoctor();
    console.log('============================================================');
    console.log('ARCLIGHT ANDROID DOCTOR — RUNTIME & CAPABILITY AUDIT');
    console.log(`Timestamp              : ${doc.timestamp}`);
    console.log(`Overall Status         : ${doc.overallStatus}`);
    console.log(`Classification         : ${doc.limitationClassification}`);
    console.log(`Selected Strategy      : ${doc.selectedStrategy}`);
    console.log(`Reason                 : ${doc.reason}`);
    console.log(`Required Capability    : ${doc.requiredCapability}`);
    console.log('============================================================\n');

    console.log('[1] ENVIRONMENT CAPABILITIES:');
    console.log(`  NORMAL_ANDROID_HOST  = ${doc.capabilityModelInferences.NORMAL_ANDROID_HOST}`);
    console.log(`  WAYDROID_DIRECT      = ${doc.capabilityModelInferences.WAYDROID_DIRECT}`);
    console.log(`  KVM_ANDROID_EMULATOR = ${doc.capabilityModelInferences.KVM_ANDROID_EMULATOR}\n`);

    console.log('[2] 11-STAGE RUNTIME PROBE:');
    for (const c of doc.checks) {
      console.log(`  ${c.item.toUpperCase().padEnd(26, ' ')} | ${c.status.padEnd(12, ' ')} | ${c.evidence}`);
    }
    console.log('');
    process.exit(0);
  }

  if (subcommand === 'connect') {
    const target = args[1];
    const token = args[2] || '';
    if (!target) {
      console.error('Error: specify target host or adb address. Example: android connect 192.168.1.50:8555 [token]');
      process.exit(1);
    }

    const isHttp = target.startsWith('http://') || target.startsWith('https://');
    let mode: 'REST_TLS' | 'ADB_TCP' = 'REST_TLS';
    let host = target;
    let port = 8555;
    let adbTarget: string | undefined = undefined;

    if (!isHttp && target.includes(':') && !target.includes('/')) {
      // Could be ADB host:port or HTTP host:port
      const [h, p] = target.split(':');
      if (Number(p) === 5555) {
        mode = 'ADB_TCP';
        adbTarget = target;
      } else {
        host = h;
        port = Number(p) || 8555;
      }
    }

    console.log(`Connecting to ${target} via ${mode}...`);
    const res = await remoteAndroidAdapter.connect({
      mode,
      host,
      port,
      token,
      adbTarget
    });

    console.log(`Result: ${res.message}`);
    console.log(`State : ${res.status.state}`);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'disconnect') {
    const res = await remoteAndroidAdapter.disconnect();
    console.log(res.message);
    process.exit(0);
  }

  if (subcommand === 'test-connection') {
    const target = args[1];
    console.log('Testing remote Android runtime connection...');
    const st = await remoteAndroidAdapter.getStatus();
    console.log(`Current Remote State : ${st.state}`);
    console.log(`Connected            : ${st.connected ? 'YES' : 'NO'}`);
    console.log(`Android Version      : ${st.androidVersion || 'None'}`);
    console.log(`Package Manager      : ${st.packageManagerReady ? 'ONLINE' : 'UNREACHABLE'}`);
    if (st.lastError) console.log(`Last Error           : ${st.lastError}`);
    process.exit(0);
  }

  if (subcommand === 'test-apk') {
    const apkPath = args[1];
    console.log('============================================================');
    console.log('RUNNING CANONICAL 7-STAGE TestAPK.apk ACCEPTANCE TEST');
    console.log('============================================================');
    const report = await remoteAndroidAdapter.runTestApkAcceptance(apkPath);
    console.log(`Timestamp : ${report.timestamp}`);
    console.log(`APK Path  : ${report.apkPath}`);
    console.log(`SHA-256   : ${report.sha256}`);
    console.log(`Package   : ${report.packageName}`);
    console.log(`Verdict   : ${report.verdict}`);
    console.log(`Reason    : ${report.reason}\n`);

    console.log('[STAGE-BY-STAGE INDEPENDENT VERIFICATION]');
    for (const s of report.steps) {
      const stepTag = `Step ${s.step}: ${s.name}`.padEnd(45, ' ');
      const statusTag = `[${s.status}]`.padEnd(10, ' ');
      console.log(`  ${stepTag} ${statusTag} (${s.durationMs}ms)`);
      console.log(`    └─ ${s.details}`);
    }
    console.log('============================================================');
    process.exit(report.allPassed ? 0 : 1);
  }

  if (subcommand === 'packages') {
    const pkgs = await remoteAndroidAdapter.listPackages();
    console.log(`\nAuthoritative Android Packages (${pkgs.length}):`);
    if (pkgs.length === 0) {
      console.log('  No packages returned (runtime disconnected or PM unreachable).');
    } else {
      pkgs.forEach(p => console.log(`  - ${p}`));
    }
    console.log('');
    process.exit(0);
  }

  if (subcommand === 'install') {
    const apkPath = args[1];
    if (!apkPath) {
      console.error('Usage: android install <apkPath>');
      process.exit(1);
    }
    console.log(`Installing ${apkPath}...`);
    const res = await remoteAndroidAdapter.installApk(apkPath);
    console.log(res.message);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'launch') {
    const pkg = args[1];
    if (!pkg) {
      console.error('Usage: android launch <packageName>');
      process.exit(1);
    }
    console.log(`Launching ${pkg}...`);
    const res = await remoteAndroidAdapter.launchPackage(pkg);
    console.log(res.message);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'stop') {
    const pkg = args[1];
    if (!pkg) {
      console.error('Usage: android stop <packageName>');
      process.exit(1);
    }
    console.log(`Stopping ${pkg}...`);
    const res = await remoteAndroidAdapter.stopPackage(pkg);
    console.log(res.message);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'logs') {
    const lines = Number(args[1]) || 50;
    const logs = await remoteAndroidAdapter.getLogs(lines);
    console.log(`\nRuntime Logs (last ${logs.length} lines):`);
    logs.forEach(l => console.log(`  ${l}`));
    console.log('');
    process.exit(0);
  }

  console.error(`Unknown subcommand: ${subcommand}`);
  printHelp();
  process.exit(1);
}

// Only execute main if run directly as CLI
const isMain = process.argv[1] && (
  process.argv[1].endsWith('androidCli.ts') ||
  process.argv[1].endsWith('/android') ||
  process.argv[1].endsWith('android')
);

if (isMain) {
  main().catch(err => {
    console.error('Error running androidCli:', err);
    process.exit(1);
  });
}

