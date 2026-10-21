import fs from 'fs';
import path from 'path';
import { androidRuntimeManager, AndroidRuntimeHealth } from './AndroidRuntimeManager';
import { androidPackageService } from './AndroidPackageService';
import { getEnvironmentFingerprint, computeFileHash, EnvironmentFingerprintRecord } from './EnvironmentFingerprint';
import { ProcessExecutionResult } from './ProcessExecutor';

export type E2EStage =
  | 'SELECTED'
  | 'FILE_RECEIVED'
  | 'FILE_VALIDATED'
  | 'RUNTIME_DETECTED'
  | 'RUNTIME_READY'
  | 'INSTALL_STARTED'
  | 'INSTALL_FINISHED'
  | 'PACKAGE_VERIFIED'
  | 'LAUNCH_STARTED'
  | 'LAUNCH_VERIFIED'
  | 'FAILED';

export interface E2EStageRecord {
  stage: E2EStage;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'SKIPPED';
  timestamp: string;
  detail?: string;
  error?: string;
}

export interface ApkMetadataInfo {
  valid: boolean;
  filePath: string;
  sizeBytes: number;
  packageName: string;
  applicationName: string;
  versionName: string;
  versionCode: number;
  abiCompatible: boolean;
  sha256: string;
  error?: string;
}

export interface InstallTransactionRecord {
  installId: string;
  createdAt: string;
  apkPath: string;
  fileName: string;
  stages: E2EStageRecord[];
  currentStage: E2EStage;
  environmentFingerprint: EnvironmentFingerprintRecord;
  apkMetadata?: ApkMetadataInfo;
  runtimeHealth?: AndroidRuntimeHealth;
  processResult?: ProcessExecutionResult;
  runtimeExecution?: ProcessExecutionResult;
  realInstallPass?: boolean;
  packageVerified?: boolean;
  launchVerified?: boolean;
  finalStatus: 'WORKING' | 'BLOCKED' | 'EXTERNAL_BLOCKER';
  rawError?: string;
  rootCause?: string;
}

class ApkE2EEngine {
  private activeTransactions = new Map<string, InstallTransactionRecord>();
  private activeLocks = new Set<string>();
  private lastTransaction: InstallTransactionRecord | null = null;

  public generateInstallId(): string {
    return `apk-install-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  public getLastTransaction(): InstallTransactionRecord | null {
    return this.lastTransaction;
  }

  public async validateApk(filePath: string): Promise<ApkMetadataInfo> {
    const baseName = path.basename(filePath);
    const packageName = 'com.user.' + baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const applicationName = baseName.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '').replace(/\b\w/g, l => l.toUpperCase());

    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        filePath,
        sizeBytes: 0,
        packageName,
        applicationName,
        versionName: '1.0.0',
        versionCode: 1,
        abiCompatible: false,
        sha256: '',
        error: `File does not exist: ${filePath}`
      };
    }

    try {
      const stats = fs.statSync(filePath);
      const sha256 = await computeFileHash(filePath);

      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        return {
          valid: false,
          filePath,
          sizeBytes: stats.size,
          packageName,
          applicationName,
          versionName: '1.0.0',
          versionCode: 1,
          abiCompatible: false,
          sha256,
          error: `Invalid APK/ZIP format (missing PK magic bytes)`
        };
      }

      const norm = await androidPackageService.normalizeApkArtifact({
        sourceType: 'LOCAL_FILE',
        filePath
      });

      return {
        valid: true,
        filePath: norm.path,
        sizeBytes: norm.size,
        packageName: norm.packageName || packageName,
        applicationName: norm.applicationName || applicationName,
        versionName: norm.versionName || '1.0.0',
        versionCode: norm.versionCode || 1,
        abiCompatible: true,
        sha256: norm.sha256
      };
    } catch (e: any) {
      return {
        valid: false,
        filePath,
        sizeBytes: 0,
        packageName,
        applicationName,
        versionName: '1.0.0',
        versionCode: 1,
        abiCompatible: false,
        sha256: '',
        error: `Exception reading APK: ${e.message}`
      };
    }
  }

  public async executeInstallPipeline(apkPath: string, providedInstallId?: string): Promise<InstallTransactionRecord> {
    const installId = providedInstallId || this.generateInstallId();
    const fileName = path.basename(apkPath);
    const nowIso = () => new Date().toISOString();
    const envFingerprint = getEnvironmentFingerprint();

    const stages: E2EStageRecord[] = [
      { stage: 'SELECTED', status: 'SUCCESS', timestamp: nowIso(), detail: `Selected APK: ${fileName}` },
      { stage: 'FILE_RECEIVED', status: 'SUCCESS', timestamp: nowIso(), detail: `Received file path in backend: ${apkPath}` }
    ];

    const tx: InstallTransactionRecord = {
      installId,
      createdAt: nowIso(),
      apkPath,
      fileName,
      stages,
      currentStage: 'FILE_RECEIVED',
      environmentFingerprint: envFingerprint,
      finalStatus: 'BLOCKED'
    };

    this.activeTransactions.set(installId, tx);

    const lockKey = path.resolve(apkPath);
    if (this.activeLocks.has(lockKey)) {
      stages.push({ stage: 'FAILED', status: 'FAILED', timestamp: nowIso(), error: 'Concurrent installation already in progress.' });
      tx.currentStage = 'FAILED';
      tx.rootCause = 'CONCURRENT_INSTALL_LOCKED';
      tx.rawError = 'Duplicate installation request rejected.';
      this.lastTransaction = tx;
      return tx;
    }

    this.activeLocks.add(lockKey);

    try {
      const apkMeta = await this.validateApk(apkPath);
      tx.apkMetadata = apkMeta;

      if (!apkMeta.valid) {
        stages.push({ stage: 'FILE_VALIDATED', status: 'FAILED', timestamp: nowIso(), error: apkMeta.error });
        tx.currentStage = 'FAILED';
        tx.rootCause = 'APK_UNREADABLE';
        tx.rawError = apkMeta.error;
        return tx;
      }
      stages.push({ stage: 'FILE_VALIDATED', status: 'SUCCESS', timestamp: nowIso(), detail: `APK visible and valid (SHA256: ${apkMeta.sha256})` });
      tx.currentStage = 'FILE_VALIDATED';

      const runtimeHealth = await androidRuntimeManager.androidRuntimeHealth(apkPath);
      tx.runtimeHealth = runtimeHealth;
      tx.realInstallPass = runtimeHealth.installPass;
      tx.packageVerified = runtimeHealth.packageManagerPass;
      tx.launchVerified = runtimeHealth.launchPass;

      if (!runtimeHealth.ready) {
        stages.push({ stage: 'RUNTIME_READY', status: 'FAILED', timestamp: nowIso(), error: runtimeHealth.rawEvidence });
        tx.currentStage = 'FAILED';
        tx.rootCause = runtimeHealth.rootCause;
        tx.rawError = runtimeHealth.rawEvidence;
        return tx;
      }

      stages.push({ stage: 'RUNTIME_READY', status: 'SUCCESS', timestamp: nowIso(), detail: 'Runtime session ready.' });
      tx.currentStage = 'RUNTIME_READY';

      stages.push({ stage: 'INSTALL_STARTED', status: 'SUCCESS', timestamp: nowIso(), detail: 'Executing real install.' });
      tx.currentStage = 'INSTALL_STARTED';

      const adapter = await androidRuntimeManager.getActiveAdapter();
      const installRes = await adapter.installApk(apkPath);

      if (!installRes.success) {
        stages.push({ stage: 'INSTALL_FINISHED', status: 'FAILED', timestamp: nowIso(), error: installRes.stderr || installRes.message });
        tx.currentStage = 'FAILED';
        tx.rootCause = installRes.rootCause || 'INSTALL_FAILED';
        tx.rawError = installRes.stderr || installRes.message;
        tx.realInstallPass = false;
        return tx;
      }

      stages.push({ stage: 'INSTALL_FINISHED', status: 'SUCCESS', timestamp: nowIso(), detail: 'Installation complete.' });
      tx.currentStage = 'INSTALL_FINISHED';
      tx.realInstallPass = true;

      const launchRes = await adapter.launchPackage(apkMeta.packageName);
      tx.launchVerified = launchRes.success;
      if (!launchRes.success) {
        stages.push({ stage: 'LAUNCH_VERIFIED', status: 'FAILED', timestamp: nowIso(), error: launchRes.message });
        tx.currentStage = 'FAILED';
        tx.rootCause = 'LAUNCH_FAILED';
        tx.rawError = launchRes.message;
        return tx;
      }

      stages.push({ stage: 'LAUNCH_VERIFIED', status: 'SUCCESS', timestamp: nowIso(), detail: 'Launch verified.' });
      tx.currentStage = 'LAUNCH_VERIFIED';
      tx.finalStatus = 'WORKING';

      return tx;
    } catch (e: any) {
      stages.push({ stage: 'FAILED', status: 'FAILED', timestamp: nowIso(), error: e.message });
      tx.currentStage = 'FAILED';
      tx.rootCause = e.message;
      tx.rawError = e.stack || e.message;
      return tx;
    } finally {
      this.activeLocks.delete(lockKey);
      this.lastTransaction = tx;
    }
  }

  public formatReport(tx: InstallTransactionRecord): string {
    const h = tx.runtimeHealth;
    return `HOST:
${h?.hostPass ? 'PASS' : 'FAIL'} (OS: ${tx.environmentFingerprint.os}, gVisor: ${tx.environmentFingerprint.containerDetection.isGvisor})

RUNTIME:
${h?.runtimePass ? 'PASS' : 'FAIL'} (${h?.runtime || 'None'})

CONTAINER:
${h?.containerPass ? 'PASS' : 'FAIL'} (${h?.container || 'stopped'})

SESSION:
${h?.sessionPass ? 'PASS' : 'FAIL'} (${h?.session || 'stopped'})

ANDROID BOOT:
${h?.androidBootPass ? 'PASS' : 'FAIL'} (${h?.androidBoot || 'incomplete'})

PACKAGE MANAGER:
${h?.packageManagerPass ? 'PASS' : 'FAIL'} (${h?.packageManager || 'unreachable'})

APK:
${h?.apkPass ? 'PASS' : 'FAIL'} (${tx.apkMetadata?.valid ? 'Valid APK' : 'Invalid/Missing'})

INSTALL:
${h?.installPass ? 'PASS' : 'FAIL'}

LAUNCH:
${h?.launchPass ? 'PASS' : 'FAIL'}

FIRST FAILURE:
${h?.firstFailure || tx.currentStage}

RAW EVIDENCE:
${h?.rawEvidence || tx.rawError || 'NONE'}

ROOT CAUSE:
${h?.rootCause || tx.rootCause || 'NONE'}

FIX:
${h?.fix || 'Ensure Waydroid container and Android session are fully booted and reachable from backend process.'}`;
  }
}

export const apkE2EEngine = new ApkE2EEngine();
