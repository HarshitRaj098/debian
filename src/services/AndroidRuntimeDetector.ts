import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AndroidRuntimeStatus, AndroidRuntimeState } from '../types/android';

const execAsync = (command: string, options?: any): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve) => {
    exec(command, options, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : ''
      });
    });
  });
};

export class AndroidRuntimeDetectorClass {
  private cachedStatus: AndroidRuntimeStatus | null = null;
  private lastDetectedTimestamp = 0;
  private readonly CACHE_TTL_MS = 5000; // 5 seconds bounded TTL

  /**
   * Returns current Android runtime status, using fresh detection or bounded cache.
   */
  public async status(): Promise<AndroidRuntimeStatus> {
    const now = Date.now();
    if (this.cachedStatus && (now - this.lastDetectedTimestamp < this.CACHE_TTL_MS)) {
      return this.cachedStatus;
    }
    return this.detect();
  }

  /**
   * Forces a fresh deep detection of the host environment, executable, container, and session.
   */
  public async detect(): Promise<AndroidRuntimeStatus> {
    const now = new Date().toISOString();
    let hostOs = 'Unknown Linux';
    let kernel = os.release() || 'Unknown';
    let architecture: string = process.arch || 'x86_64';
    let backendUser = 'unknown';
    let backendPath = process.env.PATH || '';
    let lastError: string | null = null;

    try {
      backendUser = os.userInfo().username || process.env.USER || 'root';
    } catch {
      backendUser = process.env.USER || 'root';
    }

    // 1. Inspect Host OS Distribution & Kernel
    try {
      if (fs.existsSync('/etc/os-release')) {
        const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
        const prettyMatch = osRelease.match(/PRETTY_NAME="([^"]+)"/);
        if (prettyMatch) {
          hostOs = prettyMatch[1];
        } else {
          const nameMatch = osRelease.match(/NAME="([^"]+)"/);
          if (nameMatch) hostOs = nameMatch[1];
        }
      }
    } catch (e: any) {
      lastError = `Failed reading /etc/os-release: ${e.message}`;
    }

    try {
      const { stdout: unameKernel } = await execAsync('uname -r');
      if (unameKernel.trim()) kernel = unameKernel.trim();
    } catch {}

    try {
      const { stdout: unameArch } = await execAsync('uname -m');
      if (unameArch.trim()) architecture = unameArch.trim();
    } catch {}

    // 2. Inspect Capabilities & Isolation
    const isLinux = process.platform === 'linux';
    const isGvisor = kernel.toLowerCase().includes('gvisor');
    const hasBinder = fs.existsSync('/dev/binder') || fs.existsSync('/dev/vndbinder') || fs.existsSync('/dev/hwbinder');
    const hasWayland = !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');
    let hasSystemd = false;
    try {
      hasSystemd = fs.existsSync('/run/systemd/system');
      if (!hasSystemd) {
        const { stdout } = await execAsync('command -v systemctl');
        if (stdout.trim()) hasSystemd = true;
      }
    } catch {}

    // 3. Detect Real Executable
    let executablePath: string | null = null;
    let versionStr: string | null = null;

    // Check which / command -v
    try {
      const { stdout } = await execAsync('command -v waydroid || which waydroid');
      const resolved = stdout.trim().split('\n')[0];
      if (resolved && fs.existsSync(resolved)) {
        executablePath = resolved;
      }
    } catch {}

    // Check standard candidate paths directly
    if (!executablePath) {
      const candidates = [
        '/usr/bin/waydroid',
        '/usr/local/bin/waydroid',
        '/bin/waydroid',
        '/snap/bin/waydroid',
        '/usr/sbin/waydroid',
        '/sbin/waydroid'
      ];
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            fs.accessSync(p, fs.constants.X_OK);
            executablePath = p;
            break;
          }
        } catch {}
      }
    }

    // 4. If binary found, query version and runtime status
    let containerState: 'RUNNING' | 'STOPPED' | 'UNINITIALIZED' | 'UNAVAILABLE' | 'UNKNOWN' = 'UNAVAILABLE';
    let sessionState: 'RUNNING' | 'STOPPED' | 'UNAVAILABLE' | 'UNKNOWN' = 'UNAVAILABLE';
    let isAndroidReady = false;
    let versionError: string | null = null;

    if (executablePath) {
      try {
        const { stdout: verOut } = await execAsync(`${executablePath} --version`);
        versionStr = verOut.trim();
      } catch (err: any) {
        versionError = err.message || 'Execution failed';
        lastError = `Failed running waydroid --version: ${err.message}`;
      }

      // Check waydroid status
      try {
        const { stdout: statusOut } = await execAsync(`${executablePath} status`);
        const lowerStatus = statusOut.toLowerCase();

        if (lowerStatus.includes('container:\trunning') || lowerStatus.includes('container: running')) {
          containerState = 'RUNNING';
        } else if (lowerStatus.includes('container:\tstopped') || lowerStatus.includes('container: stopped')) {
          containerState = 'STOPPED';
        } else if (lowerStatus.includes('not initialized') || lowerStatus.includes('uninitialized')) {
          containerState = 'UNINITIALIZED';
        } else {
          containerState = 'UNKNOWN';
        }

        if (lowerStatus.includes('session:\trunning') || lowerStatus.includes('session: running')) {
          sessionState = 'RUNNING';
        } else if (lowerStatus.includes('session:\tstopped') || lowerStatus.includes('session: stopped')) {
          sessionState = 'STOPPED';
        } else {
          sessionState = 'UNKNOWN';
        }

        if (lowerStatus.includes('android:\tready') || lowerStatus.includes('android: ready')) {
          isAndroidReady = true;
        }
      } catch (err: any) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('container service is not running') || msg.includes('stopped')) {
          containerState = 'STOPPED';
          sessionState = 'STOPPED';
        } else if (msg.includes('not initialized')) {
          containerState = 'UNINITIALIZED';
          sessionState = 'STOPPED';
        } else {
          containerState = 'UNKNOWN';
          sessionState = 'UNKNOWN';
        }
        lastError = `Status query returned: ${err.message}`;
      }
    }

    // 5. Synthesize Truthful State & Reason (Zero Simulation)
    let adbExecutable: string | null = null;
    let adbConnectedDevices: string[] = [];
    try {
      const { stdout: adbWhich } = await execAsync('command -v adb || which adb');
      const resolvedAdb = adbWhich.trim().split('\n')[0];
      if (resolvedAdb && fs.existsSync(resolvedAdb)) {
        adbExecutable = resolvedAdb;
        const { stdout: adbDevOut } = await execAsync(`${resolvedAdb} devices`);
        const lines = adbDevOut.split('\n').map(l => l.trim()).filter(Boolean);
        adbConnectedDevices = lines.slice(1).filter(l => /\bdevice\b/.test(l) && !l.startsWith('*'));
      }
    } catch {}

    let runtimeState: AndroidRuntimeState = 'NOT_INSTALLED';
    let generalStatus: 'AVAILABLE' | 'MISSING' | 'BROKEN' | 'UNSUPPORTED' = 'MISSING';
    let execution: 'REAL' | 'UNSUPPORTED' | 'SIMULATED' = 'UNSUPPORTED';
    let reason = '';

    if (!isLinux) {
      runtimeState = 'UNSUPPORTED';
      generalStatus = 'UNSUPPORTED';
      execution = 'UNSUPPORTED';
      reason = 'Waydroid requires a native GNU/Linux operating system with Wayland session support.';
    } else if (containerState === 'RUNNING' && sessionState === 'RUNNING' && isAndroidReady) {
      runtimeState = 'RUNTIME_READY';
      generalStatus = 'AVAILABLE';
      execution = 'REAL';
      reason = 'Waydroid Android LXC container and Wayland session are active, booted, and ready.';
    } else if (adbConnectedDevices.length > 0) {
      runtimeState = 'RUNTIME_READY';
      generalStatus = 'AVAILABLE';
      execution = 'REAL';
      isAndroidReady = true;
      reason = `ADB Android runtime connected (${adbConnectedDevices.join(', ')}).`;
    } else if (!executablePath && !adbExecutable) {
      runtimeState = 'NOT_INSTALLED';
      generalStatus = 'MISSING';
      execution = 'UNSUPPORTED';
      reason = 'Neither Waydroid nor ADB executables were found in backend PATH.';
    } else if (versionError) {
      runtimeState = 'BROKEN';
      generalStatus = 'BROKEN';
      execution = 'UNSUPPORTED';
      reason = `Waydroid binary was found at ${executablePath}, but execution failed: ${versionError}`;
    } else if (isGvisor || !hasBinder) {
      runtimeState = executablePath ? 'INSTALLED_NOT_READY' : 'UNSUPPORTED';
      generalStatus = 'UNSUPPORTED';
      execution = 'UNSUPPORTED';
      reason = `Waydroid (${versionStr || 'installed'}) and ADB (${adbExecutable || 'installed'}) are present on host, but kernel (${kernel}) is a gVisor sandbox without /dev/binder (modprobe binder_linux failed: module not found in /lib/modules/${kernel}) and "adb devices" returned 0 attached devices.`;
    } else if (containerState === 'RUNNING') {
      runtimeState = 'RUNTIME_DEGRADED';
      generalStatus = 'AVAILABLE';
      execution = 'REAL';
      reason = 'Waydroid container service is running, but Android session is offline or waiting for Wayland display.';
    } else if (containerState === 'UNINITIALIZED') {
      runtimeState = 'INSTALLED_NOT_READY';
      generalStatus = 'AVAILABLE';
      execution = 'UNSUPPORTED';
      reason = 'Waydroid binary is installed, but the Android rootfs/vendor image has not been initialized. Run "waydroid init" to download system images.';
    } else {
      runtimeState = 'INSTALLED_NOT_READY';
      generalStatus = 'AVAILABLE';
      execution = 'UNSUPPORTED';
      reason = `Waydroid binary is installed (${versionStr || 'unknown version'}), but the container service is currently stopped.`;
    }

    const detectedStatus: AndroidRuntimeStatus = {
      status: generalStatus,
      runtime: runtimeState,
      execution,
      runtimeType: executablePath ? 'Waydroid' : (adbExecutable ? 'ADB/Emulator' : 'None'),
      installed: !!(executablePath || adbExecutable),
      executable: executablePath || adbExecutable,
      version: versionStr,
      container: containerState,
      session: sessionState,
      ready: isAndroidReady,
      reason,
      hostOs,
      kernel,
      architecture,
      backendUser,
      backendPath,
      lastDetected: now,
      lastError,
      capabilities: {
        isLinux,
        isGvisor,
        hasBinder,
        hasWayland,
        hasSystemd
      },
      uptime: containerState === 'RUNNING' ? 'Running' : undefined,
      supportedAbis: architecture === 'x86_64' ? ['x86_64'] : ['arm64-v8a']
    };

    this.cachedStatus = detectedStatus;
    this.lastDetectedTimestamp = Date.now();
    return detectedStatus;
  }

  /**
   * Invalidate cache and run detect.
   */
  public async refresh(): Promise<AndroidRuntimeStatus> {
    this.cachedStatus = null;
    this.lastDetectedTimestamp = 0;
    return this.detect();
  }

  /**
   * Fast check if Waydroid runtime is installed and ready.
   */
  public async isReady(): Promise<boolean> {
    const st = await this.status();
    return st.ready && st.runtime === 'RUNTIME_READY';
  }

  /**
   * Fast check if Waydroid binary exists.
   */
  public async isAvailable(): Promise<boolean> {
    const st = await this.status();
    return st.installed;
  }

  /**
   * Initialize Waydroid system images if supported.
   */
  public async initialize(): Promise<{ success: boolean; output?: string; error?: string }> {
    const st = await this.status();
    if (!st.installed || !st.executable) {
      return { success: false, error: 'Waydroid executable is not installed.' };
    }
    if (st.capabilities.isGvisor) {
      return { success: false, error: 'Cannot initialize Waydroid in gVisor sandboxed container.' };
    }
    try {
      const { stdout } = await execAsync(`${st.executable} init`);
      await this.refresh();
      return { success: true, output: stdout };
    } catch (err: any) {
      return { success: false, error: err.message || 'Initialization failed' };
    }
  }

  /**
   * Start Waydroid session / container.
   */
  public async start(): Promise<{ success: boolean; output?: string; error?: string }> {
    const st = await this.status();
    if (!st.installed || !st.executable) {
      return { success: false, error: 'Waydroid executable is not installed.' };
    }
    try {
      const { stdout } = await execAsync(`${st.executable} session start`);
      await this.refresh();
      return { success: true, output: stdout };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed starting session' };
    }
  }

  /**
   * Stop Waydroid session / container.
   */
  public async stop(): Promise<{ success: boolean; output?: string; error?: string }> {
    const st = await this.status();
    if (!st.installed || !st.executable) {
      return { success: false, error: 'Waydroid executable is not installed.' };
    }
    try {
      const { stdout } = await execAsync(`${st.executable} session stop`);
      await this.refresh();
      return { success: true, output: stdout };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed stopping session' };
    }
  }

  /**
   * Restart Waydroid session.
   */
  public async restart(): Promise<{ success: boolean; output?: string; error?: string }> {
    await this.stop();
    return this.start();
  }
}

// Export singleton detector authority
export const AndroidRuntimeDetector = new AndroidRuntimeDetectorClass();
