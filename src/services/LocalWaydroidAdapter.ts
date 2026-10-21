import fs from 'fs';
import os from 'os';
import { ProcessExecutor, ProcessExecutionResult } from './ProcessExecutor';
import { AndroidRuntimeAdapter, AndroidRuntimeHealth } from './AndroidRuntimeManager';
import { AndroidRuntimeStatus, InstallResult, RemoteAndroidInputEvent } from '../types/android';

export class LocalWaydroidAdapter implements AndroidRuntimeAdapter {
  type: AndroidRuntimeAdapter['type'] = 'WAYDROID';

  private isGvisorKernel(): boolean {
    const rel = (os.release() || '').toLowerCase();
    return rel.includes('gvisor');
  }

  private hasBinderModule(): boolean {
    return (
      fs.existsSync('/dev/binder') ||
      fs.existsSync('/dev/anbox-binder') ||
      fs.existsSync('/dev/binderfs') ||
      fs.existsSync('/dev/vndbinder') ||
      fs.existsSync('/dev/hwbinder')
    );
  }

  private hasKvmVirtualization(): boolean {
    return fs.existsSync('/dev/kvm');
  }

  public getEnvironmentLimitation(): {
    supported: boolean;
    reason: string;
    isGvisor: boolean;
    hasBinder: boolean;
    hasKvm: boolean;
  } {
    const isGv = this.isGvisorKernel();
    const binder = this.hasBinderModule();
    const kvm = this.hasKvmVirtualization();

    if (isGv) {
      return {
        supported: false,
        reason: 'Host kernel (4.19.0-gvisor) is a gVisor container sandbox lacking /dev/binder and /dev/kvm. Local Waydroid initialization is unsupported.',
        isGvisor: true,
        hasBinder: false,
        hasKvm: false
      };
    }

    if (!binder) {
      return {
        supported: false,
        reason: 'Host kernel lacks binder_linux (/dev/binder). Waydroid requires Binder IPC.',
        isGvisor: false,
        hasBinder: false,
        hasKvm: kvm
      };
    }

    return {
      supported: true,
      reason: 'Local Linux environment supports binder and Waydroid.',
      isGvisor: false,
      hasBinder: true,
      hasKvm: kvm
    };
  }

  async detect(): Promise<AndroidRuntimeStatus> {
    const env = this.getEnvironmentLimitation();
    const kernel = os.release() || '';

    if (!env.supported) {
      return {
        status: 'UNSUPPORTED',
        runtime: 'LOCAL_UNSUPPORTED',
        authoritativeState: 'LOCAL_UNSUPPORTED',
        execution: 'UNSUPPORTED',
        runtimeType: 'Local Waydroid',
        installed: false,
        executable: null,
        version: null,
        androidVersion: null,
        container: 'UNAVAILABLE',
        session: 'UNAVAILABLE',
        ready: false,
        reason: env.reason,
        hostOs: 'Linux (gVisor sandbox)',
        kernel,
        architecture: process.arch,
        backendUser: 'local',
        backendPath: '/usr/bin/waydroid',
        lastDetected: new Date().toISOString(),
        lastError: env.reason,
        capabilities: {
          isLinux: true,
          isGvisor: env.isGvisor,
          hasBinder: env.hasBinder,
          hasWayland: !!process.env.WAYLAND_DISPLAY,
          hasSystemd: fs.existsSync('/run/systemd/system')
        },
        supportedAbis: [process.arch]
      };
    }

    // If native host
    const whichRes = await ProcessExecutor.execute({ executable: 'which', args: ['waydroid'], timeoutMs: 3000 });
    const installed = whichRes.exitCode === 0;

    return {
      status: installed ? 'AVAILABLE' : 'MISSING',
      runtime: installed ? 'INSTALLED_NOT_READY' : 'LOCAL_RUNTIME_MISSING',
      authoritativeState: installed ? 'INSTALLED_NOT_READY' : 'LOCAL_RUNTIME_MISSING',
      execution: 'REAL',
      runtimeType: 'Local Waydroid',
      installed,
      executable: installed ? whichRes.stdout.trim() : null,
      version: null,
      container: 'STOPPED',
      session: 'STOPPED',
      ready: false,
      reason: installed ? 'Waydroid installed locally' : 'Waydroid executable not found in PATH',
      hostOs: 'Linux',
      kernel,
      architecture: process.arch,
      backendUser: 'local',
      backendPath: '/usr/bin/waydroid',
      lastDetected: new Date().toISOString(),
      lastError: null,
      capabilities: {
        isLinux: true,
        isGvisor: false,
        hasBinder: true,
        hasWayland: !!process.env.WAYLAND_DISPLAY,
        hasSystemd: fs.existsSync('/run/systemd/system')
      },
      supportedAbis: [process.arch]
    };
  }

  async version(): Promise<string | null> {
    const env = this.getEnvironmentLimitation();
    if (!env.supported) return null;
    const res = await ProcessExecutor.execute({ executable: 'waydroid', args: ['version'], timeoutMs: 3000 });
    return res.exitCode === 0 ? res.stdout.trim() : null;
  }

  async capabilities(): Promise<Record<string, boolean>> {
    const env = this.getEnvironmentLimitation();
    return {
      isLinux: true,
      isGvisor: env.isGvisor,
      hasBinder: env.hasBinder,
      hasKvm: env.hasKvm,
      supported: env.supported
    };
  }

  async initialize(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const env = this.getEnvironmentLimitation();
    if (!env.supported) {
      return { success: false, stdout: '', stderr: env.reason, exitCode: 1 };
    }
    const res = await ProcessExecutor.execute({ executable: 'waydroid', args: ['init'], timeoutMs: 60000 });
    return { success: res.exitCode === 0, ...res };
  }

  async start(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const env = this.getEnvironmentLimitation();
    if (!env.supported) {
      return { success: false, stdout: '', stderr: env.reason, exitCode: 1 };
    }
    const res = await ProcessExecutor.execute({ executable: 'waydroid', args: ['session', 'start'], timeoutMs: 15000 });
    return { success: res.exitCode === 0, ...res };
  }

  async stop(): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> {
    const env = this.getEnvironmentLimitation();
    if (!env.supported) {
      return { success: true, stdout: 'Stopped', stderr: '', exitCode: 0 };
    }
    const res = await ProcessExecutor.execute({ executable: 'waydroid', args: ['session', 'stop'], timeoutMs: 10000 });
    return { success: res.exitCode === 0, ...res };
  }

  async status(): Promise<AndroidRuntimeStatus> {
    return this.detect();
  }

  async ready(): Promise<boolean> {
    const env = this.getEnvironmentLimitation();
    return env.supported;
  }

  async waitUntilReady(timeoutMs = 5000): Promise<{ ready: boolean; elapsedMs: number; reason: string }> {
    const env = this.getEnvironmentLimitation();
    return {
      ready: false,
      elapsedMs: 0,
      reason: env.reason
    };
  }

  async shell(args: string[], timeoutMs = 8000): Promise<ProcessExecutionResult> {
    const env = this.getEnvironmentLimitation();
    if (!env.supported) {
      return {
        executable: 'waydroid',
        arguments: args,
        cwd: '/',
        environmentSummary: { PATH: '', HOME: '', USER: '', SHELL: '' },
        exitCode: 126,
        stdout: '',
        stderr: env.reason,
        signal: null,
        timedOut: false,
        durationMs: 0
      };
    }
    return ProcessExecutor.execute({ executable: 'waydroid', args: ['shell', ...args], timeoutMs });
  }

  async checkHealth(): Promise<AndroidRuntimeHealth> {
    const env = this.getEnvironmentLimitation();
    return {
      runtime: 'WAYDROID',
      installed: false,
      container: 'STOPPED',
      session: 'STOPPED',
      androidBoot: 'UNAVAILABLE',
      packageManager: 'UNAVAILABLE',
      ready: false,
      hostPass: !env.isGvisor,
      runtimePass: false,
      containerPass: false,
      sessionPass: false,
      androidBootPass: false,
      packageManagerPass: false,
      apkPass: false,
      installPass: false,
      launchPass: false,
      firstFailure: env.reason,
      rawEvidence: env.reason,
      rootCause: 'gVisor limitation',
      fix: 'Use external Android runtime'
    };
  }

  async getPackageProcessState(packageName: string): Promise<{ running: boolean; pid?: number }> {
    return { running: false };
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

  async getLogs(lines?: number): Promise<string[]> {
    return [];
  }

  async logs(lines?: number): Promise<string[]> {
    return [];
  }

  async reconcile(): Promise<{ ready: boolean; installedPackages: string[] }> {
    return { ready: false, installedPackages: [] };
  }

  async stopPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not implemented' };
  }

  async uninstallPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not implemented' };
  }

  async listPackages(): Promise<string[]> {
    return [];
  }

  async launchPackage(packageName: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not implemented' };
  }

  async installApk(apkPath: string): Promise<InstallResult> {
    const env = this.getEnvironmentLimitation();
    return { success: false, stage: 'INSTALL', message: env.reason };
  }

  async verifyPackage(packageName: string): Promise<boolean> {
    return false;
  }

  async sendInput(event: RemoteAndroidInputEvent): Promise<void> {
    throw new Error('Local Waydroid is unsupported on this host.');
  }

  async getDisplayFrame(): Promise<Buffer> {
    throw new Error('Local Waydroid is unsupported on this host.');
  }
}

export const localWaydroidAdapter = new LocalWaydroidAdapter();
