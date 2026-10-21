import { systemHardeningEngine } from './SystemHardeningEngine';
import { Sentinel } from '../Sentinel';

async function run() {
  console.log('[HARDENING_SUITE] Executing full security, health, backup, chaos, and closure audit...');

  const health = await systemHardeningEngine.getSystemHealth();
  const security = await systemHardeningEngine.auditSecurity();
  const backup = await systemHardeningEngine.createBackup('test-init-backup');
  const chaos = await systemHardeningEngine.runChaosFuzzSuite();
  const closure = await systemHardeningEngine.getUniversalClosureState();
  const sentinel = new Sentinel().verifyInvariants();

  console.log('HEALTH_STATUS:', health.status);
  console.log('SECURITY_SECRET_LEAK:', security.secretLeakCheck);
  console.log('SECURITY_PATH_TRAVERSAL:', security.pathTraversalCheck);
  console.log('SECURITY_INPUT_SANITIZATION:', security.inputSanitizationCheck);
  console.log('BACKUP_CREATED:', backup.success ? 'PASS' : 'FAIL');
  console.log('CHAOS_TESTS_PASSED:', `${chaos.testsPassed}/${chaos.testsRun}`);
  console.log('CHAOS_SAFE_RECOVERY:', chaos.recoveredSafely ? 'PASS' : 'FAIL');
  console.log('STATE_VECTOR_FIELDS:', Object.keys(closure.systemStateVector).length);
  console.log('THREE_WORLD_W0_W1_DRIFT:', closure.threeWorldModel.driftAnalysis.W0_W1_drift);
  console.log('THREE_WORLD_W1_W2_DRIFT:', closure.threeWorldModel.driftAnalysis.W1_W2_drift);
  console.log('SENTINEL_INVARIANTS:', sentinel.passed ? 'PASS' : 'FAIL');
  console.log('CONVERGENCE_STATUS:', closure.convergenceStatus);
}

run().catch((err) => {
  console.error('Fatal hardening test error:', err);
  process.exit(1);
});
