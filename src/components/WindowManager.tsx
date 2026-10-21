import React, { useState, useEffect, useRef } from 'react';
import { Minus, Square, Copy, X, Terminal, Folder, Globe, Code, Calculator, Settings as SettingsIcon, Activity } from 'lucide-react';
import { OsWindow, AppId, DesktopSettings } from '../types/desktop';
import { TerminalApp } from './apps/TerminalApp';
import { FilesApp } from './apps/FilesApp';
import { SettingsApp } from './apps/SettingsApp';
import { SystemMonitorApp } from './apps/SystemMonitorApp';
import { BrowserApp } from './apps/BrowserApp';
import { CodeStudioApp } from './apps/CodeStudioApp';
import { CalculatorApp } from './apps/CalculatorApp';
import { AndroidBridgeApp } from './apps/AndroidBridgeApp';

interface WindowManagerProps {
  windows: OsWindow[];
  activeWindowId: string | null;
  activeWorkspaceId: number;
  settings: DesktopSettings;
  onFocusWindow: (id: string) => void;
  onCloseWindow: (id: string) => void;
  onMinimizeWindow: (id: string) => void;
  onToggleMaximizeWindow: (id: string) => void;
  onUpdateWindowBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onUpdateSettings: (updater: (prev: DesktopSettings) => DesktopSettings) => void;
  onOpenFileInEditor: (path: string) => void;
  onNotify: (title: string, message: string, app?: string) => void;
  onLaunchApp: (appId: AppId, initialData?: any) => void;
  editorFileToOpen?: string;
  settingsSection?: string;
}

const getAppIcon = (appId: AppId) => {
  switch (appId) {
    case 'terminal': return <Terminal size={14} className="text-emerald-400" />;
    case 'files': return <Folder size={14} className="text-amber-400" />;
    case 'browser': return <Globe size={14} className="text-sky-400" />;
    case 'vscode': return <Code size={14} className="text-blue-400" />;
    case 'calculator': return <Calculator size={14} className="text-orange-400" />;
    case 'settings': return <SettingsIcon size={14} className="text-purple-400" />;
    case 'monitor': return <Activity size={14} className="text-rose-400" />;
    default: return null;
  }
};

export const WindowManager: React.FC<WindowManagerProps> = ({
  windows,
  activeWindowId,
  activeWorkspaceId,
  settings,
  onFocusWindow,
  onCloseWindow,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onUpdateWindowBounds,
  onUpdateSettings,
  onOpenFileInEditor,
  onNotify,
  onLaunchApp,
  editorFileToOpen,
  settingsSection
}) => {
  const topPanelHeight = 28;
  const isDockLeft = settings.dockPosition === 'left';
  const dockWidth = settings.dockAutoHide ? 4 : 56;

  const workspaceBounds = {
    minX: isDockLeft ? dockWidth : 0,
    minY: topPanelHeight,
    maxX: typeof window !== 'undefined' ? window.innerWidth : 1920,
    maxY: typeof window !== 'undefined' 
      ? window.innerHeight - (settings.dockPosition === 'bottom' ? 56 : 0) 
      : 1080
  };

  // Dragging state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  // Resizing state (8-way)
  const [resizingId, setResizingId] = useState<string | null>(null);
  const resizeStartRef = useRef<{ 
    startX: number; 
    startY: number; 
    initialWidth: number; 
    initialHeight: number;
    initialX: number;
    initialY: number;
    handle: string; // 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingId && dragStartRef.current) {
        const deltaX = e.clientX - dragStartRef.current.startX;
        const deltaY = e.clientY - dragStartRef.current.startY;
        
        let newX = dragStartRef.current.initialX + deltaX;
        let newY = dragStartRef.current.initialY + deltaY;

        newY = Math.max(workspaceBounds.minY, newY);
        newX = Math.max(workspaceBounds.minX, newX);

        const currentWin = windows.find(w => w.id === draggingId);
        if (currentWin && !currentWin.isMaximized) {
          onUpdateWindowBounds(draggingId, {
            x: newX,
            y: newY,
            width: currentWin.width,
            height: currentWin.height
          });
        }
      } else if (resizingId && resizeStartRef.current) {
        const deltaX = e.clientX - resizeStartRef.current.startX;
        const deltaY = e.clientY - resizeStartRef.current.startY;
        const currentWin = windows.find(w => w.id === resizingId);
        
        if (currentWin && !currentWin.isMaximized) {
          const { initialWidth, initialHeight, initialX, initialY, handle } = resizeStartRef.current;
          let newWidth = initialWidth;
          let newHeight = initialHeight;
          let newX = initialX;
          let newY = initialY;

          const minW = 280;
          const minH = 180;

          if (handle.includes('e')) {
            newWidth = Math.max(minW, initialWidth + deltaX);
          }
          if (handle.includes('s')) {
            newHeight = Math.max(minH, initialHeight + deltaY);
          }
          if (handle.includes('w')) {
            const potentialWidth = initialWidth - deltaX;
            if (potentialWidth >= minW) {
              newWidth = potentialWidth;
              newX = initialX + deltaX;
            }
          }
          if (handle.includes('n')) {
            const potentialHeight = initialHeight - deltaY;
            if (potentialHeight >= minH) {
              newHeight = potentialHeight;
              newY = initialY + deltaY;
            }
          }

          onUpdateWindowBounds(resizingId, {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
          });
        }
      }
    };

    const handleMouseUp = () => {
      setDraggingId(null);
      dragStartRef.current = null;
      setResizingId(null);
      resizeStartRef.current = null;
    };

    if (draggingId || resizingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, resizingId, windows, workspaceBounds, onUpdateWindowBounds]);

  const visibleWindows = windows.filter(w => w.workspaceId === activeWorkspaceId && !w.isMinimized);

  const startResize = (e: React.MouseEvent, win: OsWindow, handle: string) => {
    e.stopPropagation();
    if (win.isMaximized) return;
    setResizingId(win.id);
    resizeStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialWidth: win.width,
      initialHeight: win.height,
      initialX: win.x,
      initialY: win.y,
      handle
    };
    onFocusWindow(win.id);
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {visibleWindows.map((win) => {
        const isActive = activeWindowId === win.id;

        let winStyle: React.CSSProperties;
        if (win.isMaximized) {
          winStyle = {
            left: workspaceBounds.minX,
            top: workspaceBounds.minY,
            width: workspaceBounds.maxX - workspaceBounds.minX,
            height: workspaceBounds.maxY - workspaceBounds.minY,
            zIndex: win.zIndex,
            borderRadius: 0
          };
        } else if (win.isSnapped === 'left') {
          winStyle = {
            left: workspaceBounds.minX,
            top: workspaceBounds.minY,
            width: (workspaceBounds.maxX - workspaceBounds.minX) / 2,
            height: workspaceBounds.maxY - workspaceBounds.minY,
            zIndex: win.zIndex,
            borderRadius: 0
          };
        } else if (win.isSnapped === 'right') {
          winStyle = {
            left: workspaceBounds.minX + (workspaceBounds.maxX - workspaceBounds.minX) / 2,
            top: workspaceBounds.minY,
            width: (workspaceBounds.maxX - workspaceBounds.minX) / 2,
            height: workspaceBounds.maxY - workspaceBounds.minY,
            zIndex: win.zIndex,
            borderRadius: 0
          };
        } else {
          winStyle = {
            left: win.x,
            top: win.y,
            width: win.width,
            height: win.height,
            zIndex: win.zIndex
          };
        }

        return (
          <div
            key={win.id}
            style={winStyle}
            onMouseDown={() => onFocusWindow(win.id)}
            className={`pointer-events-auto absolute flex flex-col bg-[#1c1c1c] text-white shadow-2xl overflow-hidden transition-[box-shadow,border-color] duration-150 border select-none ${
              win.isMaximized ? 'rounded-none border-none' : 'rounded-xl'
            } ${
              isActive 
                ? 'border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.65)] ring-1 ring-white/10' 
                : 'border-white/10 opacity-95 shadow-lg'
            }`}
          >
            {/* 8-Way Resize Handles (Edges & Corners) */}
            {!win.isMaximized && !win.isSnapped && (
              <>
                <div onMouseDown={(e) => startResize(e, win, 'n')} className="absolute top-0 left-2 right-2 h-1.5 cursor-n-resize z-40" />
                <div onMouseDown={(e) => startResize(e, win, 's')} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-s-resize z-40" />
                <div onMouseDown={(e) => startResize(e, win, 'w')} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-w-resize z-40" />
                <div onMouseDown={(e) => startResize(e, win, 'e')} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-e-resize z-40" />
                <div onMouseDown={(e) => startResize(e, win, 'nw')} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-50" />
                <div onMouseDown={(e) => startResize(e, win, 'ne')} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-50" />
                <div onMouseDown={(e) => startResize(e, win, 'sw')} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-50" />
                <div onMouseDown={(e) => startResize(e, win, 'se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-50 flex items-center justify-center text-white/20 hover:text-white/70">
                  <div className="w-1.5 h-1.5 border-r border-b border-current mr-1 mb-1" />
                </div>
              </>
            )}

            {/* Window Header Titlebar (Canonical Ubuntu GNOME CSD) */}
            <div
              onDoubleClick={() => onToggleMaximizeWindow(win.id)}
              onMouseDown={(e) => {
                if (win.isMaximized) return;
                setDraggingId(win.id);
                dragStartRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  initialX: win.x,
                  initialY: win.y
                };
                onFocusWindow(win.id);
              }}
              className={`h-9 px-3.5 flex items-center justify-between shrink-0 cursor-default select-none border-b transition-colors ${
                isActive 
                  ? 'bg-[#2b2b2b] text-white border-black/30' 
                  : 'bg-[#202020] text-white/60 border-black/20'
              }`}
            >
              {/* Left App Icon & Title */}
              <div className="flex items-center gap-2 min-w-0 pointer-events-none">
                {getAppIcon(win.appId)}
                <span className="text-xs font-semibold tracking-tight truncate">
                  {win.title}
                </span>
              </div>

              {/* Right Ubuntu Window Control Buttons (Minimize, Maximize, Close) */}
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMinimizeWindow(win.id);
                  }}
                  className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title="Minimize"
                >
                  <Minus size={11} strokeWidth={2.5} />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMaximizeWindow(win.id);
                  }}
                  className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title={win.isMaximized ? 'Restore' : 'Maximize'}
                >
                  {win.isMaximized ? (
                    <Copy size={9} strokeWidth={2.5} />
                  ) : (
                    <Square size={9} strokeWidth={2.5} />
                  )}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWindow(win.id);
                  }}
                  className="w-5 h-5 rounded-full bg-white/10 hover:bg-[#E95420] text-white/70 hover:text-white flex items-center justify-center transition-colors"
                  title="Close"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Window Content Body */}
            <div className="flex-1 w-full h-full min-h-0 bg-[#1e1e1e] overflow-hidden relative">
              {win.appId === 'terminal' && <TerminalApp initialData={win.initialData} />}
              {win.appId === 'files' && <FilesApp onOpenFileInEditor={onOpenFileInEditor} />}
              {win.appId === 'settings' && (
                <SettingsApp 
                  settings={settings} 
                  onUpdateSettings={onUpdateSettings} 
                  initialSection={settingsSection || 'appearance'} 
                />
              )}
              {win.appId === 'monitor' && <SystemMonitorApp />}
              {win.appId === 'browser' && (
                <BrowserApp 
                  initialUrl={win.initialData} 
                  onNotify={onNotify}
                  onLaunchApp={onLaunchApp}
                  settings={settings}
                />
              )}
              {win.appId === 'vscode' && <CodeStudioApp initialFilePath={win.initialData || editorFileToOpen} />}
              {win.appId === 'calculator' && <CalculatorApp />}
              {(win.appId === 'android-bridge' || win.appId === 'android') && (
                <AndroidBridgeApp onNotify={onNotify} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
