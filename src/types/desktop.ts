import React from 'react';

export type AppId = 'terminal' | 'files' | 'browser' | 'vscode' | 'calculator' | 'settings' | 'monitor' | (string & {});

export interface AppDefinition {
  id: AppId;
  name: string;
  category: string;
  icon: React.ReactNode;
  iconBg: string;
  description: string;
  isFavorite: boolean;
  keywords: string[];
}

export interface OsWindow {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isSnapped: 'left' | 'right' | null;
  zIndex: number;
  workspaceId: number;
  prevBounds?: { x: number; y: number; width: number; height: number };
  initialData?: any;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  app: string;
  read: boolean;
}

export interface CalendarReminder {
  id: string;
  dateKey: string; // YYYY-MM-DD
  title: string;
  time?: string;
  completed?: boolean;
}

export type WallpaperId = 'jammy-aubergine' | 'noble-numbat' | 'deep-space' | 'matrix-emerald' | 'minimal-carbon';

export interface DesktopSettings {
  theme: 'dark' | 'light';
  accentColor: string; // e.g. '#E95420' (Ubuntu Orange)
  wallpaperId: WallpaperId;
  dockPosition: 'left' | 'bottom';
  dockIconSize: number; // 36, 44, 52
  dockAutoHide: boolean;
  dockShowTrash: boolean;
  volume: number; // 0 - 100
  brightness: number; // 0 - 100
  wifiEnabled: boolean;
  bluetoothEnabled: boolean;
  nightLight: boolean;
  powerMode: 'performance' | 'balanced' | 'power-saver';
  doNotDisturb: boolean;
}
