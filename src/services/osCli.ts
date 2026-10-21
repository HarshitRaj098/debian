import { osEndgameEngine } from './OsEndgameEngine';
import { androidRuntimeManager } from './AndroidRuntimeManager';
import { HostEnvironmentDetector } from './EnvironmentFingerprint';
import { runDeterministicSmoke } from './apkSmokeCli';

async function main() {
  const prog = (process.argv[2] || 'doctor').toLowerCase();
  const arg2 = (process.argv[3] || '').toLowerCase();
  const subcommand = (prog === 'os' || prog === 'android') ? `${prog} ${arg2 || 'doctor'}` : prog;

  if (subcommand === 'doctor' || subcommand === 'os doctor') {
    const [report, capModel] = await Promise.all([
      osEndgameEngine.runOsDoctor(),
      HostEnvironmentDetector.buildCapabilityModel()
    ]);
    console.log('============================================================');
    console.log('OS DOCTOR — UNIVERSAL DIAGNOSTIC REPORT');
    console.log(`Timestamp          : ${report.timestamp}`);
    console.log(`Environment Class  : ${capModel.environmentClass}`);
    console.log(`Overall Verdict    : ${report.overallVerdict} (Health: ${report.overallHealth})`);
    console.log('============================================================\n');

    console.log('[1] ENVIRONMENT CAPABILITY MODEL (SECTION 2 & 3):');
    console.log(`  NORMAL_ANDROID_HOST  : ${capModel.inferences.NORMAL_ANDROID_HOST}`);
    console.log(`  WAYDROID_DIRECT      : ${capModel.inferences.WAYDROID_DIRECT}`);
    console.log(`  KVM_ANDROID_EMULATOR : ${capModel.inferences.KVM_ANDROID_EMULATOR}`);
    console.log(`  /dev/kvm             : ${capModel.capabilities.kvm.status} (${capModel.capabilities.kvm.value})`);
    console.log(`  /dev/binder          : ${capModel.capabilities.binder.status} (${capModel.capabilities.binder.value})`);
    console.log(`  Limitation Reason    : ${capModel.inferences.LIMITATION_REASON}`);
    console.log(`  Required Capability  : ${capModel.inferences.REQUIRED_CAPABILITY}\n`);

    console.log('[2] 18-DOMAIN SUBSYSTEM INSPECTION:');
    for (const check of report.checks) {
      const padDomain = check.domain.toUpperCase().padEnd(16, ' ');
      const padVerdict = check.verdict.padEnd(6, ' ');
      console.log(`  ${padDomain} | ${padVerdict} | ${check.health.padEnd(10, ' ')} | ${check.evidence}`);
      if (check.remediation && check.verdict !== 'PASS') {
        console.log(`                   └─ Fix: ${check.remediation}`);
      }
    }

    console.log('\n[3] UNIVERSAL STATE AUTHORITY (OBSERVE -> COMPARE -> RECONCILE -> VERIFY):');
    for (const sa of report.stateAuthority) {
      console.log(`  ${sa.subsystem.padEnd(22, ' ')} | desired=${sa.desiredState} | actual=${sa.actualState} | reconciled=${sa.reconciled}`);
      if (sa.reconciliationAction) {
        console.log(`                         └─ Auto-Reconciled: ${sa.reconciliationAction}`);
      }
    }

    console.log('\n[4] GLOBAL MACHINE-CHECKABLE INVARIANTS:');
    for (const inv of report.invariants) {
      console.log(`  [${inv.holds ? 'PASS' : 'FAIL'}] ${inv.id}: ${inv.description}`);
      console.log(`         Evidence: ${inv.evidence}`);
    }

    console.log('\n[5] RESOURCE GOVERNOR:');
    const m = report.resourceGovernor.metrics;
    console.log(`  Overall Pressure : ${report.resourceGovernor.overallPressure}`);
    console.log(`  CPU              : ${m.cpu.usagePercent}% (${m.cpu.cores} cores, load=${m.cpu.load1m.toFixed(2)}) [${m.cpu.state}]`);
    console.log(`  RAM              : ${m.ram.usedMb}MB / ${m.ram.totalMb}MB (${m.ram.usagePercent}%) [${m.ram.state}]`);
    console.log(`  Disk             : ${m.disk.availGb}GB free / ${m.disk.totalGb}GB [${m.disk.state}]`);
    console.log(`  Processes / FDs  : ${m.processes.count} procs [${m.processes.state}] | ${m.fileDescriptors.openSelf} open FDs [${m.fileDescriptors.state}]`);
    return;
  }

  if (subcommand === 'android doctor' || subcommand === 'android-doctor') {
    const doc = await androidRuntimeManager.runAndroidDoctor();
    console.log('============================================================');
    console.log('ANDROID DOCTOR — RUNTIME & CAPABILITY DIAGNOSTIC (SECTION 26)');
    console.log(`Timestamp              : ${doc.timestamp}`);
    console.log(`Android Runtime Status : ${doc.overallStatus}`);
    console.log(`Classification         : ${doc.limitationClassification} (HOST_LIMITATION ≠ INSTALLATION_FAILURE)`);
    console.log(`Selected Strategy      : ${doc.selectedStrategy}`);
    console.log(`Reason                 : ${doc.reason}`);
    console.log(`Required Capability    : ${doc.requiredCapability}`);
    console.log('============================================================\n');

    console.log('[1] ENVIRONMENT INFERENCES:');
    console.log(`  NORMAL_ANDROID_HOST  = ${doc.capabilityModelInferences.NORMAL_ANDROID_HOST}`);
    console.log(`  WAYDROID_DIRECT      = ${doc.capabilityModelInferences.WAYDROID_DIRECT}`);
    console.log(`  KVM_ANDROID_EMULATOR = ${doc.capabilityModelInferences.KVM_ANDROID_EMULATOR}\n`);

    console.log('[2] 11-STAGE ANDROID RUNTIME PROBE:');
    for (const c of doc.checks) {
      console.log(`  ${c.item.toUpperCase().padEnd(26, ' ')} | ${c.status.padEnd(12, ' ')} | ${c.evidence}`);
    }
    return;
  }

  if (subcommand.startsWith('android quick-install') || subcommand.startsWith('quick-install')) {
    const rawArgs = process.argv.slice(2);
    const targetIdx = rawArgs.indexOf('--target');
    let explicitTarget: string | undefined = undefined;
    if (targetIdx !== -1 && rawArgs[targetIdx + 1]) {
      explicitTarget = rawArgs[targetIdx + 1];
      rawArgs.splice(targetIdx, 2);
    }
    const apkArg = rawArgs.slice(1).find(a => !a.startsWith('--') && a !== 'quick-install' && a !== 'android');
    const { formatQuickInstallReport } = await import('./androidCli');
    if (!apkArg) {
      console.log('Error: missing required <apk-path>. Usage: os android quick-install <apkPath>');
      process.exit(1);
    }
    const report = await androidRuntimeManager.runQuickInstall(apkArg, { target: explicitTarget });
    console.log(formatQuickInstallReport(report));
    process.exit(report.exitCode);
  }

  if (subcommand === 'android verify' || subcommand === 'verify') {
    const report = await androidRuntimeManager.runFullEndToEndVerification();
    console.log('============================================================');
    console.log('ANDROID VERIFY --FULL — END-TO-END VERIFICATION REPORT');
    console.log(`Timestamp              : ${report.timestamp}`);
    console.log(`Overall Status         : ${report.overallStatus} (exit=${report.exitCode})`);
    console.log(`First Failing Stage    : ${report.firstFailingStage || 'NONE'}`);
    console.log(`First Blocker Code     : ${report.firstBlockerCode}`);
    console.log(`Root Cause             : ${report.rootCause}`);
    if (report.remainingExternalRequirement) {
      console.log(`External Requirement   : ${report.remainingExternalRequirement}`);
    }
    console.log('============================================================\n');
    for (const [secName, checks] of [
      ['[1] HOST CHECKS:', report.hostChecks],
      ['[2] CONNECTION CHECKS:', report.connectionChecks],
      ['[3] INSTALLATION CHECKS:', report.installationChecks],
      ['[4] LAUNCH, DISPLAY & INPUT CHECKS:', report.launchChecks]
    ] as const) {
      console.log(secName);
      for (const c of Object.values(checks)) {
        console.log(`  [${c.status.padEnd(11, ' ')}] ${c.name} (${c.durationMs}ms)`);
        console.log(`                  └─ ${c.code}: ${c.evidence}`);
      }
      console.log('');
    }
    process.exit(report.exitCode);
  }

  if (subcommand === 'android smoke-test' || subcommand === 'smoke-test') {
    await runDeterministicSmoke();
    return;
  }

  if (subcommand === 'endgame-test' || subcommand === 'os endgame-test') {
    const res = await osEndgameEngine.runOsEndgameTest();
    console.log('============================================================');
    console.log('OS ENDGAME-TEST — SYSTEM-WIDE END-TO-END PROOF REPORT');
    console.log(`Timestamp: ${res.timestamp}`);
    console.log('============================================================\n');

    console.log('[1] CROSS-SUBSYSTEM BOUNDARY CONSISTENCY:');
    for (const b of res.boundaries) {
      console.log(`  ${b.boundary.padEnd(28, ' ')} | ${b.status.padEnd(5, ' ')} | ${String(b.latencyMs).padStart(4, ' ')}ms | ${b.evidence}`);
    }

    console.log('\n[2] PERFORMANCE DEPENDENCY GRAPH:');
    for (const p of res.performanceGraph) {
      console.log(`  ${p.stage.padEnd(30, ' ')} : ${String(p.durationMs).padStart(5, ' ')}ms (depends_on: ${p.dependsOn.join(', ') || 'ROOT'})`);
    }
    console.log(`  Dominant Bottleneck            : ${res.dominantBottleneck.stage} (${res.dominantBottleneck.durationMs}ms)`);

    console.log('\n============================================================');
    console.log('FINAL PROOF REPORT (SECTION 33)');
    console.log('============================================================');
    const fp = res.finalProofReport;
    for (const [key, val] of Object.entries(fp)) {
      console.log(`${key.replace(/_/g, ' ').padEnd(20, ' ')}: ${val.status.padEnd(6, ' ')} — ${val.evidence}`);
    }
    console.log('============================================================');
    return;
  }

  console.error(`Unknown subcommand: "${subcommand}". Supported: "os doctor", "os endgame-test", "android doctor", "android verify --full", "android smoke-test"`);
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

