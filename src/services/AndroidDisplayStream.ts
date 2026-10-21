import {
  DisplayStreamState,
  DisplayStreamMetrics,
  RemoteAndroidDisplayFrame
} from '../types/android';
import { remoteAndroidAdapter } from './RemoteAndroidAdapter';
import { adbDeviceAdapter } from './ADBDeviceAdapter';

export interface DisplayStreamEvents {
  onFrame?: (frame: RemoteAndroidDisplayFrame) => void;
  onStateChange?: (state: DisplayStreamState, reason?: string) => void;
  onError?: (error: string) => void;
  onMetrics?: (metrics: DisplayStreamMetrics) => void;
}

export class AndroidDisplayStream {
  private state: DisplayStreamState = 'DISCONNECTED';
  private metrics: DisplayStreamMetrics = {
    fps: 0,
    targetFps: 15,
    latencyMs: 0,
    framesDelivered: 0,
    framesDropped: 0,
    resolution: { width: 720, height: 1280 }
  };

  private latestFrame: Buffer | null = null;
  private latestFrameBase64: string | null = null;
  private latestTimestamp = 0;
  private activeTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  private eventListeners: DisplayStreamEvents = {};
  private activeSource: 'REMOTE' | 'ADB' = 'REMOTE';

  public setEventListeners(listeners: DisplayStreamEvents): void {
    this.eventListeners = { ...this.eventListeners, ...listeners };
  }

  public getState(): DisplayStreamState {
    return this.state;
  }

  public getMetrics(): DisplayStreamMetrics {
    return { ...this.metrics };
  }

  public getLatestFrame(): {
    buffer: Buffer | null;
    dataBase64: string | null;
    timestamp: number;
    metrics: DisplayStreamMetrics;
  } {
    return {
      buffer: this.latestFrame,
      dataBase64: this.latestFrameBase64,
      timestamp: this.latestTimestamp,
      metrics: { ...this.metrics }
    };
  }

  public setSource(source: 'REMOTE' | 'ADB'): void {
    this.activeSource = source;
  }

  private setState(newState: DisplayStreamState, reason?: string): void {
    if (this.state !== newState) {
      this.state = newState;
      this.eventListeners.onStateChange?.(newState, reason);
    }
  }

  public async start(targetFps = 15): Promise<{ success: boolean; message: string }> {
    if (this.state === 'STREAMING') {
      return { success: true, message: 'Display stream is already active.' };
    }

    this.metrics.targetFps = Math.max(1, Math.min(30, targetFps));
    this.setState('CONNECTING', 'Initiating display stream session');
    this.consecutiveFailures = 0;

    // Verify initial connection reachability
    const remoteStatus = await remoteAndroidAdapter.getStatus();
    const adbStatus = await adbDeviceAdapter.detect();

    if (this.activeSource === 'REMOTE' && !remoteStatus.connected) {
      // Check if ADB is available instead
      if (adbStatus.ready) {
        this.activeSource = 'ADB';
      } else {
        this.setState('FAILED', 'No Android runtime or ADB device connected for display stream.');
        return {
          success: false,
          message: 'Display stream requires a connected Android host or ADB device. Kernel is gVisor sandbox.'
        };
      }
    }

    this.setState('STREAMING', 'Display stream established');
    const intervalMs = Math.round(1000 / this.metrics.targetFps);

    this.activeTimer = setInterval(async () => {
      await this.pullNextFrame();
    }, intervalMs);

    return {
      success: true,
      message: `Display stream started at ${this.metrics.targetFps} FPS (Source: ${this.activeSource})`
    };
  }

  public stop(): void {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.setState('DISCONNECTED', 'Display stream stopped by client');
    this.metrics.fps = 0;
  }

  private async pullNextFrame(): Promise<void> {
    const frameStart = Date.now();
    try {
      let frameBuffer: Buffer | null = null;

      if (this.activeSource === 'REMOTE') {
        frameBuffer = await remoteAndroidAdapter.fetchDisplayFrame();
      } else {
        frameBuffer = await adbDeviceAdapter.captureScreen();
      }

      if (frameBuffer && frameBuffer.length > 0) {
        const latency = Date.now() - frameStart;
        this.latestFrame = frameBuffer;
        this.latestFrameBase64 = frameBuffer.toString('base64');
        this.latestTimestamp = Date.now();
        this.consecutiveFailures = 0;

        this.metrics.framesDelivered++;
        this.metrics.latencyMs = latency;
        this.metrics.lastFrameTime = this.latestTimestamp;
        this.metrics.fps = Math.round(1000 / Math.max(16, latency));

        if (this.state !== 'STREAMING') {
          this.setState('STREAMING', 'Frame stream recovered');
        }

        const frameItem: RemoteAndroidDisplayFrame = {
          timestamp: this.latestTimestamp,
          format: 'png',
          width: this.metrics.resolution.width,
          height: this.metrics.resolution.height,
          dataBase64: this.latestFrameBase64,
          latencyMs: latency
        };

        this.eventListeners.onFrame?.(frameItem);
        this.eventListeners.onMetrics?.(this.getMetrics());
      } else {
        this.handleFrameFailure('Empty or null frame buffer received');
      }
    } catch (err: any) {
      this.handleFrameFailure(err.message || 'Frame capture exception');
    }
  }

  private handleFrameFailure(reason: string): void {
    this.metrics.framesDropped++;
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      if (this.state === 'STREAMING') {
        this.setState('STALLED', `Stream stalled after ${this.consecutiveFailures} consecutive dropped frames: ${reason}`);
      } else if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES * 2) {
        this.setState('RECONNECTING', 'Attempting reconnection with Android display server');
      }
    }
  }

  public getDisplayMetadata(): {
    executionLocation: 'REMOTE_DEVICE' | 'REMOTE_HOST';
    disclaimer: string;
    protocol: string;
  } {
    return {
      executionLocation: this.activeSource === 'ADB' ? 'REMOTE_DEVICE' : 'REMOTE_HOST',
      disclaimer: 'The application is executing on the connected external Android runtime / device. It is not running inside the local gVisor kernel sandbox.',
      protocol: this.activeSource === 'ADB' ? 'ADB Screencap Stream' : 'REST/TLS Scoped Display Stream'
    };
  }
}

export const androidDisplayStream = new AndroidDisplayStream();
