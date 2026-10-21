import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Folder, 
  Globe, 
  Code, 
  Calculator, 
  Settings as SettingsIcon,
  Activity,
  Smartphone,
  X
} from 'lucide-react';
import { 
  AppId, 
  AppDefinition, 
  OsWindow, 
  NotificationItem, 
  DesktopSettings,
  CalendarReminder
} from './types/desktop';
import { UbuntuWallpaper } from './components/UbuntuWallpaper';
import { TopPanel } from './components/TopPanel';
import { Dock } from './components/Dock';
import { ActivitiesOverview } from './components/ActivitiesOverview';
import { QuickSettingsMenu } from './components/QuickSettingsMenu';
import { CalendarNotificationsShade } from './components/CalendarNotificationsShade';
import { DesktopContextMenu } from './components/DesktopContextMenu';
import { WindowManager } from './components/WindowManager';

import { discovery, eventBridge } from './adapters/discoveryEngine';
import { TimeService } from './services/TimeService';
import { linux } from './adapters/linuxAdapter';

const CORE_APPS: AppDefinition[] = [
  {
    id: 'files',
    name: 'Files',
    category: 'System',
    icon: <Folder size={28} className="text-amber-400" />,
    iconBg: 'bg-amber-600/30',
    description: 'Access and organize files, folders, and project code',
    isFavorite: true,
    keywords: ['files', 'nautilus', 'directory', 'folder', 'storage', 'documents']
  },
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'System',
    icon: <Terminal size={28} className="text-emerald-400" />,
    iconBg: 'bg-[#300a24]',
    description: 'Use the real Linux command line userspace and bash',
    isFavorite: true,
    keywords: ['terminal', 'bash', 'shell', 'cli', 'pty', 'sh', 'console']
  },
  {
    id: 'browser',
    name: 'Web Browser',
    category: 'Internet',
    icon: <Globe size={28} className="text-sky-400" />,
    iconBg: 'bg-blue-600/30',
    description: 'Browse the web and documentation with GNOME Epiphany',
    isFavorite: true,
    keywords: ['browser', 'web', 'internet', 'epiphany', 'chrome', 'firefox']
  },
  {
    id: 'vscode',
    name: 'Code Studio',
    category: 'Development',
    icon: <Code size={28} className="text-indigo-400" />,
    iconBg: 'bg-indigo-600/30',
    description: 'Source code editor and JavaScript / script sandbox',
    isFavorite: true,
    keywords: ['code', 'vscode', 'editor', 'programming', 'develop', 'ide']
  },
  {
    id: 'monitor',
    name: 'System Monitor',
    category: 'System',
    icon: <Activity size={28} className="text-rose-400" />,
    iconBg: 'bg-rose-600/30',
    description: 'View live processes, CPU load, memory usage, and system stats',
    isFavorite: true,
    keywords: ['monitor', 'task', 'process', 'cpu', 'ram', 'system', 'top']
  },
  {
    id: 'calculator',
    name: 'Calculator',
    category: 'Utilities',
    icon: <Calculator size={28} className="text-orange-400" />,
    iconBg: 'bg-orange-600/30',
    description: 'Perform arithmetic, scientific, and financial calculations',
    isFavorite: true,
    keywords: ['calculator', 'math', 'calc', 'numbers']
  },
  {
    id: 'settings',
    name: 'Settings',
    category: 'System',
    icon: <SettingsIcon size={28} className="text-purple-400" />,
    iconBg: 'bg-purple-600/30',
    description: 'Configure appearance, dock, displays, network, sound, and system',
    isFavorite: true,
    keywords: ['settings', 'preferences', 'configuration', 'control', 'wallpaper', 'theme']
  },
  {
    id: 'android-bridge',
    name: 'Android Bridge',
    category: 'System',
    icon: <Smartphone size={28} className="text-emerald-400" />,
    iconBg: 'bg-emerald-600/30',
    description: 'Remote Android runtime connection, TestAPK acceptance, and display stream',
    isFavorite: true,
    keywords: ['android', 'apk', 'waydroid', 'adb', 'bridge', 'remote', 'runtime', 'mobile']
  }
];

export default function App() {
  const [apps, setApps] = useState<AppDefinition[]>(CORE_APPS);
  const [hwState, setHwState] = useState<{
    batteryLevel: number;
    isCharging: boolean;
    hasBattery: boolean;
    bluetoothEnabled: boolean;
    hostIp: string;
  }>({
    batteryLevel: 0,
    isCharging: false,
    hasBattery: false,
    bluetoothEnabled: false,
    hostIp: '...'
  });

  // Desktop settings store
  const [settings, setSettings] = useState<DesktopSettings>({
    theme: 'dark',
    accentColor: '#E95420', // Authentic Ubuntu Orange
    wallpaperId: 'jammy-aubergine',
    dockPosition: 'left',
    dockIconSize: 44,
    dockAutoHide: false,
    dockShowTrash: true,
    volume: 80,
    brightness: 100,
    wifiEnabled: true,
    bluetoothEnabled: true,
    nightLight: false,
    powerMode: 'balanced',
    doNotDisturb: false
  });

  // Windows State
  const [windows, setWindows] = useState<OsWindow[]>([
    {
      id: 'win_terminal_1',
      appId: 'terminal',
      title: 'aether@noble: ~',
      x: 120,
      y: 60,
      width: 680,
      height: 440,
      isMinimized: false,
      isMaximized: false,
      isSnapped: null,
      zIndex: 10,
      workspaceId: 1
    }
  ]);

  const [activeWindowId, setActiveWindowId] = useState<string | null>('win_terminal_1');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number>(1);
  const [editorFileToOpen, setEditorFileToOpen] = useState<string | undefined>();
  const [settingsSection, setSettingsSection] = useState<string | undefined>('appearance');

  // Popups & Shell Overlays
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [overviewTab, setOverviewTab] = useState<'windows' | 'apps'>('windows');
  const [isQuickSettingsOpen, setIsQuickSettingsOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarTab, setCalendarTab] = useState<'calendar' | 'notifications'>('calendar');
  const [isLocked, setIsLocked] = useState(false);
  const [showPowerDialog, setShowPowerDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Reminders / Calendar Schedule Store
  const [reminders, setReminders] = useState<CalendarReminder[]>([
    { 
      id: 'rem_1', 
      dateKey: new Date().toISOString().slice(0, 10), 
      title: 'Canonical Security Advisory Audit', 
      time: '09:00 AM', 
      completed: true 
    },
    { 
      id: 'rem_2', 
      dateKey: new Date().toISOString().slice(0, 10), 
      title: 'Real Linux Userspace Kernel Sync', 
      time: '02:30 PM', 
      completed: false 
    }
  ]);

  // Notifications Queue
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: 'notif_1',
      title: 'AETHER OS 26.04 LTS Ready',
      message: 'Ubuntu Userspace microkernel and PTY gateway are active.',
      time: 'Just now',
      app: 'System',
      read: false
    }
  ]);
  const [toastNotification, setToastNotification] = useState<NotificationItem | null>(null);

  // Discovery Integration
  useEffect(() => {
    const handleDiscovered = (event: string, state: any) => {
      if (event === 'system.discovered') {
        const discoveredApps: AppDefinition[] = state.apps.map((app: any) => ({
          id: app.id,
          name: app.name,
          category: app.categories[0] || 'Accessories',
          icon: <Activity size={28} className="text-white/40" />, // Generic icon for discovered apps
          iconBg: 'bg-white/10',
          description: app.description || `Linux executable: ${app.executable}`,
          isFavorite: false,
          keywords: [app.id, ...app.categories],
          executable: app.executable
        }));

        // Merge with core apps, avoiding duplicates
        setApps(prev => {
          const coreIds = new Set(CORE_APPS.map(a => a.id));
          const filteredDiscovered = discoveredApps.filter(a => !coreIds.has(a.id as any));
          return [...CORE_APPS, ...filteredDiscovered];
        });

        // Update hardware state
        if (state.systemSnapshot) {
          const snap = state.systemSnapshot;
          setHwState({
            batteryLevel: snap.capabilities.batteryLevel,
            isCharging: snap.capabilities.isCharging,
            hasBattery: snap.capabilities.hasBattery,
            bluetoothEnabled: snap.capabilities.bluetoothEnabled,
            hostIp: snap.hostIp
          });
        }
      }
    };

    const unsubscribe = eventBridge.subscribe(handleDiscovered);
    discovery.discoverAll(); // Trigger initial discovery
    discovery.startDiscoveryLoop(10000); // Trigger reactive loop (G-003)

    return () => {
      unsubscribe();
      discovery.stopDiscoveryLoop();
    };
  }, []);

  // Dynamic Clock
  const [timeString, setTimeString] = useState<string>(TimeService.formatWall(TimeService.now()));

  useEffect(() => {
    const updateTime = () => {
      setTimeString(TimeService.formatWall(TimeService.now()));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Click outside to close panels & Escape key handler
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Do not close if clicking inside the popovers or trigger buttons
      if (
        target.closest('.calendar-notifications-shade') || 
        target.closest('.date-time-trigger') || 
        target.closest('.notification-bell-trigger')
      ) {
        return;
      }
      if (
        target.closest('.quick-settings-menu') || 
        target.closest('.quick-settings-trigger')
      ) {
        return;
      }

      setIsCalendarOpen(false);
      setIsQuickSettingsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCalendarOpen(false);
        setIsQuickSettingsOpen(false);
        setIsOverviewOpen(false);
        setContextMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleOpenCalendar = () => {
    if (isCalendarOpen && calendarTab === 'calendar') {
      setIsCalendarOpen(false);
    } else {
      setCalendarTab('calendar');
      setIsCalendarOpen(true);
      setIsQuickSettingsOpen(false);
    }
  };

  const handleOpenNotifications = () => {
    if (isCalendarOpen && calendarTab === 'notifications') {
      setIsCalendarOpen(false);
    } else {
      setCalendarTab('notifications');
      setIsCalendarOpen(true);
      setIsQuickSettingsOpen(false);
      // Mark all notifications as read when opening notification center
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }
  };

  const handleOpenNotificationApp = (notif: NotificationItem) => {
    setIsCalendarOpen(false);
    const lower = notif.app.toLowerCase();
    if (lower.includes('term')) handleLaunchApp('terminal');
    else if (lower.includes('file')) handleLaunchApp('files');
    else if (lower.includes('code') || lower.includes('studio')) handleLaunchApp('vscode');
    else if (lower.includes('setting')) handleLaunchApp('settings');
    else if (lower.includes('system') || lower.includes('monitor')) handleLaunchApp('monitor');
    else if (lower.includes('browser')) handleLaunchApp('browser');
    else if (lower.includes('calc')) handleLaunchApp('calculator');
    else handleLaunchApp('terminal');

    // Mark as read
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
  };

  const handleDismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleClearNotifications = () => {
    setNotifications([]);
  };

  const handleAddReminder = (r: CalendarReminder) => {
    setReminders(prev => [...prev, r]);
    addNotification('Task Added', `Added "${r.title}" to calendar schedule`, 'System');
  };

  const handleDeleteReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
  };

  const handleToggleReminder = (id: string) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: !r.completed } : r));
  };

  const addNotification = (title: string, message: string, app: string = 'System') => {
    const newNotif: NotificationItem = {
      id: `notif_${Date.now()}`,
      title,
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      app,
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
    if (!settings.doNotDisturb) {
      setToastNotification(newNotif);
      setTimeout(() => {
        setToastNotification(curr => curr?.id === newNotif.id ? null : curr);
      }, 5000);
    }
  };

  // Launch or Focus Application
  const handleLaunchApp = (appId: AppId, initialData?: any) => {
    setIsOverviewOpen(false);
    
    // Check if a window for this app already exists on active workspace
    const existing = windows.find(w => w.appId === appId && w.workspaceId === activeWorkspaceId);
    if (existing) {
      // Restore if minimized and focus
      setWindows(prev => prev.map(w => {
        if (w.id === existing.id) {
          return { 
            ...w, 
            isMinimized: false, 
            zIndex: getNextZIndex(),
            initialData: initialData !== undefined ? initialData : w.initialData
          };
        }
        return w;
      }));
      setActiveWindowId(existing.id);
      return;
    }

    // Default dimensions based on app
    let width = 640;
    let height = 440;
    let title: string = appId;

    // Check if it's an external app (exists in apps but not in CORE_APPS)
    const appDef = apps.find(a => a.id === appId);
    const isCore = CORE_APPS.some(a => a.id === appId);

    if (appDef && !isCore && (appDef as any).executable) {
      // Launch external app in a Terminal
      handleLaunchApp('terminal', { command: (appDef as any).executable });
      return;
    }

    switch (appId) {
      case 'terminal':
        title = 'aether@noble: ~';
        width = 680;
        height = 440;
        break;
      case 'files':
        title = 'Files';
        width = 720;
        height = 460;
        break;
      case 'browser':
        title = 'Web Browser';
        width = 800;
        height = 540;
        break;
      case 'vscode':
        title = 'Code Studio';
        width = 780;
        height = 520;
        break;
      case 'monitor':
        title = 'System Monitor';
        width = 660;
        height = 450;
        break;
      case 'calculator':
        title = 'Calculator';
        width = 300;
        height = 420;
        break;
      case 'settings':
        title = 'Settings';
        width = 740;
        height = 520;
        break;
    }

    // Stagger position
    const offset = (windows.length % 6) * 28;
    const newWin: OsWindow = {
      id: `win_${appId}_${Date.now()}`,
      appId,
      title,
      x: 100 + offset,
      y: 60 + offset,
      width,
      height,
      isMinimized: false,
      isMaximized: false,
      isSnapped: null,
      zIndex: getNextZIndex(),
      workspaceId: activeWorkspaceId,
      initialData
    };

    setWindows(prev => [...prev, newWin]);
    setActiveWindowId(newWin.id);
  };

  const getNextZIndex = () => {
    const highest = windows.reduce((max, w) => Math.max(max, w.zIndex), 10);
    return highest + 1;
  };

  const handleFocusWindow = (id: string) => {
    const nextZ = getNextZIndex();
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZ, isMinimized: false } : w));
    setActiveWindowId(id);
  };

  const handleCloseWindow = (id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
    if (activeWindowId === id) {
      const remaining = windows.filter(w => w.id !== id && w.workspaceId === activeWorkspaceId);
      setActiveWindowId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  const handleMinimizeWindow = (id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
    if (activeWindowId === id) {
      setActiveWindowId(null);
    }
  };

  const handleToggleMaximizeWindow = (id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id === id) {
        if (w.isMaximized) {
          // Restore
          return {
            ...w,
            isMaximized: false,
            x: w.prevBounds?.x || w.x,
            y: w.prevBounds?.y || w.y,
            width: w.prevBounds?.width || w.width,
            height: w.prevBounds?.height || w.height
          };
        } else {
          // Maximize
          return {
            ...w,
            isMaximized: true,
            prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height }
          };
        }
      }
      return w;
    }));
  };

  const handleUpdateWindowBounds = (id: string, bounds: { x: number; y: number; width: number; height: number }) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, ...bounds } : w));
  };

  const handleCloseAppWindows = (appId: AppId) => {
    setWindows(prev => prev.filter(w => w.appId !== appId));
  };

  const handleOpenFileInEditor = (filePath: string) => {
    setEditorFileToOpen(filePath);
    handleLaunchApp('vscode');
  };

  // Desktop right-click context menu handlers
  const handleContextMenu = (e: React.MouseEvent) => {
    // Only if target is empty desktop workspace
    if ((e.target as HTMLElement).closest('header, aside, .pointer-events-auto')) {
      return;
    }
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleNewFolder = async () => {
    try {
      await fetch('/api/fs/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '.', name: `New Folder ${Date.now().toString().slice(-4)}` })
      });
      addNotification('Folder Created', 'Created new folder in Desktop workspace', 'Files');
    } catch {}
  };

  const handleNewFile = async () => {
    try {
      await fetch('/api/fs/create-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '.', name: `document_${Date.now().toString().slice(-4)}.txt`, content: 'Hello from AETHER OS' })
      });
      addNotification('Document Created', 'Created new text document on Desktop', 'Files');
    } catch {}
  };

  const activeWindow = windows.find(w => w.id === activeWindowId) || null;

  return (
    <div 
      onContextMenu={handleContextMenu}
      className="h-screen w-screen bg-[#111111] text-white font-sans overflow-hidden flex flex-col relative select-none"
    >
      {/* Dynamic Canonical Ubuntu Wallpaper */}
      <UbuntuWallpaper wallpaperId={settings.wallpaperId} />

      {/* Night Light Warm Tint Overlay */}
      {settings.nightLight && (
        <div className="absolute inset-0 pointer-events-none z-50 bg-[#ffa500]/15 mix-blend-color-burn" />
      )}

      {/* Screen Brightness Overlay */}
      {settings.brightness < 100 && (
        <div 
          className="absolute inset-0 pointer-events-none z-50 bg-black" 
          style={{ opacity: (100 - settings.brightness) * 0.007 }} 
        />
      )}

      {/* Top Panel (GNOME Top Bar) */}
      <TopPanel
        currentTime={timeString}
        isOverviewOpen={isOverviewOpen}
        onToggleOverview={() => {
          setOverviewTab('windows');
          setIsOverviewOpen(prev => !prev);
        }}
        onOpenApplications={() => {
          setOverviewTab('apps');
          setIsOverviewOpen(true);
        }}
        activeWindow={activeWindow}
        settings={settings}
        hwState={hwState}
        isQuickSettingsOpen={isQuickSettingsOpen}
        onToggleQuickSettings={() => {
          setIsQuickSettingsOpen(prev => !prev);
          setIsCalendarOpen(false);
        }}
        onOpenWifiQuickSettings={() => {
          setIsQuickSettingsOpen(true);
          setIsCalendarOpen(false);
        }}
        onOpenVolumeQuickSettings={() => {
          setIsQuickSettingsOpen(true);
          setIsCalendarOpen(false);
        }}
        onOpenPowerQuickSettings={() => {
          setIsQuickSettingsOpen(true);
          setIsCalendarOpen(false);
        }}
        isCalendarOpen={isCalendarOpen}
        calendarTab={calendarTab}
        onOpenCalendar={handleOpenCalendar}
        onOpenNotifications={handleOpenNotifications}
        unreadNotificationCount={notifications.filter(n => !n.read).length}
      />

      {/* Quick Settings Dropdown */}
      {isQuickSettingsOpen && (
        <QuickSettingsMenu
          settings={settings}
          hwState={hwState}
          onUpdateSettings={setSettings}
          onOpenSettings={(section) => {
            setSettingsSection(section);
            handleLaunchApp('settings');
          }}
          onLockScreen={() => setIsLocked(true)}
          onPowerOff={() => setShowPowerDialog(true)}
          onClose={() => setIsQuickSettingsOpen(false)}
        />
      )}

      {/* Calendar & Notification Shade */}
      {isCalendarOpen && (
        <CalendarNotificationsShade
          notifications={notifications}
          onClearNotifications={handleClearNotifications}
          onDismissNotification={handleDismissNotification}
          onOpenNotificationApp={handleOpenNotificationApp}
          onClose={() => setIsCalendarOpen(false)}
          initialTab={calendarTab}
          reminders={reminders}
          onAddReminder={handleAddReminder}
          onDeleteReminder={handleDeleteReminder}
          onToggleReminder={handleToggleReminder}
        />
      )}

      {/* Toast Notification Banner (Top Right) */}
      {toastNotification && (
        <div 
          className="fixed top-9 right-4 z-50 w-80 bg-[#1e1e1e]/95 backdrop-blur-xl border border-white/15 rounded-xl p-3 shadow-2xl text-xs text-white animate-in slide-in-from-top-2 duration-200"
          onClick={() => {
            if (toastNotification.app === 'Files') handleLaunchApp('files');
            if (toastNotification.app === 'Terminal') handleLaunchApp('terminal');
            setToastNotification(null);
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-[#E95420] text-[10px] uppercase tracking-wider">{toastNotification.app}</span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setToastNotification(null);
              }}
              className="text-white/40 hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
          <div className="font-semibold text-white/90">{toastNotification.title}</div>
          <div className="text-[11px] text-white/60 leading-snug mt-0.5">{toastNotification.message}</div>
        </div>
      )}

      {/* Left Dock (Ubuntu Yaru Dock) */}
      <Dock
        settings={settings}
        apps={apps}
        windows={windows}
        activeWindowId={activeWindowId}
        onLaunchApp={handleLaunchApp}
        onToggleOverview={() => {
          setOverviewTab('windows');
          setIsOverviewOpen(prev => !prev);
        }}
        isOverviewOpen={isOverviewOpen}
        onCloseAppWindows={handleCloseAppWindows}
      />

      {/* Window Manager Layer */}
      <WindowManager
        windows={windows}
        activeWindowId={activeWindowId}
        activeWorkspaceId={activeWorkspaceId}
        settings={settings}
        onFocusWindow={handleFocusWindow}
        onCloseWindow={handleCloseWindow}
        onMinimizeWindow={handleMinimizeWindow}
        onToggleMaximizeWindow={handleToggleMaximizeWindow}
        onUpdateWindowBounds={handleUpdateWindowBounds}
        onUpdateSettings={setSettings}
        onOpenFileInEditor={handleOpenFileInEditor}
        onNotify={addNotification}
        onLaunchApp={handleLaunchApp}
        editorFileToOpen={editorFileToOpen}
        settingsSection={settingsSection}
      />

      {/* Activities & Application Launcher Overview */}
      <ActivitiesOverview
        isOpen={isOverviewOpen}
        onClose={() => setIsOverviewOpen(false)}
        apps={apps}
        windows={windows}
        activeWorkspaceId={activeWorkspaceId}
        initialTab={overviewTab}
        onSelectWorkspace={(wId) => {
          setActiveWorkspaceId(wId);
          setIsOverviewOpen(false);
        }}
        onLaunchApp={handleLaunchApp}
        onFocusWindow={handleFocusWindow}
        onCloseWindow={handleCloseWindow}
      />

      {/* Ubuntu Lock Screen Overlay */}
      {isLocked && (
        <div 
          onClick={() => setIsLocked(false)}
          className="fixed inset-0 z-50 bg-[#1e0720]/90 backdrop-blur-3xl flex flex-col items-center justify-center select-none text-white animate-in fade-in duration-200 cursor-pointer"
        >
          <div className="text-6xl font-light tracking-tight mb-2 font-mono">
            {timeString.split('  ')[1] || '16:25'}
          </div>
          <div className="text-sm font-medium text-white/70 mb-12">
            {timeString.split('  ')[0] || 'Monday, October 5'}
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full bg-[#E95420] text-white flex items-center justify-center text-3xl font-bold shadow-2xl ring-4 ring-white/10">
              A
            </div>
            <div className="text-base font-bold">aether-user</div>
            <div className="mt-4 px-5 py-2 rounded-full bg-white/10 hover:bg-[#E95420] text-xs font-semibold tracking-wide transition-all shadow">
              Click or press anywhere to unlock
            </div>
          </div>
        </div>
      )}

      {/* Ubuntu Power Off / Restart Dialog */}
      {showPowerDialog && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none"
          onClick={() => setShowPowerDialog(false)}
        >
          <div 
            className="bg-[#242424] border border-white/15 rounded-2xl p-6 w-96 shadow-2xl text-white animate-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-1">Power Off</h3>
            <p className="text-xs text-white/60 mb-6">The system will power off or reboot.</p>
            <div className="flex flex-col gap-2 text-xs">
              <button
                onClick={async () => {
                  setShowPowerDialog(false);
                  addNotification('Restart Requested', 'Rebooting AETHER OS kernel...', 'System');
                  await linux.executeAction('system.restart', 'system');
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-bold transition-colors"
              >
                Restart
              </button>
              <button
                onClick={async () => {
                  setShowPowerDialog(false);
                  addNotification('System Shutdown', 'Core processes safely suspended', 'System');
                  await linux.executeAction('system.poweroff', 'system');
                }}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 font-bold transition-colors text-white shadow"
              >
                Power Off
              </button>
              <button
                onClick={() => setShowPowerDialog(false)}
                className="w-full py-2 rounded-xl text-white/50 hover:text-white transition-colors mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Context Menu */}
      {contextMenu && (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onNewFolder={handleNewFolder}
          onNewFile={handleNewFile}
          onOpenTerminal={() => handleLaunchApp('terminal')}
          onOpenSettings={(section) => {
            setSettingsSection(section);
            handleLaunchApp('settings');
          }}
          onRefresh={() => addNotification('Desktop Refreshed', 'Workspace icons and files synchronized', 'Desktop')}
        />
      )}
    </div>
  );
}
