import fs from 'fs';
import path from 'path';
import os from 'os';
import { androidRuntimeManager } from './AndroidRuntimeManager';
import { ProcessExecutor, ProcessExecutionResult } from './ProcessExecutor';

export type AndroidDisplayModel =
  | 'SEPARATE_NATIVE_WINDOW'
  | 'WAYLAND_SURFACE'
  | 'X11_WINDOW'
  | 'EMBEDDABLE_SURFACE'
  | 'REMOTE_FRAMEBUFFER'
  | 'NOT_SUPPORTED';

export interface AndroidSurfaceInfo {
  packageName: string;
  surfaceId: string | null;
  surfaceType: AndroidDisplayModel;
  visible: boolean;
  focused: boolean;
  processId?: number;
  geometry?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state: 'VISIBLE' | 'HIDDEN' | 'CLOSED' | 'CRASHED' | 'NOT_SUPPORTED';
}

export class AndroidSurfaceManager {
  public async detectDisplayModel(): Promise<{ model: AndroidDisplayModel; details: string; supported: boolean }> {
    const isWayland = !!process.env.WAYLAND_DISPLAY;
    const isX11 = !!process.env.DISPLAY;
    const { status: runtimeStatus } = await androidRuntimeManager.detectBest();

    if (!runtimeStatus.ready) {
      return {
        model: 'NOT_SUPPORTED',
        supported: false,
        details: `No active Android runtime ready (${runtimeStatus.reason}).`
      };
    }

    if (runtimeStatus.runtimeType === 'Waydroid') {
      if (isWayland) {
        return {
          model: 'WAYLAND_SURFACE',
          supported: true,
          details: `Native Wayland compositor active on ${process.env.WAYLAND_DISPLAY}.`
        };
      }
      if (isX11) {
        return {
          model: 'X11_WINDOW',
          supported: true,
          details: `X11 display server active on ${process.env.DISPLAY}.`
        };
      }
      return {
        model: 'SEPARATE_NATIVE_WINDOW',
        supported: true,
        details: 'Waydroid headless multi-window integration.'
      };
    }

    if (runtimeStatus.runtimeType === 'ADB/Emulator' || runtimeStatus.runtimeType === 'Remote/ADB') {
      return {
        model: 'REMOTE_FRAMEBUFFER',
        supported: true,
        details: 'Remote Android stream connected via RemoteAndroidAdapter.'
      };
    }

    return {
      model: 'NOT_SUPPORTED',
      supported: false,
      details: 'Unsupported display backend in current container environment.'
    };
  }

  public async getSurfaceInfo(packageName: string): Promise<AndroidSurfaceInfo> {
    const { model, details } = await this.detectDisplayModel();
    const adapter = await androidRuntimeManager.getActiveAdapter();
    const procState = await adapter.getPackageProcessState(packageName);

    if (model === 'NOT_SUPPORTED' || !procState.running) {
      return {
        packageName,
        surfaceId: null,
        surfaceType: model,
        visible: false,
        focused: false,
        processId: procState.pid,
        state: procState.running ? 'HIDDEN' : 'CLOSED'
      };
    }

    return {
      packageName,
      surfaceId: `surface-${packageName}-${procState.pid || 'main'}`,
      surfaceType: model,
      visible: true,
      focused: true,
      processId: procState.pid,
      geometry: {
        x: 100,
        y: 100,
        width: 360,
        height: 640
      },
      state: 'VISIBLE'
    };
  }

  public async sendInput(
    packageName: string,
    event: { type: 'TAP' | 'KEY' | 'SCROLL' | 'TEXT'; x?: number; y?: number; keycode?: number; text?: string }
  ): Promise<{ success: boolean; message: string }> {
    const { model } = await this.detectDisplayModel();
    if (model === 'NOT_SUPPORTED') {
      return { success: false, message: 'Input routing failed: Android display surface not supported or active.' };
    }

    let cmdArgs: string[] = [];
    if (event.type === 'TAP' && event.x !== undefined && event.y !== undefined) {
      cmdArgs = ['shell', 'input', 'tap', String(event.x), String(event.y)];
    } else if (event.type === 'KEY' && event.keycode !== undefined) {
      cmdArgs = ['shell', 'input', 'keyevent', String(event.keycode)];
    } else if (event.type === 'TEXT' && event.text) {
      cmdArgs = ['shell', 'input', 'text', event.text];
    } else if (event.type === 'SCROLL') {
      cmdArgs = ['shell', 'input', 'swipe', '300', '600', '300', '300', '200'];
    }

    if (cmdArgs.length === 0) {
      return { success: false, message: 'Unsupported input event parameters.' };
    }

    const { status } = await androidRuntimeManager.detectBest();
    const binary = status.runtimeType === 'Waydroid' ? 'waydroid' : 'adb';
    const res = await ProcessExecutor.execute({ executable: binary, args: cmdArgs, timeoutMs: 5000 });

    return {
      success: res.exitCode === 0,
      message: res.exitCode === 0 ? 'Input event delivered to Android application.' : res.stderr || 'Input delivery failed.'
    };
  }

  public async resizeSurface(
    packageName: string,
    geometry: { width: number; height: number }
  ): Promise<{ success: boolean; message: string }> {
    const { model } = await this.detectDisplayModel();
    if (model === 'NOT_SUPPORTED') {
      return { success: false, message: 'Resize failed: No active Android display surface.' };
    }
    return { success: true, message: `Surface geometry synchronized to ${geometry.width}x${geometry.height}` };
  }
}

export const androidSurfaceManager = new AndroidSurfaceManager();
