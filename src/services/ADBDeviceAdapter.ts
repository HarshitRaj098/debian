import fs from 'fs';
import path from 'path';
import { ProcessExecutor, ProcessExecutionResult } from './ProcessExecutor';
import { AndroidRuntimeAdapter, AndroidRuntimeHealth } from './AndroidRuntimeManager';
import { AndroidRuntimeStatus, RemoteAndroidInputEvent, InstallResult } from '../types/android';

export interface AdbDeviceItem {
  id: string;
  state: 'device' | 'unauthorized' | 'offline' | 'unknown';
  model?: string;
  product?: string;
  transportId?: string;
}

export class ADBDeviceAdapter implements AndroidRuntimeAdapter {
  type: AndroidRuntimeAdapter['type'] = 'ADB';

  private currentTarget: string | null = null;
  private isConnected = false;
  private lastError: string | null = null;

  constructor(target?: string) {
    if (target) {
      this.currentTarget = target;
    }
  }

  public setTarget(target: string | null): void {
    this.currentTarget = target;
  }

  public getTarget(): string | null {
    return this.currentTarget;
  }

  private getBaseArgs(): string[] {
    return this.currentTarget ? ['-s', this.currentTarget] : [];
  }

  public async listDevices(): Promise<AdbDeviceItem[]> {
    const res = await ProcessExecutor.execute({
      executable: 'adb',
      args: ['devices', '-l'],
      timeoutMs: 5000
    });

    if (res.exitCode !== 0) {
      return [];
    }

    const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    const devices: AdbDeviceItem[] = [];

    for (const line of lines) {
      if (line.startsWith('List of devices attached')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const id = parts[0];
      const state = (parts[1] as AdbDeviceItem['state']) || 'unknown';
      let model: string | undefined;
      let product: string | undefined;
      let transportId: string | undefined;

      for (let i = 2; i < parts.length; i++) {
        const item = parts[i];
        if (item.startsWith('model:')) model = item.replace('model:', '');
        if (item.startsWith('product:')) product = item.replace('product:', '');
        if (item.startsWith('transport_id:')) transportId = item.replace('transport_id:', '');
      }

      devices.push({ id, state, model, product, transportId });
    }

    return devices;
  }

  public async connect(target: string): Promise<{ success: boolean; message: string }> {
    this.currentTarget = target;
    const res = await ProcessExecutor.execute({
      executable: 'adb',
      args: ['connect', target],
      timeoutMs: 8000
    });

    const isConn = res.exitCode === 0 && res.stdout.toLowerCase().includes('connected');
    this.isConnected = isConn;
    this.lastError = isConn ? null : (res.stderr || res.stdout || 'ADB connection failed');

    return {
      success: isConn,
      message: isConn ? `Connected to ADB device ${target}` : `ADB connect failed: ${this.lastError}`
    };
  }

  public async disconnect(target?: string): Promise<{ success: boolean; message: string }> {
    const t = target || this.currentTarget;
    if (!t) return { success: true, message: 'No target specified to disconnect' };

    const res = await ProcessExecutor.execute({
      executable: 'adb',
      args: ['disconnect', t],
      timeoutMs: 4000
    });

    this.isConnected = false;
    this.currentTarget = null;
    return {
      success: res.exitCode === 0,
      message: `Disconnected from ${t}`
    };
  }

  public async getAndroidVersion(): Promise<string | null> {
    const args = [...this.getBaseArgs(), 'shell', 'getprop', 'ro.build.version.release'];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
    return res.exitCode === 0 && res.stdout.trim() ? res.stdout.trim() : null;
  }

  public async getDeviceModel(): Promise<string | null> {
    const args = [...this.getBaseArgs(), 'shell', 'getprop', 'ro.product.model'];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
    return res.exitCode === 0 && res.stdout.trim() ? res.stdout.trim() : null;
  }

  public async getArchitecture(): Promise<string | null> {
    const args = [...this.getBaseArgs(), 'shell', 'getprop', 'ro.product.cpu.abi'];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
    return res.exitCode === 0 && res.stdout.trim() ? res.stdout.trim() : null;
  }

  public async listPackages(): Promise<string[]> {
    const args = [...this.getBaseArgs(), 'shell', 'pm', 'list', 'packages'];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 6000 });
    if (res.exitCode !== 0) return [];
    return res.stdout
      .split('\n')
      .map(l => l.replace(/^package:/i, '').trim())
      .filter(Boolean);
  }

  public async installApk(apkPath: string): Promise<InstallResult> {
    const resolved = path.resolve(apkPath);
    if (!fs.existsSync(resolved)) {
      return {
        success: false,
        stage: 'VALIDATION',
        message: `APK file not found at ${resolved}`
      };
    }

    const args = [...this.getBaseArgs(), 'install', '-r', resolved];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 30000 });
    const success = res.exitCode === 0 && res.stdout.toLowerCase().includes('success');

    return {
      success,
      stage: 'INSTALL',
      message: success ? 'Package installed via ADB' : (res.stderr || res.stdout || 'ADB install failed')
    };
  }

  public async verifyPackage(packageName: string): Promise<boolean> {
    const args = [...this.getBaseArgs(), 'shell', 'pm', 'path', packageName];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
    return res.exitCode === 0 && res.stdout.trim().startsWith('package:');
  }

  public async launchPackage(packageName: string): Promise<{ success: boolean; message: string; pid?: number }> {
    const args = [...this.getBaseArgs(), 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 6000 });
    const success = res.exitCode === 0 && !res.stdout.includes('No activities found');

    let pid: number | undefined;
    if (success) {
      const pidRes = await ProcessExecutor.execute({
        executable: 'adb',
        args: [...this.getBaseArgs(), 'shell', 'pidof', packageName],
        timeoutMs: 3000
      });
      if (pidRes.exitCode === 0 && pidRes.stdout.trim()) {
        pid = parseInt(pidRes.stdout.trim(), 10);
      }
    }

    return {
      success,
      message: success ? `Launched ${packageName}` : (res.stderr || res.stdout || 'Launch failed'),
      pid
    };
  }

  public async stopPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    const args = [...this.getBaseArgs(), 'shell', 'am', 'force-stop', packageName];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 4000 });
    return {
      success: res.exitCode === 0,
      message: res.exitCode === 0 ? `Stopped ${packageName}` : res.stderr
    };
  }

  async getPackageProcessState(packageName: string): Promise<{ running: boolean; pid?: number }> {
    const args = [...this.getBaseArgs(), 'shell', 'pidof', packageName];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 3000 });
    const pid = res.exitCode === 0 && res.stdout.trim() ? parseInt(res.stdout.trim(), 10) : undefined;
    return { running: !!pid, pid };
  }

  async getPackagePermissions(packageName: string): Promise<Record<string, 'GRANTED' | 'DENIED' | 'UNREQUESTED'>> {
    return {};
  }

  async setPackagePermission(packageName: string, permission: string, grant: boolean): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not implemented' };
  }

  async getLaunchComponent(packageName: string): Promise<string | null> {
    return null;
  }



  async logs(lines?: number): Promise<string[]> {
    return this.getLogs(lines);
  }

  public async uninstallPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    const args = [...this.getBaseArgs(), 'uninstall', packageName];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 12000 });
    const success = res.exitCode === 0 && res.stdout.toLowerCase().includes('success');
    return {
      success,
      message: success ? `Uninstalled ${packageName}` : res.stderr
    };
  }

  public async captureScreen(): Promise<Buffer | null> {
    const args = [...this.getBaseArgs(), 'exec-out', 'screencap', '-p'];
    const res = await ProcessExecutor.execute({
      executable: 'adb',
      args,
      timeoutMs: 4000
    });
    if (res.exitCode === 0 && res.stdout) {
      return Buffer.from(res.stdout, 'binary');
    }
    return null;
  }

  public async sendInput(event: RemoteAndroidInputEvent): Promise<void> {
    let subArgs: string[] = [];

    if (event.type === 'tap' && event.x !== undefined && event.y !== undefined) {
      subArgs = ['input', 'tap', String(Math.round(event.x)), String(Math.round(event.y))];
    } else if (event.type === 'swipe' && event.x !== undefined && event.y !== undefined && event.toX !== undefined && event.toY !== undefined) {
      const dur = event.durationMs || 300;
      subArgs = ['input', 'swipe', String(Math.round(event.x)), String(Math.round(event.y)), String(Math.round(event.toX)), String(Math.round(event.toY)), String(dur)];
    } else if (event.type === 'text' && event.text) {
      subArgs = ['input', 'text', event.text.replace(/[^a-zA-Z0-9_-]/g, '')];
    } else if (event.type === 'key' && event.keyCode) {
      subArgs = ['input', 'keyevent', String(event.keyCode)];
    } else if (event.type === 'back') {
      subArgs = ['input', 'keyevent', '4'];
    } else if (event.type === 'home') {
      subArgs = ['input', 'keyevent', '3'];
    } else if (event.type === 'recents') {
      subArgs = ['input', 'keyevent', '187'];
    } else if (event.type === 'power') {
      subArgs = ['input', 'keyevent', '26'];
    } else if (event.type === 'volume_up') {
      subArgs = ['input', 'keyevent', '24'];
    } else if (event.type === 'volume_down') {
      subArgs = ['input', 'keyevent', '25'];
    }

    if (subArgs.length === 0) throw new Error('Unsupported input event');

    const fullArgs = [...this.getBaseArgs(), 'shell', ...subArgs];
    const res = await ProcessExecutor.execute({ executable: 'adb', args: fullArgs, timeoutMs: 3000 });
    if (res.exitCode !== 0) throw new Error(`Input failed: ${res.stderr}`);
  }

  public async getLogs(lines = 50): Promise<string[]> {
    const args = [...this.getBaseArgs(), 'logcat', '-d', '-t', String(lines)];
    const res = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 5000 });
    if (res.exitCode !== 0) return [];
    return res.stdout.split('\n').filter(Boolean);
  }

  // --- AndroidRuntimeAdapter Interface ---

  async detect(): Promise<AndroidRuntimeStatus> {
    const devices = await this.listDevices();
    const isOnline = devices.some(d => d.state === 'device');
    const ver = isOnline ? await this.getAndroidVersion() : null;
    const arch = isOnline ? await this.getArchitecture() : null;

    return {
      status: isOnline ? 'AVAILABLE' : 'MISSING',
      runtime: isOnline ? 'ANDROID_READY' : 'LOCAL_RUNTIME_MISSING',
      authoritativeState: isOnline ? 'ANDROID_READY' : 'LOCAL_RUNTIME_MISSING',
      execution: 'REAL',
      runtimeType: 'ADB Device',
      installed: true,
      executable: 'adb',
      version: ver,
      androidVersion: ver,
      container: isOnline ? 'RUNNING' : 'UNAVAILABLE',
      session: isOnline ? 'RUNNING' : 'UNAVAILABLE',
      ready: isOnline,
      reason: isOnline ? `Connected to ADB device (${devices.length} attached)` : 'No active ADB devices connected',
      hostOs: 'Android OS',
      kernel: 'Linux',
      architecture: arch || 'arm64-v8a',
      backendUser: 'shell',
      backendPath: '/system/bin/sh',
      lastDetected: new Date().toISOString(),
      lastError: this.lastError,
      capabilities: {
        isLinux: true,
        isGvisor: false,
        hasBinder: true,
        hasWayland: false,
        hasSystemd: false
      },
      supportedAbis: arch ? [arch] : ['arm64-v8a', 'armeabi-v7a']
    };
  }

  async version(): Promise<string | null> {
    return this.getAndroidVersion();
  }

  async capabilities(): Promise<Record<string, boolean>> {
    const devs = await this.listDevices();
    return {
      connected: devs.some(d => d.state === 'device'),
      adbPresent: true
    };
  }

  async initialize(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    return { success: true, stdout: 'ADB ready', stderr: '', exitCode: 0 };
  }

  async start(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    return { success: true, stdout: 'ADB started', stderr: '', exitCode: 0 };
  }

  async stop(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const res = await this.disconnect();
    return {
      success: res.success,
      stdout: res.message,
      stderr: '',
      exitCode: res.success ? 0 : 1
    };
  }

  async status(): Promise<AndroidRuntimeStatus> {
    return this.detect();
  }

  async ready(): Promise<boolean> {
    const devs = await this.listDevices();
    return devs.some(d => d.state === 'device');
  }

  async waitUntilReady(timeoutMs = 5000): Promise<{ ready: boolean; elapsedMs: number; reason: string }> {
    const start = Date.now();
    const isReady = await this.ready();
    return {
      ready: isReady,
      elapsedMs: Date.now() - start,
      reason: isReady ? 'ADB device ready' : 'No ADB device attached'
    };
  }

  async shell(args: string[], timeoutMs = 8000): Promise<ProcessExecutionResult> {
    const fullArgs = [...this.getBaseArgs(), 'shell', ...args];
    return ProcessExecutor.execute({ executable: 'adb', args: fullArgs, timeoutMs });
  }

  async checkHealth(): Promise<AndroidRuntimeHealth> {
    const isRdy = await this.ready();
    return {
      runtime: 'ADB',
      installed: true,
      container: isRdy ? 'RUNNING' : 'STOPPED',
      session: isRdy ? 'RUNNING' : 'STOPPED',
      androidBoot: isRdy ? 'READY' : 'BOOTING',
      packageManager: isRdy ? 'READY' : 'UNAVAILABLE',
      ready: isRdy,
      hostPass: true,
      runtimePass: isRdy,
      containerPass: isRdy,
      sessionPass: isRdy,
      androidBootPass: isRdy,
      packageManagerPass: isRdy,
      apkPass: isRdy,
      installPass: isRdy,
      launchPass: isRdy,
      firstFailure: isRdy ? 'NONE' : 'Device not found',
      rawEvidence: isRdy ? 'ADB Device Ready' : 'ADB Device Unavailable',
      rootCause: isRdy ? 'NONE' : 'ADB connection failure',
      fix: isRdy ? 'NONE' : 'Check USB/ADB connection'
    };
  }

  async getInstalledPackages(): Promise<string[]> {
    return this.listPackages();
  }

  async reconcile(): Promise<{ ready: boolean; installedPackages: string[] }> {
    const pkgs = await this.listPackages();
    return {
      ready: pkgs.length > 0,
      installedPackages: pkgs
    };
  }

  public async getDisplayFrame(): Promise<Buffer> {
    const res = await ProcessExecutor.execute({
      executable: 'adb',
      args: [...this.getBaseArgs(), 'shell', 'screencap', '-p'],
      timeoutMs: 5000
    });
    if (res.exitCode !== 0) throw new Error('Failed to capture screen via ADB');
    return Buffer.from(res.stdout, 'binary');
  }
}

export const adbDeviceAdapter = new ADBDeviceAdapter();
