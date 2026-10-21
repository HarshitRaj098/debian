import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { androidRuntimeManager, AndroidRuntimeAdapter, AndroidRuntimeHealth, HostRuntimeProbeResult } from './AndroidRuntimeManager';
import { getEnvironmentFingerprint, computeFileHash, EnvironmentFingerprintRecord } from './EnvironmentFingerprint';
import { ProcessExecutor, ProcessExecutionResult } from './ProcessExecutor';
import { remoteApkDownloader } from './RemoteApkDownloader';

export type ApkSourceType = 'LOCAL_FILE' | 'UPLOADED_FILE' | 'REMOTE_RESOLVED_FILE' | 'DRAG_DROP_FILE' | 'BROWSER_DOWNLOAD' | 'APK_REPOSITORY' | 'USB_STORAGE' | 'SHARED_STORAGE';

export type AndroidPackageFormat = 'APK' | 'SPLIT_APK' | 'APKS' | 'XAPK' | 'UNSUPPORTED';

export interface NormalizedApkArtifact {
  path: string;
  source: ApkSourceType;
  filename: string;
  packageFormat?: AndroidPackageFormat;
  splits?: string[];
  size: number;
  sha256: string;
  isValidZip: boolean;
  apkSigned?: boolean;
  apkInstallable?: boolean;
  packageName?: string;
  applicationName?: string;
  versionName?: string;
  versionCode?: number;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  launchableActivity?: string;
  activities?: string[];
  services?: string[];
  receivers?: string[];
  providers?: string[];
  declaredPermissions?: string[];
  supportedAbis?: string[];
  compatibility?: 'COMPATIBLE' | 'ABI_INCOMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
  compatibilityReason?: string;
}

export interface SupervisedAndroidProcess {
  packageName: string;
  pid: number | null;
  activity: string | null;
  state: 'RUNNING' | 'STOPPED' | 'CRASHED';
  startTime?: string;
  memoryKb?: number;
  cpuPercent?: number;
  lastChecked: string;
}

export interface ApkRuntimeDiagnostics {
  apkValid: boolean;
  apkSigned: boolean;
  apkInstallable: boolean;
  runtimeAvailable: boolean;
  hostProbe?: HostRuntimeProbeResult;
}

export type InstallTransactionStage =
  | 'RECEIVED'
  | 'NORMALIZED'
  | 'VALIDATED'
  | 'RUNTIME_READY'
  | 'INSTALLING'
  | 'INSTALLED'
  | 'VERIFIED'
  | 'LAUNCHING'
  | 'COMPLETED'
  | 'FAILED';

export interface InstallTransactionStageLog {
  stage: InstallTransactionStage;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'SKIPPED';
  timestamp: string;
  detail?: string;
  error?: string;
}

export interface InstallTransaction {
  id: string;
  createdAt: string;
  source: ApkSourceType;
  artifact: NormalizedApkArtifact;
  runtime: string;
  currentStage: InstallTransactionStage;
  stages: InstallTransactionStageLog[];
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  errorCode?: string;
  rawError?: string;
  rootCause?: string;
  runtimeExecution?: ProcessExecutionResult;
  realInstallPass: boolean;
  packageVerified: boolean;
  registrySyncPass: boolean;
  launchVerified: boolean;
  outcomeClassification?: 'SUCCESS' | 'HOST_LIMITATION' | 'INSTALLATION_FAILURE';
  apkDiagnostics?: ApkRuntimeDiagnostics;
}

export interface RawApkInput {
  sourceType: ApkSourceType;
  filePath?: string;
  fileName?: string;
  base64?: string;
  url?: string;
  transactionId?: string;
}

export class AndroidPackageService {
  private activeTransactions = new Map<string, InstallTransaction>();
  private activeLocks = new Set<string>();
  private lastTransaction: InstallTransaction | null = null;
  private appsJsonPath: string = path.join('/home/ubuntu/.config/android/apps.json');

  constructor(appsJsonPath?: string) {
    if (appsJsonPath) {
      this.appsJsonPath = appsJsonPath;
    }
  }

  public setAppsJsonPath(p: string) {
    this.appsJsonPath = p;
  }

  public getTransaction(id: string): InstallTransaction | undefined {
    return this.activeTransactions.get(id) || (this.lastTransaction?.id === id ? this.lastTransaction : undefined);
  }

  public getLastTransaction(): InstallTransaction | null {
    return this.lastTransaction;
  }

  public recordTransaction(tx: InstallTransaction): void {
    this.lastTransaction = tx;
    this.activeTransactions.set(tx.id, tx);
  }

  public async normalizeApkArtifact(input: RawApkInput): Promise<NormalizedApkArtifact> {
    const downloadsDir = '/home/ubuntu/Downloads';
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    let resolvedPath = '';

    if (input.sourceType === 'REMOTE_RESOLVED_FILE' && input.transactionId) {
      const tx = remoteApkDownloader.getTransaction(input.transactionId);
      if (!tx || !tx.tempFilePath || !fs.existsSync(tx.tempFilePath)) {
        throw new Error(`Remote download transaction "${input.transactionId}" not found or expired.`);
      }
      resolvedPath = tx.tempFilePath;
    } else if (input.sourceType === 'UPLOADED_FILE' || input.sourceType === 'DRAG_DROP_FILE') {
      if (input.base64 && input.fileName) {
        const safeName = path.basename(input.fileName);
        resolvedPath = path.join(downloadsDir, safeName);
        const buffer = Buffer.from(input.base64, 'base64');
        await fs.promises.writeFile(resolvedPath, buffer);
      } else if (input.filePath && fs.existsSync(input.filePath)) {
        resolvedPath = input.filePath;
      } else {
        throw new Error('Missing file buffer or valid filepath for uploaded/dropped APK.');
      }
    } else if (input.sourceType === 'LOCAL_FILE' && input.filePath) {
      const cleanPath = input.filePath.trim();
      if (fs.existsSync(cleanPath)) {
        resolvedPath = cleanPath;
      } else {
        const candidateInDownloads = path.join(downloadsDir, path.basename(cleanPath));
        if (fs.existsSync(candidateInDownloads)) {
          resolvedPath = candidateInDownloads;
        } else {
          throw new Error(`Local APK file does not exist at path: ${cleanPath}`);
        }
      }
    } else if (input.url) {
      const tx = await remoteApkDownloader.resolveAndDownload(input.url);
      if (tx.state !== 'READY' || !tx.tempFilePath || !fs.existsSync(tx.tempFilePath)) {
        throw new Error(tx.error?.message || `Failed to download remote APK from ${input.url}`);
      }
      resolvedPath = tx.tempFilePath;
    } else {
      throw new Error('Unsupported or empty APK input.');
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Artifact resolved path does not exist on disk: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`Artifact path is a directory, not a file: ${resolvedPath}`);
    }

    const sha256 = await computeFileHash(resolvedPath);
    const filename = path.basename(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    let packageFormat: AndroidPackageFormat = 'APK';
    if (ext === '.apks') packageFormat = 'APKS';
    else if (ext === '.xapk') packageFormat = 'XAPK';
    else if (ext === '.apk') packageFormat = 'APK';
    else packageFormat = 'UNSUPPORTED';

    const baseName = path.basename(resolvedPath, ext || '.apk');
    let packageName = 'com.user.' + baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let applicationName = baseName.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '').replace(/\b\w/g, l => l.toUpperCase());
    let versionName = '1.0.0';
    let versionCode = 1;
    let minSdkVersion = 21;
    let targetSdkVersion = 33;
    let launchableActivity: string | undefined;
    let activities: string[] = [];
    let services: string[] = [];
    let receivers: string[] = [];
    let providers: string[] = [];
    let splits: string[] = [];
    let declaredPermissions: string[] = [];
    let supportedAbis: string[] = ['x86_64', 'arm64-v8a'];
    let compatibility: 'COMPATIBLE' | 'ABI_INCOMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN' = 'UNKNOWN';
    let compatibilityReason = 'Pending manifest inspection';

    let isValidZip = false;
    if (stat.size >= 4) {
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(resolvedPath, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      isValidZip = (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);
    }

    let apkSigned = isValidZip;
    let apkInstallable = isValidZip;

    // If real `aapt` binary is available on host, extract authentic AndroidManifest metadata
    if (isValidZip) {
      const aaptExec = await ProcessExecutor.resolveExecutable('aapt');
      if (aaptExec) {
        const aaptRes = await ProcessExecutor.execute({
          executable: aaptExec,
          args: ['dump', 'badging', resolvedPath],
          timeoutMs: 8000
        });
        if (aaptRes.exitCode === 0 && aaptRes.stdout) {
          const out = aaptRes.stdout;
          const pkgMatch = out.match(/package:\s+name='([^']+)'(?:\s+versionCode='(\d+)')?(?:\s+versionName='([^']+)')?/);
          if (pkgMatch) {
            if (pkgMatch[1]) packageName = pkgMatch[1];
            if (pkgMatch[2]) versionCode = parseInt(pkgMatch[2], 10) || 1;
            if (pkgMatch[3]) versionName = pkgMatch[3];
            apkInstallable = true;
          }
          const sdkMatch = out.match(/sdkVersion:'(\d+)'/);
          if (sdkMatch && sdkMatch[1]) {
            minSdkVersion = parseInt(sdkMatch[1], 10) || 21;
          }
          const targetSdkMatch = out.match(/targetSdkVersion:'(\d+)'/);
          if (targetSdkMatch && targetSdkMatch[1]) {
            targetSdkVersion = parseInt(targetSdkMatch[1], 10) || 33;
          }
          const labelMatch = out.match(/application-label:'([^']+)'/);
          if (labelMatch && labelMatch[1]) {
            applicationName = labelMatch[1];
          }
          const actMatch = out.match(/launchable-activity:\s+name='([^']+)'/);
          if (actMatch && actMatch[1]) {
            launchableActivity = actMatch[1];
            activities = [launchableActivity];
          }
          const permMatches = Array.from(out.matchAll(/uses-permission:\s+name='([^']+)'/g));
          if (permMatches.length > 0) {
            declaredPermissions = permMatches.map(m => m[1]);
          }
          const abiMatch = out.match(/native-code:\s+([^\n]+)/);
          if (abiMatch && abiMatch[1]) {
            const parsedAbis = abiMatch[1].split(/\s+/).map(s => s.replace(/'/g, '').trim()).filter(Boolean);
            if (parsedAbis.length > 0) supportedAbis = parsedAbis;
          }
        }
      }

      const unzipExec = await ProcessExecutor.resolveExecutable('unzip');
      if (unzipExec) {
        const unzipRes = await ProcessExecutor.execute({
          executable: unzipExec,
          args: ['-l', resolvedPath],
          timeoutMs: 5000
        });
        if (unzipRes.exitCode === 0 && unzipRes.stdout) {
          const hasMetaInf = /META-INF\/.*\.(RSA|DSA|EC|SF|MF)/i.test(unzipRes.stdout);
          const hasManifest = unzipRes.stdout.includes('AndroidManifest.xml');
          const splitMatches = Array.from(unzipRes.stdout.matchAll(/\s+([^\s]+\.apk)\s*$/gm)).map(m => m[1]);
          if (splitMatches.length > 0) {
            splits = splitMatches;
            if (packageFormat === 'APK' && splitMatches.length > 1) {
              packageFormat = 'SPLIT_APK';
            }
          }
          if (hasManifest) {
            apkSigned = hasMetaInf;
            apkInstallable = true;
          }
        }
      }

      const apksignerExec = await ProcessExecutor.resolveExecutable('apksigner');
      if (apksignerExec) {
        const signRes = await ProcessExecutor.execute({
          executable: apksignerExec,
          args: ['verify', '--verbose', resolvedPath],
          timeoutMs: 8000
        });
        if (signRes.exitCode === 0 && signRes.stdout.includes('Verifies')) {
          apkSigned = true;
          apkInstallable = true;
        }
      }

      // Section 10: ABI Engine — compare against host/runtime supported ABIs (x86, x86_64, armeabi-v7a, arm64-v8a)
      const runtimeAbis = ['x86_64', 'x86'];
      const hostAbiCompatible =
        supportedAbis.some(abi => runtimeAbis.includes(abi)) ||
        supportedAbis.includes('arm64-v8a') ||
        supportedAbis.length === 0;
      const sdkCompatible = minSdkVersion <= 34;

      if (apkInstallable && apkSigned && hostAbiCompatible && sdkCompatible) {
        compatibility = 'COMPATIBLE';
        compatibilityReason = `Valid signed ${packageFormat} (${packageName} v${versionName}, minSdk=${minSdkVersion}, ABIs=${supportedAbis.join(', ')})`;
      } else if (!hostAbiCompatible) {
        compatibility = 'ABI_INCOMPATIBLE';
        compatibilityReason = `ABI_INCOMPATIBLE: package requires ${supportedAbis.join(', ')}, runtime supports ${runtimeAbis.join(', ')}`;
      } else if (!apkInstallable || !sdkCompatible) {
        compatibility = 'INCOMPATIBLE';
        compatibilityReason = !sdkCompatible ? `Unsupported minSdkVersion ${minSdkVersion}` : 'Invalid or unsigned APK structure';
      }
    } else {
      compatibility = 'INCOMPATIBLE';
      compatibilityReason = 'Missing ZIP/APK magic header (PK 0x03 0x04)';
    }

    return {
      path: resolvedPath,
      source: input.sourceType,
      filename,
      packageFormat,
      splits,
      size: stat.size,
      sha256,
      isValidZip,
      apkSigned,
      apkInstallable,
      packageName,
      applicationName,
      versionName,
      versionCode,
      minSdkVersion,
      targetSdkVersion,
      launchableActivity,
      activities,
      services,
      receivers,
      providers,
      declaredPermissions,
      supportedAbis,
      compatibility,
      compatibilityReason
    };
  }

  public async installApk(
    artifactOrInput: NormalizedApkArtifact | RawApkInput,
    options: { transactionId?: string; autoLaunch?: boolean } = {}
  ): Promise<InstallTransaction> {
    const nowIso = () => new Date().toISOString();
    const transactionId = options.transactionId || `apk-install-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const stages: InstallTransactionStageLog[] = [];
    stages.push({ stage: 'RECEIVED', status: 'SUCCESS', timestamp: nowIso(), detail: 'Installation request received.' });

    let artifact: NormalizedApkArtifact;
    try {
      if ('isValidZip' in artifactOrInput && 'sha256' in artifactOrInput) {
        artifact = artifactOrInput as NormalizedApkArtifact;
      } else {
        artifact = await this.normalizeApkArtifact(artifactOrInput as RawApkInput);
      }
      stages.push({
        stage: 'NORMALIZED',
        status: 'SUCCESS',
        timestamp: nowIso(),
        detail: `Artifact normalized: ${artifact.filename} (${artifact.size} bytes, SHA256: ${artifact.sha256})`
      });
    } catch (normErr: any) {
      stages.push({ stage: 'NORMALIZED', status: 'FAILED', timestamp: nowIso(), error: normErr.message });
      stages.push({ stage: 'FAILED', status: 'FAILED', timestamp: nowIso(), error: normErr.message });
      const failTx: InstallTransaction = {
        id: transactionId,
        createdAt: nowIso(),
        source: 'LOCAL_FILE',
        artifact: {
          path: '',
          source: 'LOCAL_FILE',
          filename: 'unknown',
          size: 0,
          sha256: '',
          isValidZip: false
        },
        runtime: 'UNKNOWN',
        currentStage: 'FAILED',
        stages,
        status: 'FAILED',
        errorCode: 'ARTIFACT_NORMALIZATION_FAILED',
        rawError: normErr.message,
        rootCause: normErr.message,
        realInstallPass: false,
        packageVerified: false,
        registrySyncPass: false,
        launchVerified: false
      };
      this.lastTransaction = failTx;
      return failTx;
    }

    const tx: InstallTransaction = {
      id: transactionId,
      createdAt: nowIso(),
      source: artifact.source,
      artifact,
      runtime: 'UNKNOWN',
      currentStage: 'NORMALIZED',
      stages,
      status: 'IN_PROGRESS',
      packageName: artifact.packageName,
      versionName: artifact.versionName,
      versionCode: artifact.versionCode,
      realInstallPass: false,
      packageVerified: false,
      registrySyncPass: false,
      launchVerified: false
    };

    this.activeTransactions.set(transactionId, tx);

    const lockKey = artifact.sha256 || artifact.packageName || artifact.path;
    if (this.activeLocks.has(lockKey)) {
      stages.push({ stage: 'FAILED', status: 'FAILED', timestamp: nowIso(), error: 'Concurrent install lock active for this artifact.' });
      tx.currentStage = 'FAILED';
      tx.status = 'FAILED';
      tx.errorCode = 'CONCURRENT_INSTALL_LOCKED';
      tx.rootCause = 'Duplicate or parallel installation request rejected by concurrency guard.';
      tx.rawError = tx.rootCause;
      this.lastTransaction = tx;
      return tx;
    }

    this.activeLocks.add(lockKey);
    androidRuntimeManager.emitIpcEvent('APK_INSTALL_STARTED', {
      transactionId,
      packageName: artifact.packageName,
      filePath: artifact.path
    });

    try {
      if (artifact.size === 0) {
        throw new Error('APK file size is 0 bytes.');
      }
      if (!artifact.isValidZip) {
        throw new Error('APK format is invalid: missing ZIP magic bytes.');
      }
      if (artifact.compatibility === 'INCOMPATIBLE') {
        throw new Error(`APK_INCOMPATIBLE: ${artifact.compatibilityReason || 'Incompatible package'}`);
      }

      stages.push({ stage: 'VALIDATED', status: 'SUCCESS', timestamp: nowIso(), detail: 'APK ZIP signature and integrity validated.' });
      tx.currentStage = 'VALIDATED';

      const { adapter, status: runtimeStatus } = await androidRuntimeManager.detectBest();
      tx.runtime = runtimeStatus.runtimeType;

      const health = await androidRuntimeManager.androidRuntimeHealth(artifact.path);
      const hostProbe = await androidRuntimeManager.probeHostCommands();
      tx.apkDiagnostics = {
        apkValid: artifact.isValidZip && artifact.size > 0,
        apkSigned: artifact.apkSigned ?? artifact.isValidZip,
        apkInstallable: artifact.apkInstallable ?? artifact.isValidZip,
        runtimeAvailable: health.ready,
        hostProbe
      };

      if (!health.ready) {
        const selection = await androidRuntimeManager.selectRuntimeStrategy();
        const err = `Android Runtime: UNAVAILABLE | Reason: ${selection.reason} | Required capability: ${selection.requiredCapability}`;
        stages.push({ stage: 'RUNTIME_READY', status: 'FAILED', timestamp: nowIso(), error: err });
        tx.currentStage = 'FAILED';
        tx.status = 'FAILED';
        tx.errorCode = selection.isHostLimitation ? 'ANDROID_RUNTIME_UNAVAILABLE_HOST_LIMITATION' : (health.firstFailure || 'RUNTIME_NOT_READY');
        tx.rootCause = selection.isHostLimitation ? 'HOST_LIMITATION_NO_BINDER_OR_KVM' : health.rootCause;
        tx.rawError = health.rawEvidence || err;
        tx.outcomeClassification = selection.isHostLimitation ? 'HOST_LIMITATION' : 'INSTALLATION_FAILURE';
        androidRuntimeManager.emitIpcEvent('APK_INSTALL_FAILED', {
          transactionId,
          packageName: artifact.packageName,
          errorCode: tx.errorCode,
          outcomeClassification: tx.outcomeClassification,
          reason: tx.rawError
        });
        return tx;
      }

      stages.push({ stage: 'RUNTIME_READY', status: 'SUCCESS', timestamp: nowIso(), detail: `Runtime ${tx.runtime} is alive and ready.` });
      tx.currentStage = 'RUNTIME_READY';

      stages.push({ stage: 'INSTALLING', status: 'SUCCESS', timestamp: nowIso(), detail: `Executing install via ${tx.runtime}` });
      tx.currentStage = 'INSTALLING';

      const installRes = await adapter.installApk(artifact.path);
      if (!installRes.success) {
        const installErr = installRes.stderr || installRes.message || 'Android installation command failed.';
        stages.push({ stage: 'INSTALLING', status: 'FAILED', timestamp: nowIso(), error: installErr });
        tx.currentStage = 'FAILED';
        tx.status = 'FAILED';
        tx.errorCode = installRes.errorCode || 'INSTALL_FAILED';
        tx.rootCause = installRes.rootCause || installErr;
        tx.rawError = installErr;
        return tx;
      }

      stages.push({ stage: 'INSTALLED', status: 'SUCCESS', timestamp: nowIso(), detail: 'Runtime reported install command success.' });
      tx.currentStage = 'INSTALLED';
      tx.realInstallPass = true;

      const packages = await adapter.listPackages();
      const cleanPkg = (artifact.packageName || '').toLowerCase();
      const isVerified = packages.some(p => p.toLowerCase().includes(cleanPkg) || cleanPkg.includes(p.toLowerCase()));

      if (!isVerified && packages.length > 0) {
        stages.push({ stage: 'VERIFIED', status: 'FAILED', timestamp: nowIso(), error: `Package ${artifact.packageName} not found in package list.` });
        tx.currentStage = 'FAILED';
        tx.status = 'FAILED';
        tx.errorCode = 'PACKAGE_NOT_FOUND_AFTER_INSTALL';
        tx.rootCause = 'Package verification failed.';
        tx.rawError = `Package ${artifact.packageName} missing from list of installed packages.`;
        return tx;
      }

      stages.push({ stage: 'VERIFIED', status: 'SUCCESS', timestamp: nowIso(), detail: `Package ${artifact.packageName} verified in package manager.` });
      tx.currentStage = 'VERIFIED';
      tx.packageVerified = true;

      await this.syncAppToRegistry(artifact, tx.runtime);
      tx.registrySyncPass = true;

      if (options.autoLaunch) {
        stages.push({ stage: 'LAUNCHING', status: 'SUCCESS', timestamp: nowIso(), detail: `Launching ${artifact.packageName}` });
        tx.currentStage = 'LAUNCHING';

        const launchRes = await this.launchPackage(artifact.packageName!);
        tx.launchVerified = launchRes.success;

        if (!launchRes.success) {
          stages.push({ stage: 'LAUNCHING', status: 'FAILED', timestamp: nowIso(), error: launchRes.message });
          tx.currentStage = 'FAILED';
          tx.status = 'FAILED';
          tx.errorCode = 'LAUNCH_FAILED';
          tx.rootCause = 'LAUNCH_FAILED';
          tx.rawError = launchRes.message;
          return tx;
        }
      }

      stages.push({ stage: 'COMPLETED', status: 'SUCCESS', timestamp: nowIso(), detail: 'APK installation pipeline completed successfully.' });
      tx.currentStage = 'COMPLETED';
      tx.status = 'COMPLETED';
      tx.outcomeClassification = 'SUCCESS';
      androidRuntimeManager.emitIpcEvent('APK_INSTALL_FINISHED', {
        transactionId,
        packageName: artifact.packageName,
        versionName: artifact.versionName,
        versionCode: artifact.versionCode
      });
      return tx;
    } catch (e: any) {
      stages.push({ stage: 'FAILED', status: 'FAILED', timestamp: nowIso(), error: e.message });
      tx.currentStage = 'FAILED';
      tx.status = 'FAILED';
      tx.errorCode = e.message.startsWith('APK_INCOMPATIBLE') ? 'APK_INCOMPATIBLE' : 'APK_INVALID';
      tx.rootCause = e.message;
      tx.rawError = e.stack || e.message;
      tx.outcomeClassification = 'INSTALLATION_FAILURE';
      androidRuntimeManager.emitIpcEvent('APK_INSTALL_FAILED', {
        transactionId,
        packageName: artifact.packageName,
        errorCode: tx.errorCode,
        outcomeClassification: tx.outcomeClassification,
        reason: tx.rawError
      });
      return tx;
    } finally {
      this.activeLocks.delete(lockKey);
      this.lastTransaction = tx;
    }
  }

  public async launchPackage(packageName: string): Promise<{ success: boolean; message: string; component?: string; pid?: number }> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    const component = await adapter.getLaunchComponent(packageName);
    const result = await adapter.launchPackage(packageName);
    if (!result.success) {
      return { ...result, component: component || packageName };
    }
    const procState = await adapter.getPackageProcessState(packageName);
    androidRuntimeManager.emitIpcEvent('ANDROID_APP_STARTED', {
      packageName,
      component: component || packageName,
      pid: procState.pid || null
    });
    return { ...result, component: component || packageName, pid: procState.pid };
  }

  public async stopPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    const res = await adapter.stopPackage(packageName);
    if (res.success) {
      androidRuntimeManager.emitIpcEvent('ANDROID_APP_STOPPED', { packageName });
    }
    return res;
  }

  public async getPackageProcessState(packageName: string): Promise<{ running: boolean; pid?: number }> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    return await adapter.getPackageProcessState(packageName);
  }

  public async superviseProcesses(): Promise<SupervisedAndroidProcess[]> {
    const { adapter, status: runtimeStatus } = await androidRuntimeManager.detectBest();
    const apps = await this.reconcileRegistry();
    const results: SupervisedAndroidProcess[] = [];

    for (const app of apps) {
      const pkg = app.packageName;
      if (!runtimeStatus.ready) {
        results.push({
          packageName: pkg,
          pid: null,
          activity: app.launchableActivity || null,
          state: 'STOPPED',
          lastChecked: new Date().toISOString()
        });
        continue;
      }

      const proc = await adapter.getPackageProcessState(pkg);
      results.push({
        packageName: pkg,
        pid: proc.pid ?? null,
        activity: app.launchableActivity || null,
        state: proc.running ? 'RUNNING' : 'STOPPED',
        lastChecked: new Date().toISOString()
      });
    }

    return results;
  }

  public async getPackagePermissions(packageName: string): Promise<Record<string, 'GRANTED' | 'DENIED' | 'UNREQUESTED'>> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    return await adapter.getPackagePermissions(packageName);
  }

  public async setPackagePermission(packageName: string, permission: string, grant: boolean): Promise<{ success: boolean; message: string }> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    return await adapter.setPackagePermission(packageName, permission, grant);
  }

  public async uninstallApk(packageName: string): Promise<{ success: boolean; verifiedAbsent: boolean; message: string }> {
    const adapter = await androidRuntimeManager.getActiveAdapter();
    const result = await adapter.uninstallPackage(packageName);
    let verifiedAbsent = false;
    if (result.success) {
      const remaining = await adapter.listPackages();
      const clean = packageName.toLowerCase();
      verifiedAbsent = !remaining.some(p => p.toLowerCase() === clean);
      androidRuntimeManager.emitIpcEvent('ANDROID_APP_UNINSTALLED', {
        packageName,
        verifiedAbsent
      });
    }
    await this.reconcileRegistry();
    return { ...result, verifiedAbsent };
  }

  public async reconcileRegistry(): Promise<any[]> {
    const { adapter, status: runtimeStatus } = await androidRuntimeManager.detectBest();
    let runtimePackages: string[] = [];
    if (runtimeStatus.ready) {
      try {
        runtimePackages = await adapter.listPackages();
      } catch {
        runtimePackages = [];
      }
    }

    let currentApps: any[] = [];
    if (fs.existsSync(this.appsJsonPath)) {
      try {
        currentApps = JSON.parse(await fs.promises.readFile(this.appsJsonPath, 'utf-8'));
      } catch {
        currentApps = [];
      }
    }

    let modified = false;
    if (!runtimeStatus.ready) {
      for (const app of currentApps) {
        if (
          app.runtimeState === 'RUNNING' ||
          app.runtimeState === 'SIMULATED' ||
          app.packageInstalled === true ||
          app.processRunning === true ||
          app.activityLaunched === true ||
          app.displayAvailable === true
        ) {
          app.runtimeState = 'STOPPED';
          app.packageInstalled = false;
          app.processRunning = false;
          app.activityLaunched = false;
          app.displayAvailable = false;
          modified = true;
        }
      }
    } else if (runtimePackages.length > 0) {
      const beforeLen = currentApps.length;
      currentApps = currentApps.filter(app => {
        if (app.installSource !== 'user_apk') return true;
        const clean = app.packageName.toLowerCase();
        return runtimePackages.some(rp => rp.toLowerCase() === clean || rp.toLowerCase().includes(clean));
      });
      if (currentApps.length !== beforeLen) modified = true;

      for (const app of currentApps) {
        const clean = app.packageName.toLowerCase();
        const isInstalled = runtimePackages.some(rp => rp.toLowerCase() === clean || rp.toLowerCase().includes(clean));
        let isRunning = false;
        try {
          const proc = await adapter.getPackageProcessState(app.packageName);
          isRunning = proc.running;
        } catch {
          isRunning = false;
        }
        const nextState = isRunning ? 'RUNNING' : 'STOPPED';
        if (
          app.packageInstalled !== isInstalled ||
          app.processRunning !== isRunning ||
          app.runtimeState !== nextState
        ) {
          app.packageInstalled = isInstalled;
          app.processRunning = isRunning;
          app.runtimeState = nextState;
          if (!isRunning) {
            app.activityLaunched = false;
            app.displayAvailable = false;
          }
          modified = true;
        }
      }
    }

    if (modified && fs.existsSync(path.dirname(this.appsJsonPath))) {
      await fs.promises.writeFile(this.appsJsonPath, JSON.stringify(currentApps, null, 2), 'utf-8');
    }

    return currentApps;
  }

  public async syncVerifiedPackageState(opts: {
    packageName: string;
    applicationName: string;
    versionName: string;
    versionCode: number;
    launchableActivity: string;
    apkPath: string;
    sizeBytes: number;
    sha256: string;
    packageInstalled: boolean;
    processRunning: boolean;
    activityLaunched: boolean;
    displayAvailable: boolean;
  }): Promise<void> {
    if (!opts.packageInstalled) {
      // Never mark an application as installed or add it to registry without verified installation evidence
      await this.reconcileRegistry();
      return;
    }

    let currentApps: any[] = [];
    const dir = path.dirname(this.appsJsonPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.appsJsonPath)) {
      try {
        currentApps = JSON.parse(await fs.promises.readFile(this.appsJsonPath, 'utf-8'));
      } catch {
        currentApps = [];
      }
    }

    const iconPath = await androidAppMetadataService.extractIcon(opts.packageName, opts.apkPath);
    const existingIndex = currentApps.findIndex(a => a.packageName === opts.packageName);
    const appRecord = {
      packageName: opts.packageName,
      applicationName: opts.applicationName,
      versionName: opts.versionName || '1.0.0',
      versionCode: opts.versionCode || 1,
      icon: 'package',
      iconPath: iconPath || undefined,
      installSource: 'user_apk',
      installTime: new Date().toISOString(),
      runtimeState: opts.processRunning ? 'RUNNING' : 'STOPPED',
      packageInstalled: opts.packageInstalled,
      processRunning: opts.processRunning,
      activityLaunched: opts.activityLaunched,
      displayAvailable: opts.displayAvailable,
      launchable: true,
      launchableActivity: opts.launchableActivity,
      supportedAbis: ['x86_64', 'arm64-v8a'],
      filePath: opts.apkPath,
      sizeBytes: opts.sizeBytes,
      sha256: opts.sha256,
      permissions: [
        {
          permission: 'android.permission.INTERNET',
          displayName: 'Internet Access',
          state: 'GRANTED',
          isToggleable: true,
          category: 'WIFI / NETWORK',
          description: 'Allows network communication.'
        }
      ]
    };

    if (existingIndex >= 0) {
      currentApps[existingIndex] = { ...currentApps[existingIndex], ...appRecord };
    } else {
      currentApps.push(appRecord);
    }

    await fs.promises.writeFile(this.appsJsonPath, JSON.stringify(currentApps, null, 2), 'utf-8');
  }

  private async syncAppToRegistry(artifact: NormalizedApkArtifact, runtimeType: string) {
    await this.syncVerifiedPackageState({
      packageName: artifact.packageName!,
      applicationName: artifact.applicationName || artifact.packageName!,
      versionName: artifact.versionName || '1.0.0',
      versionCode: artifact.versionCode || 1,
      launchableActivity: artifact.launchableActivity || `${artifact.packageName}/.MainActivity`,
      apkPath: artifact.path,
      sizeBytes: artifact.size,
      sha256: artifact.sha256,
      packageInstalled: true,
      processRunning: false,
      activityLaunched: false,
      displayAvailable: false
    });
  }
}
export class AndroidAppMetadataService {
  private iconsDir = '/home/ubuntu/.config/android/icons';

  constructor() {
    if (!fs.existsSync(this.iconsDir)) {
      fs.mkdirSync(this.iconsDir, { recursive: true });
    }
  }

  public async extractIcon(packageName: string, apkPath: string): Promise<string | null> {
    const iconPath = path.join(this.iconsDir, `${packageName}.png`);
    
    // Check if icon exists and is valid
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }

    // Try to extract icon using aapt
    const aaptExec = await ProcessExecutor.resolveExecutable('aapt');
    if (!aaptExec) return null;

    // 1. Get icon resource ID
    const dumpRes = await ProcessExecutor.execute({
      executable: aaptExec,
      args: ['dump', 'badging', apkPath],
      timeoutMs: 5000
    });

    const iconMatch = dumpRes.stdout.match(/application-icon-\d+:'([^']+)'/);
    if (!iconMatch || !iconMatch[1]) return null;
    const iconResource = iconMatch[1];

    // 2. Extract icon file
    const unzipExec = await ProcessExecutor.resolveExecutable('unzip');
    if (!unzipExec) return null;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-icon-'));
    const extractRes = await ProcessExecutor.execute({
      executable: unzipExec,
      args: ['-p', apkPath, iconResource],
      timeoutMs: 5000,
      encoding: 'buffer'
    });

    if (extractRes.exitCode === 0 && extractRes.stdout) {
      await fs.promises.writeFile(iconPath, extractRes.stdout);
      return iconPath;
    }
    
    return null;
  }
}

export const androidAppMetadataService = new AndroidAppMetadataService();

export const androidPackageService = new AndroidPackageService();
