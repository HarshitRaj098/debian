export interface LinuxSystemSnapshot {
  os: string;
  desktop: string;
  kernel: string;
  uptime: string;
  arch: string;
  nodeVersion: string;
  hostIp: string;
  packageCount: number;
  capabilities: {
    hasBattery: boolean;
    batteryLevel: number;
    isCharging: boolean;
    bluetoothEnabled: boolean;
  };
  memory: {
    total: string;
    used: string;
    free: string;
    available: string;
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg: number[];
    usagePercent: number;
  };
  disk: {
    total: string;
    used: string;
    available: string;
    usagePercent: number;
    percentString: string;
    mountPoint: string;
  };
}

export interface LinuxProcessItem {
  pid: string;
  user: string;
  cpu: number;
  mem: number;
  stat: string;
  name: string;
}

export interface LinuxPackageItem {
  name: string;
  version: string;
  sizeKb: number;
  section: string;
}

export interface LinuxAppItem {
  id: string;
  name: string;
  executable: string;
  icon: string;
  description: string;
  categories: string[];
  source: string;
}

export interface LinuxNetworkInfo {
  ips: string[];
  interfaces: {
    name: string;
    rxBytes: number;
    rxPackets: number;
    txBytes: number;
    txPackets: number;
  }[];
}

export class LinuxAdapter {
  private static instance: LinuxAdapter;

  private constructor() {}

  public static getInstance(): LinuxAdapter {
    if (!LinuxAdapter.instance) {
      LinuxAdapter.instance = new LinuxAdapter();
    }
    return LinuxAdapter.instance;
  }

  async system(): Promise<LinuxSystemSnapshot | null> {
    try {
      const res = await fetch('/api/system/info');
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return null;
  }

  async processes(): Promise<LinuxProcessItem[]> {
    try {
      const res = await fetch('/api/system/processes');
      if (res.ok) {
        const data = await res.json();
        return data.processes || [];
      }
    } catch {}
    return [];
  }

  async killProcess(pid: string, signal = '-15'): Promise<boolean> {
    try {
      const res = await fetch('/api/system/process/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid, signal })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async packages(query = ''): Promise<LinuxPackageItem[]> {
    try {
      const res = await fetch(`/api/system/packages?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        return data.packages || [];
      }
    } catch {}
    return [];
  }

  async applications(): Promise<LinuxAppItem[]> {
    try {
      const res = await fetch('/api/system/apps');
      if (res.ok) {
        const data = await res.json();
        return data.apps || [];
      }
    } catch {}
    return [];
  }

  async network(): Promise<LinuxNetworkInfo | null> {
    try {
      const res = await fetch('/api/system/network');
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return null;
  }

  async listFiles(dir = '.'): Promise<any> {
    try {
      const res = await fetch(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return null;
  }

  async searchFiles(query: string): Promise<any[]> {
    try {
      const res = await fetch(`/api/system/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        return data.results || [];
      }
    } catch {}
    return [];
  }

  async executeAction(action: string, targetId: string, value?: any): Promise<boolean> {
    try {
      const res = await fetch('/os/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, targetId, value })
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const linux = LinuxAdapter.getInstance();
