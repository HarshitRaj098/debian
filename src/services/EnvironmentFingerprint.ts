import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import crypto from 'crypto';

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

export interface ExecutableProbeRecord {
  name: string;
  path: string | null;
  version: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
  availability: 'AVAILABLE' | 'NOT_INSTALLED' | 'BROKEN';
}

export interface EnvironmentFingerprintRecord {
  os: string;
  distribution: string;
  platform: string;
  architecture: string;
  hostname: string;
  username: string;
  uid: number;
  gid: number;
  privileges: {
    isRoot: boolean;
    uid: number;
    gid: number;
  };
  packageManager: 'apt' | 'dnf' | 'pacman' | 'zypper' | 'unknown';
  cpu: {
    model: string;
    cores: number;
    loadAvg: number[];
  };
  ram: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
  };
  disk: {
    totalGb: number;
    availGb: number;
    mountPoint: string;
  };
  gpu: {
    driNodes: string[];
    available: boolean;
  };
  displayServer: {
    type: 'WAYLAND' | 'X11' | 'HEADLESS';
    waylandDisplay: string | null;
    x11Display: string | null;
    systemdActive: boolean;
    dbusSystemSocket: boolean;
  };
  shell: string;
  cwd: string;
  PATH: string;
  home: string;
  tempDirectory: string;
  filesystemBoundaries: {
    writableTmp: boolean;
    writableHome: boolean;
    procFilesystems: string[];
    hasBinderFilesystem: boolean;
    hasBinderDeviceNode: boolean;
  };
  network: {
    interfaces: string[];
    ipv4Addresses: string[];
  };
  processId: number;
  parentProcessId: number;
  nodeVersion: string;
  runtimeVersion: string;
  containerDetection: {
    isDocker: boolean;
    isGvisor: boolean;
    hasDockerEnv: boolean;
    hasDockerFile: boolean;
  };
  virtualizationDetection: {
    isWsl: boolean;
    kernelRelease: string;
  };
  backendStartTime: string;
}

export function getEnvironmentFingerprint(): EnvironmentFingerprintRecord {
  const userInfo = os.userInfo();
  const kernel = os.release() || '';
  const isGvisor = kernel.toLowerCase().includes('gvisor');
  const isWsl = kernel.toLowerCase().includes('wsl');
  const hasDockerEnv = fs.existsSync('/.dockerenv');
  const hasDockerFile = fs.existsSync('/proc/1/cgroup') && (() => {
    try {
      const content = fs.readFileSync('/proc/1/cgroup', 'utf-8');
      return content.includes('docker') || content.includes('kubepods') || content.includes('containerd');
    } catch {
      return false;
    }
  })();

  let distribution = 'Unknown Linux';
  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const m = content.match(/PRETTY_NAME="([^"]+)"/);
      if (m && m[1]) distribution = m[1];
    }
  } catch {}

  let packageManager: 'apt' | 'dnf' | 'pacman' | 'zypper' | 'unknown' = 'unknown';
  if (fs.existsSync('/usr/bin/apt-get') || fs.existsSync('/usr/bin/apt')) packageManager = 'apt';
  else if (fs.existsSync('/usr/bin/dnf')) packageManager = 'dnf';
  else if (fs.existsSync('/usr/bin/pacman')) packageManager = 'pacman';
  else if (fs.existsSync('/usr/bin/zypper')) packageManager = 'zypper';

  const cpus = os.cpus() || [];
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));

  let totalGb = 0;
  let availGb = 0;
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync('/');
      totalGb = Math.round((st.blocks * st.bsize) / (1024 * 1024 * 1024));
      availGb = Math.round((st.bavail * st.bsize) / (1024 * 1024 * 1024));
    }
  } catch {}

  let driNodes: string[] = [];
  try {
    if (fs.existsSync('/dev/dri')) {
      driNodes = fs.readdirSync('/dev/dri').map(n => `/dev/dri/${n}`);
    }
  } catch {}

  let procFilesystems: string[] = [];
  try {
    if (fs.existsSync('/proc/filesystems')) {
      procFilesystems = fs.readFileSync('/proc/filesystems', 'utf-8')
        .split('\n')
        .map(l => l.trim().split(/\s+/).pop() || '')
        .filter(Boolean);
    }
  } catch {}

  const hasBinderFilesystem = procFilesystems.includes('binder');
  const hasBinderDeviceNode =
    fs.existsSync('/dev/binder') ||
    fs.existsSync('/dev/anbox-binder') ||
    fs.existsSync('/dev/binderfs/binder-control');

  const netIfaces = os.networkInterfaces();
  const ipv4Addresses: string[] = [];
  for (const list of Object.values(netIfaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) {
        ipv4Addresses.push(item.address);
      }
    }
  }

  const waylandDisplay = process.env.WAYLAND_DISPLAY || null;
  const x11Display = process.env.DISPLAY || null;
  const displayType: 'WAYLAND' | 'X11' | 'HEADLESS' = waylandDisplay ? 'WAYLAND' : (x11Display ? 'X11' : 'HEADLESS');

  return {
    os: os.type(),
    distribution,
    platform: os.platform(),
    architecture: process.arch,
    hostname: os.hostname(),
    username: userInfo.username,
    uid: userInfo.uid,
    gid: userInfo.gid,
    privileges: {
      isRoot: userInfo.uid === 0,
      uid: userInfo.uid,
      gid: userInfo.gid
    },
    packageManager,
    cpu: {
      model: cpus[0]?.model || 'x86_64 vCPU',
      cores: cpus.length || 1,
      loadAvg: os.loadavg()
    },
    ram: {
      totalMb,
      freeMb,
      usedMb: totalMb - freeMb
    },
    disk: {
      totalGb,
      availGb,
      mountPoint: '/'
    },
    gpu: {
      driNodes,
      available: driNodes.length > 0
    },
    displayServer: {
      type: displayType,
      waylandDisplay,
      x11Display,
      systemdActive: fs.existsSync('/run/systemd/system'),
      dbusSystemSocket: fs.existsSync('/run/dbus/system_bus_socket')
    },
    shell: userInfo.shell || process.env.SHELL || '/bin/sh',
    cwd: process.cwd(),
    PATH: process.env.PATH || '',
    home: os.homedir(),
    tempDirectory: os.tmpdir(),
    filesystemBoundaries: {
      writableTmp: fs.existsSync('/tmp'),
      writableHome: fs.existsSync('/home/ubuntu'),
      procFilesystems,
      hasBinderFilesystem,
      hasBinderDeviceNode
    },
    network: {
      interfaces: Object.keys(netIfaces),
      ipv4Addresses
    },
    processId: process.pid,
    parentProcessId: process.ppid,
    nodeVersion: process.version,
    runtimeVersion: process.versions.v8 || 'unknown',
    containerDetection: {
      isDocker: hasDockerEnv || hasDockerFile,
      isGvisor,
      hasDockerEnv,
      hasDockerFile
    },
    virtualizationDetection: {
      isWsl,
      kernelRelease: kernel
    },
    backendStartTime: new Date().toISOString()
  };
}

export async function computeFileHash(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) return 'FILE_NOT_FOUND';
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

export async function probeRuntimeCommand(command: string): Promise<{
  command: string;
  resolvedExecutable: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const startMs = Date.now();
  let resolvedExecutable: string | null = null;
  const binaryName = command.split(' ')[0];

  try {
    const { stdout } = await execAsync(`which ${binaryName} || command -v ${binaryName}`);
    const resolved = stdout.trim().split('\n')[0];
    if (resolved && fs.existsSync(resolved)) {
      resolvedExecutable = resolved;
    }
  } catch {}

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 5000 });
    const endMs = Date.now();
    return {
      command,
      resolvedExecutable,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      durationMs: endMs - startMs
    };
  } catch (e: any) {
    const endMs = Date.now();
    return {
      command,
      resolvedExecutable,
      exitCode: e.code || 1,
      stdout: e.stdout ? e.stdout.trim() : '',
      stderr: e.stderr ? e.stderr.trim() : e.message,
      durationMs: endMs - startMs
    };
  }
}

export class HostEnvironmentDetector {
  private static cachedFingerprint: { record: EnvironmentFingerprintRecord; timestampMs: number } | null = null;
  private static cachedExecutables: { records: Record<string, ExecutableProbeRecord>; timestampMs: number } | null = null;
  private static readonly CACHE_TTL_MS = 10000;

  public static invalidateCache(): void {
    this.cachedFingerprint = null;
    this.cachedExecutables = null;
  }

  public static detect(forceRefresh = false): EnvironmentFingerprintRecord {
    const now = Date.now();
    if (!forceRefresh && this.cachedFingerprint && now - this.cachedFingerprint.timestampMs < this.CACHE_TTL_MS) {
      return this.cachedFingerprint.record;
    }
    const record = getEnvironmentFingerprint();
    this.cachedFingerprint = { record, timestampMs: now };
    return record;
  }

  public static async probeExecutable(binaryName: string, versionArg = '--version'): Promise<ExecutableProbeRecord> {
    let resolvedPath: string | null = null;
    try {
      const { stdout } = await execAsync(`which ${binaryName} || command -v ${binaryName}`, { timeout: 3000 });
      const first = stdout.trim().split('\n')[0];
      if (first && fs.existsSync(first)) {
        resolvedPath = first;
      }
    } catch {}

    if (!resolvedPath) {
      const fallbackPaths = [`/usr/bin/${binaryName}`, `/usr/local/bin/${binaryName}`, `/sbin/${binaryName}`, `/usr/sbin/${binaryName}`];
      for (const fp of fallbackPaths) {
        if (fs.existsSync(fp)) {
          resolvedPath = fp;
          break;
        }
      }
    }

    if (!resolvedPath) {
      return {
        name: binaryName,
        path: null,
        version: null,
        exitCode: 127,
        stdout: '',
        stderr: `${binaryName}: command not found`,
        availability: 'NOT_INSTALLED'
      };
    }

    try {
      const { stdout, stderr } = await execAsync(`${resolvedPath} ${versionArg}`, { timeout: 4000 });
      const out = (stdout || stderr || '').trim();
      const firstLine = out.split('\n')[0] || 'installed';
      return {
        name: binaryName,
        path: resolvedPath,
        version: firstLine,
        exitCode: 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        availability: 'AVAILABLE'
      };
    } catch (e: any) {
      const out = (e.stdout || e.stderr || '').trim();
      return {
        name: binaryName,
        path: resolvedPath,
        version: out ? out.split('\n')[0] : null,
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ? e.stdout.trim() : '',
        stderr: e.stderr ? e.stderr.trim() : e.message,
        availability: 'AVAILABLE'
      };
    }
  }

  public static async probeAllExecutablesParallel(forceRefresh = false): Promise<Record<string, ExecutableProbeRecord>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedExecutables && now - this.cachedExecutables.timestampMs < this.CACHE_TTL_MS) {
      return this.cachedExecutables.records;
    }

    const targets: Array<{ name: string; arg: string }> = [
      { name: 'waydroid', arg: '--version' },
      { name: 'adb', arg: 'version' },
      { name: 'aapt', arg: 'version' },
      { name: 'apksigner', arg: '--version' },
      { name: 'zipalign', arg: '-v' },
      { name: 'emulator', arg: '-version' },
      { name: 'anbox', arg: 'version' },
      { name: 'modprobe', arg: '--version' },
      { name: 'dbus-daemon', arg: '--version' }
    ];

    const results = await Promise.all(targets.map(t => this.probeExecutable(t.name, t.arg)));
    const recordMap: Record<string, ExecutableProbeRecord> = {};
    for (const r of results) {
      recordMap[r.name] = r;
    }

    this.cachedExecutables = { records: recordMap, timestampMs: now };
    return recordMap;
  }

  public static async buildCapabilityModel(forceRefresh = false): Promise<EnvironmentCapabilityModel> {
    const env = this.detect(forceRefresh);
    const execs = await this.probeAllExecutablesParallel(forceRefresh);

    const hasDevKvm = fs.existsSync('/dev/kvm');
    const hasDevBinder = env.filesystemBoundaries.hasBinderDeviceNode;
    const kernel = env.virtualizationDetection.kernelRelease;
    const hasBinderModuleDir = fs.existsSync(`/lib/modules/${kernel}`);
    const hasContainer0 = fs.existsSync('/container0') || env.containerDetection.isGvisor;
    const hasPodman = fs.existsSync('/usr/bin/podman') || fs.existsSync('/run/.containerenv');

    let environmentClass: EnvironmentCapabilityModel['environmentClass'] = 'NORMAL_LINUX_HOST';
    if (env.containerDetection.isGvisor) {
      environmentClass = 'GVISOR_SANDBOX';
    } else if (env.virtualizationDetection.isWsl) {
      environmentClass = 'WSL';
    } else if (env.containerDetection.isDocker || hasPodman || hasContainer0) {
      environmentClass = 'CONTAINER';
    }

    const normalAndroidHost = !env.containerDetection.isGvisor && (hasDevBinder || hasDevKvm);
    const waydroidDirect: 'AVAILABLE' | 'UNSUPPORTED' | 'UNAVAILABLE' = hasDevBinder
      ? (execs.waydroid?.availability === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE')
      : 'UNSUPPORTED';
    const kvmAndroidEmulator: 'AVAILABLE' | 'UNSUPPORTED' | 'UNAVAILABLE' = hasDevKvm
      ? (execs.emulator?.availability === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE')
      : 'UNSUPPORTED';

    return {
      timestamp: new Date().toISOString(),
      environmentClass,
      capabilities: {
        os: { status: env.os === 'Linux' ? 'AVAILABLE' : 'RESTRICTED', value: env.os, evidence: `os.type()=${env.os}` },
        distribution: { status: 'AVAILABLE', value: env.distribution, evidence: `/etc/os-release (${env.packageManager})` },
        kernel: {
          status: env.containerDetection.isGvisor ? 'RESTRICTED' : 'AVAILABLE',
          value: kernel,
          evidence: `uname -r=${kernel} (gVisor=${env.containerDetection.isGvisor}, /lib/modules/${kernel}=${hasBinderModuleDir})`
        },
        architecture: { status: 'AVAILABLE', value: env.architecture, evidence: `process.arch=${env.architecture}` },
        cpu: { status: 'AVAILABLE', value: `${env.cpu.cores} cores (${env.cpu.model})`, evidence: `loadAvg=${env.cpu.loadAvg.map(n => n.toFixed(2)).join(',')}` },
        ram: { status: 'AVAILABLE', value: `${env.ram.totalMb}MB total (${env.ram.freeMb}MB free)`, evidence: `used=${env.ram.usedMb}MB` },
        storage: { status: env.filesystemBoundaries.writableHome ? 'AVAILABLE' : 'RESTRICTED', value: `${env.disk.availGb}GB free / ${env.disk.totalGb}GB`, evidence: `writableHome=${env.filesystemBoundaries.writableHome}, writableTmp=${env.filesystemBoundaries.writableTmp}` },
        gpu: { status: env.gpu.available ? 'AVAILABLE' : 'UNAVAILABLE', value: env.gpu.available ? env.gpu.driNodes.join(', ') : 'No /dev/dri nodes', evidence: `/dev/dri nodes=${env.gpu.driNodes.length}` },
        display: { status: env.displayServer.type !== 'HEADLESS' ? 'AVAILABLE' : 'UNAVAILABLE', value: env.displayServer.type, evidence: `WAYLAND_DISPLAY=${env.displayServer.waylandDisplay || 'none'}, DISPLAY=${env.displayServer.x11Display || 'none'}` },
        wayland: { status: env.displayServer.waylandDisplay ? 'AVAILABLE' : 'UNAVAILABLE', value: env.displayServer.waylandDisplay || 'unset', evidence: 'process.env.WAYLAND_DISPLAY' },
        x11: { status: env.displayServer.x11Display ? 'AVAILABLE' : 'UNAVAILABLE', value: env.displayServer.x11Display || 'unset', evidence: 'process.env.DISPLAY' },
        systemd: { status: env.displayServer.systemdActive ? 'AVAILABLE' : 'UNAVAILABLE', value: env.displayServer.systemdActive ? 'active' : 'inactive', evidence: '/run/systemd/system' },
        dbus: { status: env.displayServer.dbusSystemSocket ? 'AVAILABLE' : 'UNAVAILABLE', value: env.displayServer.dbusSystemSocket ? '/run/dbus/system_bus_socket' : 'missing', evidence: 'fs.existsSync(/run/dbus/system_bus_socket)' },
        container: { status: env.containerDetection.isDocker || env.containerDetection.isGvisor ? 'RESTRICTED' : 'AVAILABLE', value: environmentClass, evidence: `isDocker=${env.containerDetection.isDocker}, isGvisor=${env.containerDetection.isGvisor}` },
        gvisor: { status: env.containerDetection.isGvisor ? 'RESTRICTED' : 'UNAVAILABLE', value: String(env.containerDetection.isGvisor), evidence: `kernel=${kernel}` },
        docker: { status: fs.existsSync('/usr/bin/docker') ? 'AVAILABLE' : 'UNAVAILABLE', value: fs.existsSync('/usr/bin/docker') ? '/usr/bin/docker' : 'missing', evidence: `/.dockerenv=${env.containerDetection.hasDockerEnv}` },
        podman: { status: hasPodman ? 'AVAILABLE' : 'UNAVAILABLE', value: hasPodman ? 'present' : 'missing', evidence: '/usr/bin/podman' },
        wsl: { status: env.virtualizationDetection.isWsl ? 'RESTRICTED' : 'UNAVAILABLE', value: String(env.virtualizationDetection.isWsl), evidence: 'kernel release check' },
        kvm: { status: hasDevKvm ? 'AVAILABLE' : 'UNAVAILABLE', value: hasDevKvm ? '/dev/kvm' : 'missing', evidence: `fs.existsSync('/dev/kvm')=${hasDevKvm}` },
        binder: { status: hasDevBinder ? 'AVAILABLE' : 'UNAVAILABLE', value: hasDevBinder ? '/dev/binder' : 'missing (binder_linux unavailable)', evidence: `/dev/binder=${hasDevBinder}, binderfs=${env.filesystemBoundaries.hasBinderFilesystem}` },
        androidTools: {
          status: execs.waydroid?.availability === 'AVAILABLE' && execs.adb?.availability === 'AVAILABLE' && execs.aapt?.availability === 'AVAILABLE' ? 'AVAILABLE' : 'RESTRICTED',
          value: `waydroid=${execs.waydroid?.path || 'missing'}, adb=${execs.adb?.path || 'missing'}, aapt=${execs.aapt?.path || 'missing'}, apksigner=${execs.apksigner?.path || 'missing'}`,
          evidence: 'HostEnvironmentDetector.probeAllExecutablesParallel()'
        }
      },
      inferences: {
        NORMAL_ANDROID_HOST: normalAndroidHost,
        WAYDROID_DIRECT: waydroidDirect,
        KVM_ANDROID_EMULATOR: kvmAndroidEmulator,
        LIMITATION_REASON: normalAndroidHost
          ? 'NONE'
          : `Kernel (${kernel}) is a ${environmentClass} environment where /dev/kvm is missing, /dev/binder is missing, and binder_linux kernel module cannot be loaded.`,
        REQUIRED_CAPABILITY: normalAndroidHost
          ? 'NONE'
          : 'Native Linux kernel with /dev/binder (binder_linux) for Waydroid, /dev/kvm for Android Emulator, or an external Android target attached via ADB (adb connect <host>:5555).'
      }
    };
  }
}

export type CapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'RESTRICTED' | 'UNKNOWN';

export interface CapabilityDescriptor {
  status: CapabilityStatus;
  value: string;
  evidence: string;
}

export interface EnvironmentCapabilityModel {
  timestamp: string;
  environmentClass: 'NORMAL_LINUX_HOST' | 'VM' | 'CONTAINER' | 'GVISOR_SANDBOX' | 'WSL' | 'REMOTE_SANDBOX' | 'CLOUD_WORKSPACE';
  capabilities: {
    os: CapabilityDescriptor;
    distribution: CapabilityDescriptor;
    kernel: CapabilityDescriptor;
    architecture: CapabilityDescriptor;
    cpu: CapabilityDescriptor;
    ram: CapabilityDescriptor;
    storage: CapabilityDescriptor;
    gpu: CapabilityDescriptor;
    display: CapabilityDescriptor;
    wayland: CapabilityDescriptor;
    x11: CapabilityDescriptor;
    systemd: CapabilityDescriptor;
    dbus: CapabilityDescriptor;
    container: CapabilityDescriptor;
    gvisor: CapabilityDescriptor;
    docker: CapabilityDescriptor;
    podman: CapabilityDescriptor;
    wsl: CapabilityDescriptor;
    kvm: CapabilityDescriptor;
    binder: CapabilityDescriptor;
    androidTools: CapabilityDescriptor;
  };
  inferences: {
    NORMAL_ANDROID_HOST: boolean;
    WAYDROID_DIRECT: 'AVAILABLE' | 'UNSUPPORTED' | 'UNAVAILABLE';
    KVM_ANDROID_EMULATOR: 'AVAILABLE' | 'UNSUPPORTED' | 'UNAVAILABLE';
    LIMITATION_REASON: string;
    REQUIRED_CAPABILITY: string;
  };
}
