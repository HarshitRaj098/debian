import { linux, LinuxSystemSnapshot, LinuxPackageItem, LinuxAppItem } from './linuxAdapter';

export interface DiscoveryState {
  systemSnapshot: LinuxSystemSnapshot | null;
  packages: LinuxPackageItem[];
  apps: LinuxAppItem[];
  network: any | null;
  processes: any[];
  isDiscovered: boolean;
  capabilities: {
    supportsBluetooth: boolean;
    supportsBattery: boolean;
    supportsTouchscreen: boolean;
    supportsMultipleDisplays: boolean;
    supportsWifi: boolean;
    batteryLevel: number;
    isCharging: boolean;
  };
}

type EventListener = (event: string, payload: any) => void;

class EventBridge {
  private listeners: Set<EventListener> = new Set();

  subscribe(listener: EventListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: string, payload: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (e) {
        console.error('EventBridge listener error:', e);
      }
    }
  }
}

export const eventBridge = new EventBridge();

export class DiscoveryEngine {
  private static instance: DiscoveryEngine;
  private state: DiscoveryState = {
    systemSnapshot: null,
    packages: [],
    apps: [],
    network: null,
    processes: [],
    isDiscovered: false,
    capabilities: {
      supportsBluetooth: false,
      supportsBattery: false,
      supportsTouchscreen: false,
      supportsMultipleDisplays: true,
      supportsWifi: true,
      batteryLevel: 100,
      isCharging: true
    }
  };
  private isRunning: boolean = false;
  private pollInterval: any = null;
  private lastStateHash: string = '';

  private constructor() {}

  public static getInstance(): DiscoveryEngine {
    if (!DiscoveryEngine.instance) {
      DiscoveryEngine.instance = new DiscoveryEngine();
    }
    return DiscoveryEngine.instance;
  }

  async discoverAll(): Promise<DiscoveryState> {
    if (this.isRunning) return this.state;
    this.isRunning = true;
    try {
      const [systemSnapshot, packages, apps, network, processes] = await Promise.all([
        linux.system(),
        linux.packages(),
        linux.applications(),
        linux.network(),
        linux.processes()
      ]);

      const hw = systemSnapshot?.capabilities;

      const nextState: DiscoveryState = {
        ...this.state,
        systemSnapshot,
        packages,
        apps,
        network,
        processes,
        isDiscovered: true,
        capabilities: {
          ...this.state.capabilities,
          supportsBluetooth: hw?.bluetoothEnabled ?? false,
          supportsBattery: hw?.hasBattery ?? false,
          batteryLevel: hw?.batteryLevel ?? 100,
          isCharging: hw?.isCharging ?? true,
        }
      };

      // Level 12 — Event Deduplication
      const stateHash = JSON.stringify({
        apps: apps.map(a => a.id),
        hw: nextState.capabilities,
        net: network?.ips
      });

      if (stateHash !== this.lastStateHash) {
        this.state = nextState;
        this.lastStateHash = stateHash;
        eventBridge.emit('system.discovered', this.state);
      }
    } catch (e) {
      console.error('DiscoveryEngine error:', e);
    } finally {
      this.isRunning = false;
    }
    return this.state;
  }

  // Agent F: Continuous Discovery Loop (Fixes G-003)
  startDiscoveryLoop(ms = 15000) {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.discoverAll(), ms);
  }

  stopDiscoveryLoop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // Agent D: Filesystem Change Event
  notifyFsChange(path: string) {
    eventBridge.emit('fs.changed', { path });
  }

  getState(): DiscoveryState {
    return this.state;
  }
}

export const discovery = DiscoveryEngine.getInstance();
