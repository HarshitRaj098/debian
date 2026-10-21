import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { ProcessExecutor, ProcessExecutionResult } from './ProcessExecutor';
import {
  AndroidRuntimeAdapter,
  AndroidRuntimeHealth
} from './AndroidRuntimeManager';
import {
  AndroidRuntimeStatus,
  AndroidRuntimeState,
  InstallResult,
  RemoteRuntimeConfig,
  RemoteRuntimeStatus,
  TestApkAcceptanceReport,
  TestApkStepResult,
  RemoteAndroidInputEvent
} from '../types/android';

const CONFIG_DIR = '/home/ubuntu/.config/arclight-android';
const CONFIG_FILE = path.join(CONFIG_DIR, 'remote-runtime.json');
const CANONICAL_TEST_APK = '/home/ubuntu/Downloads/com.example.testapk.apk';
const CANONICAL_TEST_APK_FALLBACK = path.resolve(process.cwd(), 'TestAPK.apk');
const CANONICAL_TEST_SHA256 = 'd87038037729f0bebf39f7fc4ab9fae9fbdb3e5d43e73c3e0b82d9ce5a3394ea';

export class RemoteAndroidAdapter implements AndroidRuntimeAdapter {
  type: AndroidRuntimeAdapter['type'] = 'REMOTE';

  private config: RemoteRuntimeConfig = {
    mode: 'REST_TLS',
    host: '',
    port: 8555,
    token: '',
    tlsEnabled: false,
    endpointUrl: ''
  };

  private isConfigured = false;
  private isConnected = false;
  private lastError: string | null = null;
  private lastFailureState: AndroidRuntimeState | null = null;
  private lastChecked = new Date().toISOString();
  private cachedVersion: string | null = null;
  private cachedArch: string | null = null;

  constructor() {
    this.loadPersistedConfig();
  }

  private loadPersistedConfig(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.host || parsed.endpointUrl || parsed.adbTarget)) {
          this.config = { ...this.config, ...parsed };
          this.isConfigured = true;
        }
      }
    } catch {
      // Ignore parse failure, keep unconfigured defaults
    }
  }

  public hasConfiguration(): boolean {
    return this.isConfigured && !!(this.config.host || this.config.endpointUrl || this.config.adbTarget);
  }

  public clearConfig(): void {
    this.isConfigured = false;
    this.isConnected = false;
    this.cachedVersion = null;
    this.cachedArch = null;
    this.lastError = null;
    this.lastFailureState = null;
    this.config = {
      mode: 'REST_TLS',
      host: '',
      port: 8555,
      token: '',
      tlsEnabled: false,
      endpointUrl: ''
    };
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }
    } catch {}
  }

  public saveConfig(newConfig: Partial<RemoteRuntimeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.host !== undefined || newConfig.port !== undefined || newConfig.tlsEnabled !== undefined) {
      if (!newConfig.endpointUrl && this.config.host) {
        const proto = this.config.tlsEnabled ? 'https' : 'http';
        this.config.endpointUrl = `${proto}://${this.config.host}:${this.config.port || 8555}`;
      }
    }
    this.isConfigured = !!(this.config.host || this.config.endpointUrl || this.config.adbTarget);
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      // Redact raw token when persisting to general config if needed, or store in restricted file
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (e: any) {
      console.warn('Failed to save remote android config:', e.message);
    }
  }

  public getConfig(): RemoteRuntimeConfig {
    return { ...this.config };
  }

  /**
   * Diagnostic check on host environment capability
   */
  public getLocalHostSupport(): RemoteRuntimeStatus['localSupport'] {
    const kernel = os.release() || '';
    const isGvisor = kernel.toLowerCase().includes('gvisor');
    const hasBinder = fs.existsSync('/dev/binder') || fs.existsSync('/dev/anbox-binder') || fs.existsSync('/dev/binderfs');
    const hasKvm = fs.existsSync('/dev/kvm');
    const supported = !isGvisor && hasBinder && hasKvm;
    const reason = isGvisor
      ? `LOCAL_RUNTIME_UNSUPPORTED: Kernel (${kernel}) is a gVisor sandbox lacking /dev/binder and /dev/kvm. Local Waydroid initialization is disabled.`
      : (!hasBinder ? 'LOCAL_RUNTIME_UNSUPPORTED: Host kernel lacks /dev/binder module.' : (!hasKvm ? 'LOCAL_RUNTIME_UNSUPPORTED: Host kernel lacks KVM virtualization.' : 'Local host supports Android execution.'));

    return {
      supported,
      reason,
      kernel,
      hasBinder,
      hasKvm,
      isGvisor
    };
  }

  /**
   * Connect to external Android runtime via REST_TLS, ADB_TCP, or COMPANION
   */
  public async connect(configOverride?: Partial<RemoteRuntimeConfig>): Promise<{ success: boolean; message: string; status: RemoteRuntimeStatus }> {
    if (configOverride) {
      this.saveConfig(configOverride);
    }

    this.lastChecked = new Date().toISOString();
    this.lastError = null;
    this.lastFailureState = null;
    this.cachedVersion = null;
    this.cachedArch = null;

    if (!this.hasConfiguration()) {
      this.isConnected = false;
      this.lastError = 'REMOTE_HOST_NOT_CONFIGURED: No remote Android host or ADB target configured.';
      this.lastFailureState = 'REMOTE_HOST_NOT_CONFIGURED';
      const st = await this.getStatus();
      return {
        success: false,
        message: this.lastError,
        status: st
      };
    }

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget || `${this.config.host}:${this.config.port || 5555}`;
      if (!target || target === ':5555' || target.includes('invalid')) {
        this.isConnected = false;
        this.lastError = `REMOTE_HOST_DISCONNECTED: Invalid ADB target "${target}"`;
        this.lastFailureState = 'REMOTE_HOST_DISCONNECTED';
        const st = await this.getStatus();
        return { success: false, message: this.lastError, status: st };
      }

      const adbRes = await ProcessExecutor.execute({
        executable: 'adb',
        args: ['connect', target],
        timeoutMs: 8000
      });

      const outLower = (adbRes.stdout || '').toLowerCase();
      const actuallyConnected = adbRes.exitCode === 0 && outLower.includes('connected to') && !outLower.includes('failed') && !outLower.includes('unable');

      if (actuallyConnected) {
        this.isConnected = true;
        const st = await this.getStatus();
        if (st.state !== 'ANDROID_READY') {
          this.isConnected = false;
          this.lastError = st.lastError || 'ANDROID_NOT_READY: ADB TCP connected but Android userspace/package manager did not respond.';
          this.lastFailureState = 'ANDROID_NOT_READY';
          return {
            success: false,
            message: this.lastError,
            status: await this.getStatus()
          };
        }
        this.config.connectedAt = new Date().toISOString();
        this.saveConfig({ connectedAt: this.config.connectedAt });
        return {
          success: true,
          message: `Connected and verified Android runtime at ADB target ${target} (Android ${st.androidVersion}, ABI ${st.architecture}).`,
          status: st
        };
      } else {
        this.isConnected = false;
        this.lastError = `REMOTE_HOST_DISCONNECTED: ${adbRes.stderr || adbRes.stdout || `Failed to connect to ${target}`}`.trim();
        this.lastFailureState = 'REMOTE_HOST_DISCONNECTED';
        const st = await this.getStatus();
        return {
          success: false,
          message: `ADB Connection rejected: ${this.lastError}`,
          status: st
        };
      }
    }

    // Default REST_TLS or COMPANION protocol
    try {
      const statusData = await this.performScopedRequest('GET', '/api/android/remote/status');
      if (!statusData || (statusData.ready === undefined && statusData.state === undefined)) {
        this.isConnected = false;
        this.lastError = 'ANDROID_NOT_READY: Remote host returned invalid status payload';
        this.lastFailureState = 'ANDROID_NOT_READY';
        const st = await this.getStatus();
        return {
          success: false,
          message: this.lastError,
          status: st
        };
      }

      if (statusData.ready === false || statusData.state === 'HOST_RUNTIME_UNAVAILABLE' || statusData.state === 'RUNTIME_STOPPED' || statusData.state === 'LOCAL_RUNTIME_UNSUPPORTED') {
        this.isConnected = false;
        this.lastError = `HOST_RUNTIME_UNAVAILABLE: ${statusData.reason || statusData.error || 'Remote host agent reports Android runtime is unavailable or stopped.'}`;
        this.lastFailureState = 'HOST_RUNTIME_UNAVAILABLE';
        const st = await this.getStatus();
        return {
          success: false,
          message: this.lastError,
          status: st
        };
      }

      this.isConnected = true;
      this.cachedVersion = statusData.androidVersion || null;
      this.cachedArch = statusData.architecture || null;

      // Independently verify version, ABI, and package manager readiness before claiming ANDROID_READY
      const st = await this.getStatus();
      if (st.state !== 'ANDROID_READY') {
        this.isConnected = false;
        this.lastError = st.lastError || 'ANDROID_NOT_READY: Connected to host agent, but Android version/ABI/Package Manager verification failed.';
        this.lastFailureState = 'ANDROID_NOT_READY';
        return {
          success: false,
          message: this.lastError,
          status: await this.getStatus()
        };
      }

      this.config.connectedAt = new Date().toISOString();
      this.saveConfig({ connectedAt: this.config.connectedAt });
      return {
        success: true,
        message: `Successfully connected and verified remote Android runtime at ${this.config.endpointUrl || this.config.host} (Android ${st.androidVersion}, ABI ${st.architecture})`,
        status: st
      };
    } catch (err: any) {
      this.isConnected = false;
      const errMsg = err.message || 'Connection refused or TLS handshake failed';
      if (errMsg.includes('HTTP 401') || errMsg.includes('HTTP 403') || errMsg.toLowerCase().includes('unauthorized')) {
        this.lastError = `AUTHENTICATION_FAILED: ${errMsg}`;
        this.lastFailureState = 'AUTHENTICATION_FAILED';
      } else {
        this.lastError = `REMOTE_HOST_DISCONNECTED: ${errMsg}`;
        this.lastFailureState = 'REMOTE_HOST_DISCONNECTED';
      }
      const st = await this.getStatus();
      return {
        success: false,
        message: `Remote connection error: ${this.lastError}`,
        status: st
      };
    }
  }

  public async disconnect(): Promise<{ success: boolean; message: string }> {
    this.isConnected = false;
    this.cachedVersion = null;
    this.cachedArch = null;
    this.lastError = null;
    this.lastFailureState = 'REMOTE_HOST_DISCONNECTED';
    this.config.connectedAt = undefined;
    if (this.isConfigured) {
      this.saveConfig({ connectedAt: undefined });
    }

    if (this.config.mode === 'ADB_TCP' && this.config.adbTarget) {
      await ProcessExecutor.execute({
        executable: 'adb',
        args: ['disconnect', this.config.adbTarget],
        timeoutMs: 4000
      });
    }

    return {
      success: true,
      message: 'Remote Android runtime disconnected.'
    };
  }

  public async checkPackageManagerReady(): Promise<{ ready: boolean; packages: string[]; error?: string }> {
    if (!this.isConnected) {
      return { ready: false, packages: [], error: 'Runtime not connected' };
    }

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'pm', 'list', 'packages']
        : ['shell', 'pm', 'list', 'packages'];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 6000 });
      if (res.exitCode === 0 && (res.stdout.includes('package:') || res.stdout.trim().length > 0)) {
        const pkgs = res.stdout
          .split('\n')
          .map(l => l.replace(/^package:/i, '').trim())
          .filter(Boolean);
        return { ready: true, packages: pkgs };
      }
      return { ready: false, packages: [], error: res.stderr || res.stdout || 'pm list packages failed' };
    }

    try {
      const data = await this.performScopedRequest('GET', '/api/android/remote/packages');
      if (data && Array.isArray(data.packages) && data.packageManagerReady !== false) {
        return { ready: true, packages: data.packages };
      }
      return { ready: false, packages: [], error: data?.error || 'Package manager did not return valid packages array' };
    } catch (e: any) {
      return { ready: false, packages: [], error: e.message };
    }
  }

  /**
   * Queries authoritative status of remote runtime
   */
  public async getStatus(): Promise<RemoteRuntimeStatus> {
    const localSupport = this.getLocalHostSupport();
    const configured = this.hasConfiguration();
    const endpoint = configured
      ? (this.config.endpointUrl || this.config.adbTarget || `${this.config.host}:${this.config.port}`)
      : 'UNCONFIGURED';

    if (!this.isConnected) {
      let disconnectedState: AndroidRuntimeState = localSupport.supported ? 'LOCAL_RUNTIME_MISSING' : 'LOCAL_RUNTIME_UNSUPPORTED';
      if (this.lastFailureState) {
        disconnectedState = this.lastFailureState;
      } else if (configured) {
        disconnectedState = 'REMOTE_HOST_DISCONNECTED';
      }

      return {
        state: disconnectedState,
        connected: false,
        configured,
        mode: configured ? this.config.mode : 'NONE',
        endpoint,
        androidVersion: null,
        architecture: null,
        packageManagerReady: false,
        lastError: this.lastError,
        lastChecked: this.lastChecked,
        localSupport
      };
    }

    try {
      const ver = await this.getAndroidVersion();
      const arch = await this.getArchitecture();
      const pmCheck = await this.checkPackageManagerReady();

      const pmReady = pmCheck.ready;
      const state: AndroidRuntimeState = (ver && arch && pmReady)
        ? 'ANDROID_READY'
        : (ver ? 'DEGRADED' : 'ANDROID_NOT_READY');

      return {
        state,
        connected: true,
        configured,
        mode: this.config.mode,
        endpoint,
        androidVersion: ver,
        architecture: arch,
        packageManagerReady: pmReady,
        packagesCount: pmCheck.packages.length,
        lastError: pmReady ? null : (pmCheck.error || 'Package manager not ready'),
        lastChecked: new Date().toISOString(),
        localSupport
      };
    } catch (err: any) {
      this.isConnected = false;
      this.lastError = err.message;
      this.lastFailureState = 'REMOTE_HOST_DISCONNECTED';
      return {
        state: 'REMOTE_HOST_DISCONNECTED',
        connected: false,
        configured,
        mode: this.config.mode,
        endpoint,
        androidVersion: null,
        architecture: null,
        packageManagerReady: false,
        lastError: this.lastError,
        lastChecked: new Date().toISOString(),
        localSupport
      };
    }
  }

  public async getAndroidVersion(): Promise<string | null> {
    if (!this.isConnected) return null;

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'getprop', 'ro.build.version.release']
        : ['shell', 'getprop', 'ro.build.version.release'];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
      if (res.exitCode === 0 && res.stdout.trim()) {
        this.cachedVersion = res.stdout.trim();
        return this.cachedVersion;
      }
      return null;
    }

    try {
      const data = await this.performScopedRequest('GET', '/api/android/remote/version');
      this.cachedVersion = data.androidVersion || data.version || null;
      return this.cachedVersion;
    } catch {
      return null;
    }
  }

  public async getArchitecture(): Promise<string | null> {
    if (!this.isConnected) return null;

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'getprop', 'ro.product.cpu.abi']
        : ['shell', 'getprop', 'ro.product.cpu.abi'];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
      if (res.exitCode === 0 && res.stdout.trim()) {
        this.cachedArch = res.stdout.trim();
        return this.cachedArch;
      }
      return null;
    }

    try {
      const data = await this.performScopedRequest('GET', '/api/android/remote/arch');
      this.cachedArch = data.architecture || data.abi || null;
      return this.cachedArch;
    } catch {
      return null;
    }
  }

  public async listPackages(): Promise<string[]> {
    const check = await this.checkPackageManagerReady();
    return check.packages;
  }

  public async transferApk(apkPath: string): Promise<{ success: boolean; localHash: string; remoteHash: string; sizeBytes: number; error?: string }> {
    const resolvedPath = path.resolve(apkPath);
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, localHash: '', remoteHash: '', sizeBytes: 0, error: `APK_INVALID: File not found at ${resolvedPath}` };
    }
    const fileBuffer = fs.readFileSync(resolvedPath);
    if (fileBuffer.length < 4 || fileBuffer[0] !== 0x50 || fileBuffer[1] !== 0x4b) {
      return { success: false, localHash: '', remoteHash: '', sizeBytes: fileBuffer.length, error: 'APK_INVALID: File does not have valid ZIP/APK magic bytes' };
    }
    const localHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (!this.isConnected) {
      return { success: false, localHash, remoteHash: '', sizeBytes: fileBuffer.length, error: 'REMOTE_HOST_DISCONNECTED: Cannot transfer APK while disconnected' };
    }

    try {
      if (this.config.mode === 'ADB_TCP') {
        const target = this.config.adbTarget;
        const pushArgs = target
          ? ['-s', target, 'push', resolvedPath, '/data/local/tmp/TestAPK.apk']
          : ['push', resolvedPath, '/data/local/tmp/TestAPK.apk'];
        const pushRes = await ProcessExecutor.execute({ executable: 'adb', args: pushArgs, timeoutMs: 15000 });
        if (pushRes.exitCode !== 0) {
          return { success: false, localHash, remoteHash: '', sizeBytes: fileBuffer.length, error: `TRANSFER_INTERRUPTED: ${pushRes.stderr || pushRes.stdout}` };
        }
        const shArgs = target
          ? ['-s', target, 'shell', 'sha256sum', '/data/local/tmp/TestAPK.apk']
          : ['shell', 'sha256sum', '/data/local/tmp/TestAPK.apk'];
        const shRes = await ProcessExecutor.execute({ executable: 'adb', args: shArgs, timeoutMs: 5000 });
        const remoteHash = (shRes.stdout.split(/\s+/)[0] || '').toLowerCase();
        if (remoteHash !== localHash) {
          return { success: false, localHash, remoteHash, sizeBytes: fileBuffer.length, error: `HASH_MISMATCH: local=${localHash}, remote=${remoteHash}` };
        }
        return { success: true, localHash, remoteHash, sizeBytes: fileBuffer.length };
      } else {
        const transferRes = await this.performScopedRequest('POST', '/api/android/remote/transfer', {
          filename: path.basename(resolvedPath),
          sha256: localHash,
          sizeBytes: fileBuffer.length,
          dataBase64: fileBuffer.toString('base64')
        });
        if (!transferRes || !transferRes.success) {
          return {
            success: false,
            localHash,
            remoteHash: transferRes?.sha256 || '',
            sizeBytes: fileBuffer.length,
            error: transferRes?.error || 'TRANSFER_INTERRUPTED: Remote transfer failed'
          };
        }
        const remoteHash = (transferRes.sha256 || '').toLowerCase();
        if (remoteHash !== localHash) {
          return {
            success: false,
            localHash,
            remoteHash,
            sizeBytes: fileBuffer.length,
            error: `HASH_MISMATCH: local=${localHash}, remote=${remoteHash}`
          };
        }
        return { success: true, localHash, remoteHash, sizeBytes: fileBuffer.length };
      }
    } catch (e: any) {
      return { success: false, localHash, remoteHash: '', sizeBytes: fileBuffer.length, error: `TRANSFER_INTERRUPTED: ${e.message}` };
    }
  }

  public async installApk(apkPath: string): Promise<InstallResult> {
    const resolvedPath = path.resolve(apkPath);
    if (!fs.existsSync(resolvedPath)) {
      return {
        success: false,
        stage: 'VALIDATION',
        errorCode: 'APK_NOT_FOUND',
        message: `APK file not found at ${resolvedPath}`
      };
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    if (fileBuffer.length < 4 || fileBuffer[0] !== 0x50 || fileBuffer[1] !== 0x4b) {
      return {
        success: false,
        stage: 'VALIDATION',
        errorCode: 'APK_INVALID',
        message: 'APK_INVALID: Corrupt or invalid ZIP/APK header'
      };
    }

    if (!this.isConnected) {
      return {
        success: false,
        stage: 'RUNTIME_CHECK',
        errorCode: 'ANDROID_RUNTIME_UNAVAILABLE',
        message: 'REMOTE_HOST_DISCONNECTED: No connected Android runtime for installation'
      };
    }

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'install', '-r', resolvedPath]
        : ['install', '-r', resolvedPath];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 25000 });
      const pass = res.exitCode === 0 && res.stdout.toLowerCase().includes('success');
      return {
        success: pass,
        stage: 'INSTALL',
        errorCode: pass ? undefined : 'INSTALL_FAILED',
        message: pass ? 'APK installed successfully via remote ADB.' : (res.stderr || res.stdout || 'ADB installation failed')
      };
    }

    // REST_TLS / Scoped API transfer & install
    try {
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const filename = path.basename(resolvedPath);

      const res = await this.performScopedRequest('POST', '/api/android/remote/packages/install', {
        filename,
        sha256,
        sizeBytes: fileBuffer.length,
        dataBase64: fileBuffer.toString('base64')
      });

      const pass = !!res.success;
      return {
        success: pass,
        stage: 'INSTALL',
        errorCode: pass ? undefined : (res.errorCode || 'INSTALL_FAILED'),
        packageName: res.packageName,
        message: res.message || res.error || (pass ? 'Remote install complete' : 'INSTALL_FAILED: Remote install rejected')
      };
    } catch (err: any) {
      return {
        success: false,
        stage: 'INSTALL',
        errorCode: 'INSTALL_FAILED',
        message: `INSTALL_FAILED: ${err.message}`
      };
    }
  }

  public async verifyPackage(packageName: string): Promise<boolean> {
    if (!packageName || !this.isConnected) return false;

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'pm', 'path', packageName]
        : ['shell', 'pm', 'path', packageName];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 5000 });
      return res.exitCode === 0 && res.stdout.trim().startsWith('package:');
    }

    try {
      const data = await this.performScopedRequest('GET', `/api/android/remote/packages/verify/${encodeURIComponent(packageName)}`);
      return !!(data && (data.verified || data.installed));
    } catch {
      return false;
    }
  }

  public async launchPackage(packageName: string): Promise<{ success: boolean; message: string; pid?: number }> {
    if (!packageName) return { success: false, message: 'Package name required' };
    if (!this.isConnected) return { success: false, message: 'REMOTE_HOST_DISCONNECTED: Runtime not connected' };

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']
        : ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 6000 });
      const success = res.exitCode === 0 && !res.stdout.includes('No activities found') && !res.stdout.includes('monkey aborted');
      return {
        success,
        message: success ? `Launched ${packageName}` : (res.stderr || res.stdout || 'APP_LAUNCH_FAILED')
      };
    }

    try {
      const res = await this.performScopedRequest('POST', '/api/android/remote/packages/launch', { packageName });
      return {
        success: !!res.success,
        pid: res.pid,
        message: res.message || res.error || (res.success ? `Launched ${packageName}` : 'APP_LAUNCH_FAILED')
      };
    } catch (err: any) {
      return { success: false, message: `APP_LAUNCH_FAILED: ${err.message}` };
    }
  }

  public async stopPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected) return { success: false, message: 'REMOTE_HOST_DISCONNECTED' };

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'shell', 'am', 'force-stop', packageName]
        : ['shell', 'am', 'force-stop', packageName];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 5000 });
      return {
        success: res.exitCode === 0,
        message: res.exitCode === 0 ? `Stopped ${packageName}` : res.stderr
      };
    }

    try {
      const res = await this.performScopedRequest('POST', '/api/android/remote/packages/stop', { packageName });
      return { success: !!res.success, message: res.message || 'Stopped' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  public async uninstallPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    if (!this.isConnected) return { success: false, message: 'REMOTE_HOST_DISCONNECTED' };

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'uninstall', packageName]
        : ['uninstall', packageName];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 12000 });
      const success = res.exitCode === 0 && res.stdout.toLowerCase().includes('success');
      return {
        success,
        message: success ? `Uninstalled ${packageName}` : (res.stderr || res.stdout)
      };
    }

    try {
      const res = await this.performScopedRequest('POST', '/api/android/remote/packages/uninstall', { packageName });
      return { success: !!res.success, message: res.message || 'Uninstalled' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  public async getLogs(lines = 50): Promise<string[]> {
    if (!this.isConnected) return [];

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'logcat', '-d', '-t', String(lines)]
        : ['logcat', '-d', '-t', String(lines)];
      const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 5000 });
      return res.stdout.split('\n').filter(Boolean);
    }

    try {
      const data = await this.performScopedRequest('GET', `/api/android/remote/logs?lines=${lines}`);
      return Array.isArray(data.logs) ? data.logs : [];
    } catch {
      return [];
    }
  }

  /**
   * Canonical 7-Stage Acceptance Test with TestAPK.apk
   */
  public async runTestApkAcceptance(customApkPath?: string): Promise<TestApkAcceptanceReport> {
    const apkPath = customApkPath || (fs.existsSync(CANONICAL_TEST_APK) ? CANONICAL_TEST_APK : CANONICAL_TEST_APK_FALLBACK);
    const packageName = 'com.example.testapk';
    const steps: TestApkStepResult[] = [];

    if (!fs.existsSync(apkPath)) {
      return {
        timestamp: new Date().toISOString(),
        apkPath,
        sha256: 'MISSING',
        fileSize: 0,
        packageName,
        steps: [{
          step: 1,
          name: 'Locate TestAPK.apk',
          passed: false,
          status: 'FAIL',
          details: `Canonical TestAPK not found at ${apkPath}`,
          durationMs: 0,
          error: 'APK_INVALID'
        }],
        allPassed: false,
        verdict: 'FAIL',
        reason: `APK_INVALID: Canonical smoke-test APK missing from filesystem at ${apkPath}`,
        rawEvidence: 'fs.existsSync(apkPath) === false'
      };
    }

    const apkBuffer = fs.readFileSync(apkPath);
    if (apkBuffer.length < 4 || apkBuffer[0] !== 0x50 || apkBuffer[1] !== 0x4b) {
      return {
        timestamp: new Date().toISOString(),
        apkPath,
        sha256: 'INVALID',
        fileSize: apkBuffer.length,
        packageName,
        steps: [{
          step: 1,
          name: 'Validate APK Format',
          passed: false,
          status: 'FAIL',
          details: `Invalid ZIP/APK magic header at ${apkPath}`,
          durationMs: 0,
          error: 'APK_INVALID'
        }],
        allPassed: false,
        verdict: 'FAIL',
        reason: `APK_INVALID: Corrupt APK header at ${apkPath}`,
        rawEvidence: 'Missing PK\\x03\\x04 magic bytes'
      };
    }

    const localHash = crypto.createHash('sha256').update(apkBuffer).digest('hex');
    const fileSize = apkBuffer.length;

    const status = await this.getStatus();
    if (!status.connected || status.state !== 'ANDROID_READY') {
      const blockerCode = !this.hasConfiguration()
        ? 'REMOTE_HOST_NOT_CONFIGURED'
        : (status.state === 'AUTHENTICATION_FAILED' ? 'AUTHENTICATION_FAILED' : 'REMOTE_HOST_DISCONNECTED');
      return {
        timestamp: new Date().toISOString(),
        apkPath,
        sha256: localHash,
        fileSize,
        packageName,
        steps: [{
          step: 1,
          name: 'Verify Runtime Reachability',
          passed: false,
          status: 'BLOCKED',
          details: `${blockerCode}: ${status.lastError || status.localSupport.reason}`,
          durationMs: 0,
          error: blockerCode
        }],
        allPassed: false,
        verdict: 'BLOCKED',
        reason: `${blockerCode}: Android runtime offline. Connect an authorized external Android runtime to run TestAPK acceptance tests.`,
        rawEvidence: status.lastError || status.localSupport.reason
      };
    }

    // Step 1 & 2: Transfer TestAPK.apk & Verify SHA-256 hash
    const t1 = Date.now();
    const transferRes = await this.transferApk(apkPath);
    const transferPassed = transferRes.success || (transferRes.error?.startsWith('HASH_MISMATCH') ?? false);
    const hashVerified = transferRes.success && transferRes.remoteHash === localHash;

    steps.push({
      step: 1,
      name: 'Transfer TestAPK.apk to Runtime',
      passed: transferPassed && !transferRes.error?.startsWith('TRANSFER_INTERRUPTED'),
      status: (transferPassed && !transferRes.error?.startsWith('TRANSFER_INTERRUPTED')) ? 'PASS' : 'FAIL',
      details: (transferPassed && !transferRes.error?.startsWith('TRANSFER_INTERRUPTED'))
        ? `Transferred ${fileSize} bytes to runtime sandbox`
        : (transferRes.error || 'TRANSFER_INTERRUPTED'),
      durationMs: Date.now() - t1,
      error: transferRes.error
    });

    steps.push({
      step: 2,
      name: 'Verify Cryptographic Hash (SHA-256)',
      passed: hashVerified,
      status: hashVerified ? 'PASS' : 'FAIL',
      details: hashVerified
        ? `Cryptographic match confirmed: ${localHash}`
        : (transferRes.error || `HASH_MISMATCH: local=${localHash}, remote=${transferRes.remoteHash}`),
      durationMs: 1,
      error: hashVerified ? undefined : 'HASH_MISMATCH'
    });

    if (!hashVerified) {
      return {
        timestamp: new Date().toISOString(),
        apkPath,
        sha256: localHash,
        fileSize,
        packageName,
        steps,
        allPassed: false,
        verdict: 'FAIL',
        reason: transferRes.error || 'HASH_MISMATCH',
        rawEvidence: JSON.stringify(steps)
      };
    }

    // Step 3: Install via actual Android Package Manager
    const t3 = Date.now();
    const installRes = await this.installApk(apkPath);
    steps.push({
      step: 3,
      name: 'Install Package via Android Package Manager',
      passed: installRes.success,
      status: installRes.success ? 'PASS' : 'FAIL',
      details: installRes.message,
      durationMs: Date.now() - t3,
      error: installRes.success ? undefined : 'INSTALL_FAILED'
    });

    // Step 4: Independent Package Verification
    const t4 = Date.now();
    const verified = installRes.success ? await this.verifyPackage(packageName) : false;
    steps.push({
      step: 4,
      name: 'Independent Package Verification (pm query)',
      passed: verified,
      status: verified ? 'PASS' : 'FAIL',
      details: verified
        ? `Package ${packageName} confirmed in authoritative package manager`
        : `PACKAGE_VERIFICATION_FAILED: Package ${packageName} not found in independent pm query`,
      durationMs: Date.now() - t4,
      error: verified ? undefined : 'PACKAGE_VERIFICATION_FAILED'
    });

    // Step 5: Launch Application
    const t5 = Date.now();
    let launchSuccess = false;
    let launchMsg = '';
    if (verified) {
      const lRes = await this.launchPackage(packageName);
      launchSuccess = lRes.success;
      launchMsg = lRes.message;
    } else {
      launchMsg = 'Skipped launch due to unverified package installation';
    }
    steps.push({
      step: 5,
      name: 'Launch Application (ActivityManager)',
      passed: launchSuccess,
      status: launchSuccess ? 'PASS' : 'FAIL',
      details: launchMsg,
      durationMs: Date.now() - t5,
      error: launchSuccess ? undefined : 'APP_LAUNCH_FAILED'
    });

    // Step 6: Verify Process and Activity State
    const t6 = Date.now();
    let procActive = false;
    let procDetails = 'Process not started';
    if (launchSuccess) {
      const procState = await this.getPackageProcessState(packageName);
      procActive = procState.running;
      procDetails = procActive ? `PID: ${procState.pid || 'ACTIVE'}` : 'APP_LAUNCH_FAILED: Process not running after launch';
    }
    steps.push({
      step: 6,
      name: 'Verify Process & Activity Runtime State',
      passed: procActive,
      status: procActive ? 'PASS' : 'FAIL',
      details: procDetails,
      durationMs: Date.now() - t6,
      error: procActive ? undefined : 'APP_LAUNCH_FAILED'
    });

    const allPassed = steps.every(s => s.passed);
    const firstFailed = steps.find(s => !s.passed);
    return {
      timestamp: new Date().toISOString(),
      apkPath,
      sha256: localHash,
      fileSize,
      packageName,
      steps,
      allPassed,
      verdict: allPassed ? 'PASS' : 'FAIL',
      reason: allPassed
        ? 'All acceptance stages verified independently on connected Android runtime.'
        : `${firstFailed?.error || 'FAIL'}: ${firstFailed?.details || 'Acceptance verification failed'}`,
      rawEvidence: JSON.stringify(steps)
    };
  }

  /**
   * Display Frame pipeline
   */
  public async fetchDisplayFrame(): Promise<Buffer | null> {
    if (!this.isConnected) return null;

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const args = target
        ? ['-s', target, 'exec-out', 'screencap', '-p']
        : ['exec-out', 'screencap', '-p'];
      const res = await ProcessExecutor.execute({
        executable: 'adb',
        args,
        encoding: 'buffer',
        timeoutMs: 4000
      });
      if (res.exitCode === 0 && res.stdout) {
        return Buffer.from(res.stdout, 'latin1');
      }
      return null;
    }

    try {
      const frameData = await this.performScopedRequest('GET', '/api/android/remote/frame');
      if (frameData && frameData.dataBase64) {
        return Buffer.from(frameData.dataBase64, 'base64');
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Input Forwarding pipeline
   */
  public async sendInput(event: RemoteAndroidInputEvent): Promise<void> {
    if (!this.isConnected) throw new Error('REMOTE_HOST_DISCONNECTED: Adapter disconnected');

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      let args: string[] = [];
      if (event.type === 'tap' && event.x !== undefined && event.y !== undefined) {
        args = ['shell', 'input', 'tap', String(Math.round(event.x)), String(Math.round(event.y))];
      } else if (event.type === 'swipe' && event.x !== undefined && event.y !== undefined && event.toX !== undefined && event.toY !== undefined) {
        args = ['shell', 'input', 'swipe', String(Math.round(event.x)), String(Math.round(event.y)), String(Math.round(event.toX)), String(Math.round(event.toY)), String(event.durationMs || 300)];
      } else if (event.type === 'text' && event.text) {
        args = ['shell', 'input', 'text', event.text.replace(/[^a-zA-Z0-9_-]/g, '')];
      } else if (event.type === 'key' && event.keyCode) {
        args = ['shell', 'input', 'keyevent', String(event.keyCode)];
      } else if (event.type === 'back') {
        args = ['shell', 'input', 'keyevent', '4'];
      } else if (event.type === 'home') {
        args = ['shell', 'input', 'keyevent', '3'];
      }

      if (args.length > 0) {
        const fullArgs = target ? ['-s', target, ...args] : args;
        const res = await ProcessExecutor.execute({ executable: 'adb', args: fullArgs, timeoutMs: 3000 });
        if (res.exitCode !== 0) throw new Error(`ADB input failed: ${res.stderr}`);
        return;
      }
      throw new Error('Unsupported input type');
    }

    const res = await this.performScopedRequest('POST', '/api/android/remote/input', { event });
    if (!res || !res.success) throw new Error(res?.error || 'Remote input forwarding failed');
  }

  // --- AndroidRuntimeAdapter Interface Implementation ---

  async detect(): Promise<AndroidRuntimeStatus> {
    const st = await this.getStatus();
    const kernel = os.release() || '';
    const isReady = st.connected && st.state === 'ANDROID_READY';
    return {
      status: isReady ? 'AVAILABLE' : (st.localSupport.supported ? 'MISSING' : 'UNSUPPORTED'),
      runtime: st.state,
      authoritativeState: st.state,
      execution: isReady ? 'REAL' : 'UNSUPPORTED',
      runtimeType: 'Remote/ADB',
      installed: st.connected,
      executable: st.mode,
      version: st.androidVersion,
      androidVersion: st.androidVersion,
      container: isReady ? 'RUNNING' : 'UNAVAILABLE',
      session: isReady ? 'RUNNING' : 'UNAVAILABLE',
      ready: isReady,
      reason: isReady ? `Connected to ${st.endpoint}` : (st.lastError || st.localSupport.reason),
      hostOs: 'Linux (Remote Bridge)',
      kernel,
      architecture: st.architecture || process.arch,
      backendUser: 'remote-agent',
      backendPath: st.endpoint,
      lastDetected: st.lastChecked,
      lastError: st.lastError,
      capabilities: {
        isLinux: true,
        isGvisor: st.localSupport.isGvisor,
        hasBinder: isReady,
        hasWayland: false,
        hasSystemd: false
      },
      supportedAbis: [st.architecture || 'x86_64']
    };
  }

  async version(): Promise<string | null> {
    return this.getAndroidVersion();
  }

  async capabilities(): Promise<Record<string, boolean>> {
    const st = await this.getStatus();
    return {
      connected: st.connected,
      packageManagerReady: st.packageManagerReady,
      isGvisor: st.localSupport.isGvisor
    };
  }

  async initialize(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const res = await this.connect();
    return {
      success: res.success,
      stdout: res.message,
      stderr: res.status.lastError || '',
      exitCode: res.success ? 0 : 1
    };
  }

  async start(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    return this.initialize();
  }

  async stop(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const res = await this.disconnect();
    return {
      success: res.success,
      stdout: res.message,
      stderr: '',
      exitCode: 0
    };
  }

  async status(): Promise<AndroidRuntimeStatus> {
    return this.detect();
  }

  async ready(): Promise<boolean> {
    const st = await this.getStatus();
    return st.connected && st.state === 'ANDROID_READY';
  }

  async waitUntilReady(timeoutMs = 10000): Promise<{ ready: boolean; elapsedMs: number; reason: string }> {
    const start = Date.now();
    const st = await this.getStatus();
    return {
      ready: st.connected && st.state === 'ANDROID_READY',
      elapsedMs: Date.now() - start,
      reason: st.state === 'ANDROID_READY' ? 'Remote Android runtime ready' : (st.lastError || st.localSupport.reason)
    };
  }

  async shell(args: string[], timeoutMs = 8000): Promise<ProcessExecutionResult> {
    if (this.config.mode === 'ADB_TCP' && this.isConnected) {
      const target = this.config.adbTarget;
      const fullArgs = target ? ['-s', target, 'shell', ...args] : ['shell', ...args];
      return ProcessExecutor.execute({ executable: 'adb', args: fullArgs, timeoutMs });
    }

    return {
      executable: 'remote-bridge',
      arguments: args,
      cwd: '/remote',
      environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' },
      exitCode: 126,
      stdout: '',
      stderr: 'Arbitrary shell execution blocked by Remote Security Policy. Use scoped endpoints.',
      signal: null,
      timedOut: false,
      durationMs: 0
    };
  }

  async checkHealth(apkPath?: string): Promise<AndroidRuntimeHealth> {
    const st = await this.getStatus();
    const isReady = st.connected && st.state === 'ANDROID_READY';
    return {
      runtime: 'Remote/ADB',
      installed: st.connected,
      container: isReady ? 'running' : 'unavailable',
      session: isReady ? 'running' : 'unavailable',
      androidBoot: isReady ? 'complete' : 'incomplete',
      packageManager: st.packageManagerReady ? 'ready' : 'unreachable',
      ready: isReady,
      hostPass: st.localSupport.supported || isReady,
      runtimePass: isReady,
      containerPass: isReady,
      sessionPass: isReady,
      androidBootPass: isReady,
      packageManagerPass: st.packageManagerReady,
      apkPass: apkPath ? fs.existsSync(apkPath) : true,
      installPass: isReady,
      launchPass: isReady,
      firstFailure: isReady ? 'NONE' : st.state,
      rawEvidence: isReady ? `Connected (${st.androidVersion || 'Android'})` : (st.lastError || st.localSupport.reason),
      rootCause: isReady ? 'NONE' : st.state,
      fix: 'Connect external Android runtime via Remote Runtime Adapter'
    };
  }

  async getPackageProcessState(packageName: string): Promise<{ running: boolean; pid?: number }> {
    if (!packageName || !this.isConnected) {
      return { running: false };
    }

    if (this.config.mode === 'ADB_TCP') {
      const target = this.config.adbTarget;
      const pidArgs = target
        ? ['-s', target, 'shell', 'pidof', packageName]
        : ['shell', 'pidof', packageName];
      const pidRes = await ProcessExecutor.execute({ executable: 'adb', args: pidArgs, timeoutMs: 3000 });
      const pidStr = pidRes.stdout.trim().split(/\s+/)[0];
      const pid = pidStr ? parseInt(pidStr, 10) : NaN;
      if (pidRes.exitCode === 0 && !isNaN(pid) && pid > 0) {
        return { running: true, pid };
      }
      return { running: false };
    }

    try {
      const procRes = await this.performScopedRequest('GET', `/api/android/remote/process/${encodeURIComponent(packageName)}`);
      if (procRes && procRes.running) {
        return { running: true, pid: typeof procRes.pid === 'number' ? procRes.pid : undefined };
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }

  async getPackagePermissions(packageName: string): Promise<Record<string, 'GRANTED' | 'DENIED' | 'UNREQUESTED'>> {
    return {};
  }

  async setPackagePermission(packageName: string, permission: string, grant: boolean): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Remote permission control not implemented on this target' };
  }

  async getLaunchComponent(packageName: string): Promise<string | null> {
    return `${packageName}/.MainActivity`;
  }

  async logs(lines?: number): Promise<string[]> {
    return this.getLogs(lines);
  }

  async reconcile(): Promise<{ ready: boolean; installedPackages: string[] }> {
    const isReady = await this.ready();
    if (!isReady) {
      return { ready: false, installedPackages: [] };
    }
    const pkgs = await this.listPackages();
    return { ready: true, installedPackages: pkgs };
  }

  public async getDisplayFrame(): Promise<Buffer> {
    const buf = await this.fetchDisplayFrame();
    if (!buf || buf.length === 0) {
      throw new Error('DISPLAY_STREAM_UNAVAILABLE: No display frame returned from runtime');
    }
    return buf;
  }

  // --- Network Helper ---

  private async performScopedRequest(method: string, endpointPath: string, payload?: any): Promise<any> {
    const baseUrl = this.config.endpointUrl || `${this.config.tlsEnabled ? 'https' : 'http'}://${this.config.host}:${this.config.port}`;
    const urlObj = new URL(endpointPath, baseUrl);

    return new Promise((resolve, reject) => {
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const bodyData = payload ? JSON.stringify(payload) : null;
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };

      if (bodyData) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(bodyData));
      }

      if (this.config.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      }

      const req = client.request(urlObj, {
        method,
        headers,
        timeout: 10000,
        rejectUnauthorized: this.config.tlsEnabled !== false
      }, (res) => {
        let responseText = '';
        res.on('data', chunk => { responseText += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(responseText));
            } catch {
              resolve({ raw: responseText });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseText.slice(0, 200)}`));
          }
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }
}

export const remoteAndroidAdapter = new RemoteAndroidAdapter();
