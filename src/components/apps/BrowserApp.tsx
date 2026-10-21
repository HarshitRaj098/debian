import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Home,
  Globe,
  Lock,
  Plus,
  X,
  Puzzle,
  Moon,
  Shield,
  FileCode,
  Sliders,
  ExternalLink,
  Activity,
  Layers,
  Terminal,
  Download,
  Check,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';
import { AppId, DesktopSettings } from '../../types/desktop';
import { ChromiumTab, ArclightExtension, BrowserDoctorReport, ChromiumEngineStatus } from '../../types/browser';

interface BrowserAppProps {
  initialUrl?: string;
  onNotify?: (title: string, message: string, app?: string) => void;
  onLaunchApp?: (appId: AppId, initialData?: any) => void;
  settings?: DesktopSettings;
}

export const BrowserApp: React.FC<BrowserAppProps> = ({
  initialUrl,
  onNotify,
  onLaunchApp,
  settings
}) => {
  // Tabs State
  const [tabs, setTabs] = useState<ChromiumTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState(initialUrl || 'https://www.google.com');
  const [isLoading, setIsLoading] = useState(false);

  // Engine & Extension States
  const [engineStatus, setEngineStatus] = useState<ChromiumEngineStatus | null>(null);
  const [extensions, setExtensions] = useState<ArclightExtension[]>([]);
  const [activeExtensionPopup, setActiveExtensionPopup] = useState<ArclightExtension | null>(null);
  const [isExtensionsModalOpen, setIsExtensionsModalOpen] = useState(false);
  const [isDoctorModalOpen, setIsDoctorModalOpen] = useState(false);
  const [doctorReport, setDoctorReport] = useState<BrowserDoctorReport | null>(null);
  const [inspectingManifest, setInspectingManifest] = useState<ArclightExtension | null>(null);

  // Viewport & Screencast State
  const [viewportFrame, setViewportFrame] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [unpackedPathInput, setUnpackedPathInput] = useState<string>('/home/ubuntu/my-extension');
  const [isInstallingUnpacked, setIsInstallingUnpacked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsCalcRef = useRef<number>(Date.now());
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Bookmarks
  const bookmarks = [
    { title: 'Google Search', url: 'https://www.google.com', icon: 'google' },
    { title: 'GitHub', url: 'https://github.com', icon: 'github' },
    { title: 'Wikipedia', url: 'https://en.wikipedia.org', icon: 'wiki' },
    { title: 'Hacker News', url: 'https://news.ycombinator.com', icon: 'hn' },
    { title: 'Extensions Manager', url: 'arclight://extensions', icon: 'ext' },
    { title: 'Engine Diagnostics', url: 'arclight://version', icon: 'doc' }
  ];

  // Fetch Tabs & Engine Status
  const refreshEngineData = useCallback(async () => {
    try {
      const [tabsRes, extsRes, statusRes] = await Promise.all([
        fetch('/api/browser/tabs'),
        fetch('/api/browser/extensions'),
        fetch('/api/browser/status')
      ]);

      if (tabsRes.ok) {
        const data = await tabsRes.json();
        setTabs(data.tabs || []);
        if (data.tabs && data.tabs.length > 0 && !activeTabId) {
          const first = data.tabs[0];
          setActiveTabId(first.id);
          setInputUrl(first.url);
        }
      }

      if (extsRes.ok) {
        const data = await extsRes.json();
        setExtensions(data.extensions || []);
      }

      if (statusRes.ok) {
        const data = await statusRes.json();
        setEngineStatus(data);
      }
    } catch (err) {
      console.warn('[BrowserApp] Failed to refresh engine data:', err);
    }
  }, [activeTabId]);

  useEffect(() => {
    refreshEngineData();
    const interval = setInterval(refreshEngineData, 4000);
    return () => clearInterval(interval);
  }, [refreshEngineData]);

  // Handle active tab changes
  useEffect(() => {
    const cur = tabs.find(t => t.id === activeTabId);
    if (cur) {
      setInputUrl(cur.url);
    }
  }, [activeTabId, tabs]);

  // WebSocket Screencast Connection
  useEffect(() => {
    if (!activeTabId) return;

    let isSubscribed = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/browser?channel=browser`;

    const connectWs = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isSubscribed) return;
          ws.send(JSON.stringify({ type: 'subscribe', tabId: activeTabId }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'frame' && msg.tabId === activeTabId && msg.data) {
              setViewportFrame(`data:image/jpeg;base64,${msg.data}`);
              frameCountRef.current++;

              const now = Date.now();
              if (now - lastFpsCalcRef.current >= 1000) {
                setFps(frameCountRef.current);
                frameCountRef.current = 0;
                lastFpsCalcRef.current = now;
              }
            } else if (msg.type === 'navigated' && msg.result) {
              setIsLoading(false);
              if (msg.result.url) setInputUrl(msg.result.url);
            }
          } catch {}
        };

        ws.onerror = () => {
          console.warn('[BrowserApp] WS screencast error, falling back to HTTP frame polling');
        };

        ws.onclose = () => {
          // Fallback poll
          if (isSubscribed) {
            pollingTimerRef.current = setInterval(async () => {
              try {
                const res = await fetch(`/api/browser/tabs/${activeTabId}/frame?quality=70`);
                if (res.ok) {
                  const blob = await res.blob();
                  const reader = new FileReader();
                  reader.onload = () => setViewportFrame(reader.result as string);
                  reader.readAsDataURL(blob);
                }
              } catch {}
            }, 250);
          }
        };
      } catch (err) {
        console.warn('[BrowserApp] WebSocket instantiation failed:', err);
      }
    };

    connectWs();

    return () => {
      isSubscribed = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [activeTabId]);

  // Draw frame to canvas
  useEffect(() => {
    if (!viewportFrame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = viewportFrame;
  }, [viewportFrame]);

  // Tab Operations
  const handleNewTab = async (targetUrl: string = 'https://www.google.com') => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/browser/tabs/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (data.tab) {
        setTabs(prev => [...prev, data.tab]);
        setActiveTabId(data.tab.id);
        setInputUrl(data.tab.url);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  };

  const handleCloseTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (tabs.length <= 1) {
      // Don't close last tab; navigate to google
      handleNavigate('https://www.google.com');
      return;
    }

    try {
      await fetch('/api/browser/tabs/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId })
      });
      const remaining = tabs.filter(t => t.id !== tabId);
      setTabs(remaining);
      if (activeTabId === tabId) {
        const next = remaining[remaining.length - 1];
        setActiveTabId(next.id);
        setInputUrl(next.url);
      }
    } catch {}
  };

  const handleNavigate = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;

    if (trimmed === 'arclight://extensions') {
      setIsExtensionsModalOpen(true);
      return;
    }
    if (trimmed === 'arclight://version' || trimmed === 'arclight://doctor') {
      handleOpenDoctor();
      return;
    }

    if (!activeTabId) return;

    setIsLoading(true);
    setInputUrl(trimmed);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'navigate',
        tabId: activeTabId,
        url: trimmed
      }));
    } else {
      try {
        const res = await fetch('/api/browser/tabs/navigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabId: activeTabId, url: trimmed })
        });
        const data = await res.json();
        if (data.title) {
          setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, title: data.title, url: data.url } : t));
        }
      } catch {} finally {
        setIsLoading(false);
      }
    }
  };

  const handleNavAction = async (action: 'back' | 'forward' | 'reload') => {
    if (!activeTabId) return;
    setIsLoading(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'action', tabId: activeTabId, action }));
    } else {
      await fetch('/api/browser/tabs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: activeTabId, action })
      });
    }
    setTimeout(() => setIsLoading(false), 500);
  };

  // Mouse & Keyboard Event Forwarding to Real Chromium
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    const { x, y } = getCoordinates(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendInputEvent({ type: 'mouse', action: 'mousedown', x, y, button });
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    const { x, y } = getCoordinates(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendInputEvent({ type: 'mouse', action: 'mouseup', x, y, button });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    const { x, y } = getCoordinates(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendInputEvent({ type: 'mouse', action: 'click', x, y, button });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    const { x, y } = getCoordinates(e);
    // Throttle moves slightly
    if (Math.random() > 0.4) {
      sendInputEvent({ type: 'mouse', action: 'mousemove', x, y });
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? Math.round((e.clientX - rect.left) * (1280 / rect.width)) : 640;
    const y = rect ? Math.round((e.clientY - rect.top) * (1280 / rect.height)) : 400;
    sendInputEvent({
      type: 'wheel',
      action: 'wheel',
      x,
      y,
      deltaX: Math.round(e.deltaX),
      deltaY: Math.round(e.deltaY)
    });
  };

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    e.preventDefault();
    sendInputEvent({
      type: 'keyboard',
      action: 'keydown',
      key: e.key,
      code: e.code,
      text: e.key.length === 1 ? e.key : undefined
    });
  };

  const handleCanvasKeyUp = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!activeTabId) return;
    e.preventDefault();
    sendInputEvent({
      type: 'keyboard',
      action: 'keyup',
      key: e.key,
      code: e.code
    });
  };

  const sendInputEvent = (event: any) => {
    if (!activeTabId) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', tabId: activeTabId, event }));
    } else {
      fetch('/api/browser/tabs/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: activeTabId, event })
      }).catch(() => {});
    }
  };

  // Extension Management Actions
  const handleToggleExtension = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/browser/extensions/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled })
      });
      if (res.ok) {
        setExtensions(prev => prev.map(e => e.id === id ? { ...e, enabled } : e));
        onNotify?.('Extension Updated', `${enabled ? 'Enabled' : 'Disabled'} ${id} (Chromium flags updated)`, 'Browser');
      }
    } catch {}
  };

  const handleInstallUnpacked = async () => {
    if (!unpackedPathInput.trim()) return;
    setIsInstallingUnpacked(true);
    try {
      const res = await fetch('/api/browser/extensions/install-unpacked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDir: unpackedPathInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        onNotify?.('Extension Installed', data.message, 'Browser');
        refreshEngineData();
      } else {
        onNotify?.('Install Failed', data.message, 'Browser');
      }
    } catch (err: any) {
      onNotify?.('Error', err.message, 'Browser');
    } finally {
      setIsInstallingUnpacked(false);
    }
  };

  const handleUninstallExtension = async (id: string) => {
    try {
      const res = await fetch(`/api/browser/extensions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setExtensions(prev => prev.filter(e => e.id !== id));
        onNotify?.('Extension Removed', `Uninstalled ${id}`, 'Browser');
      }
    } catch {}
  };

  const handleOpenDoctor = async () => {
    setIsDoctorModalOpen(true);
    try {
      const res = await fetch('/api/browser/doctor');
      if (res.ok) {
        const report = await res.json();
        setDoctorReport(report);
      }
    } catch {}
  };

  // Active Extension icon badge resolver
  const getExtensionIcon = (ext: ArclightExtension) => {
    if (ext.id.includes('dark-reader')) return <Moon size={14} className="text-amber-400" />;
    if (ext.id.includes('adblock')) return <Shield size={14} className="text-emerald-400" />;
    if (ext.id.includes('json')) return <FileCode size={14} className="text-sky-400" />;
    if (ext.id.includes('bridge')) return <Terminal size={14} className="text-purple-400" />;
    return <Puzzle size={14} className="text-white/70" />;
  };

  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className={`w-full h-full bg-[#1e1e1e] flex flex-col font-sans select-none overflow-hidden text-xs ${settings?.theme === 'light' ? 'filter invert hue-rotate-180' : ''}`}>
      {/* 1. REAL TABS BAR */}
      <div className="h-9 bg-[#1a1a1a] border-b border-white/10 px-2 flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group h-7 max-w-[220px] min-w-[120px] px-2.5 rounded-t-lg flex items-center gap-2 cursor-pointer transition-colors border-t border-x ${
                isActive
                  ? 'bg-[#282828] border-white/10 text-white font-medium'
                  : 'bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <img
                src={tab.favicon || 'https://www.google.com/favicon.ico'}
                alt=""
                className="w-3.5 h-3.5 rounded shrink-0 object-contain"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
              <span className="flex-1 truncate text-[11px]">{tab.title || 'New Tab'}</span>
              <button
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="w-4 h-4 rounded hover:bg-white/20 flex items-center justify-center text-white/40 hover:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}

        <button
          onClick={() => handleNewTab()}
          className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white ml-1 shrink-0"
          title="New Tab (Ctrl+T)"
        >
          <Plus size={14} />
        </button>

        <div className="flex-1" />

        {/* Real Chromium Indicator & Doctor shortcut */}
        <button
          onClick={handleOpenDoctor}
          className="px-2 py-0.5 bg-black/40 hover:bg-black/60 border border-white/10 rounded flex items-center gap-1.5 text-[10px] text-white/70 hover:text-white transition-colors"
          title="Arclight Engine Doctor"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Chromium 154</span>
          <span className="text-white/40">|</span>
          <span className="text-white/50">{fps} FPS</span>
        </button>
      </div>

      {/* 2. OMNIBOX & EXTENSION TOOLBAR */}
      <div className="h-10 bg-[#242424] border-b border-white/10 px-3 flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleNavAction('back')}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Back"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => handleNavAction('forward')}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Forward"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => handleNavAction('reload')}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Reload"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin text-amber-400' : ''} />
          </button>
          <button
            onClick={() => handleNavigate('https://www.google.com')}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Home"
          >
            <Home size={14} />
          </button>
        </div>

        {/* Omnibox Address Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNavigate(inputUrl);
          }}
          className="flex-1 flex items-center"
        >
          <div className="w-full bg-black/50 border border-white/15 focus-within:border-[#E95420] rounded-xl px-3 py-1 flex items-center gap-2 transition-colors">
            <Lock size={12} className="text-emerald-400 shrink-0" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="flex-1 bg-transparent text-white/90 text-xs outline-none font-mono"
              placeholder="Search Google or enter URL / arclight://extensions..."
            />
            {isLoading && <span className="text-[10px] text-amber-400 font-mono animate-pulse">CDP NAV...</span>}
          </div>
        </form>

        {/* GENUINE CHROME EXTENSIONS TOOLBAR */}
        <div className="flex items-center gap-1 pl-1 border-l border-white/10">
          {extensions.filter(e => e.enabled).map((ext) => (
            <button
              key={ext.id}
              onClick={() => setActiveExtensionPopup(activeExtensionPopup?.id === ext.id ? null : ext)}
              className={`w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center transition-colors relative ${
                activeExtensionPopup?.id === ext.id ? 'bg-white/15 ring-1 ring-white/30' : ''
              }`}
              title={`${ext.name} (v${ext.version})`}
            >
              {getExtensionIcon(ext)}
            </button>
          ))}

          {/* Extensions Menu Button (Puzzle Icon) */}
          <button
            onClick={() => setIsExtensionsModalOpen(true)}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Extensions Manager"
          >
            <Puzzle size={15} />
          </button>

          {/* Engine Doctor Button */}
          <button
            onClick={handleOpenDoctor}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
            title="Browser Engine Diagnostics"
          >
            <Activity size={15} />
          </button>
        </div>
      </div>

      {/* 3. BOOKMARKS & SHORTCUTS BAR */}
      <div className="h-7 bg-[#1c1c1c] border-b border-white/5 px-3 flex items-center gap-4 text-[11px] text-white/60 shrink-0">
        {bookmarks.map((bm) => (
          <button
            key={bm.title}
            onClick={() => handleNavigate(bm.url)}
            className="hover:text-white flex items-center gap-1.5 transition-colors"
          >
            {bm.icon === 'ext' ? <Puzzle size={11} className="text-amber-400" />
              : bm.icon === 'doc' ? <Activity size={11} className="text-emerald-400" />
              : <Globe size={11} className="text-sky-400" />}
            <span>{bm.title}</span>
          </button>
        ))}
      </div>

      {/* 4. REAL CHROMIUM VIEWPORT CANVAS */}
      <div className="flex-1 w-full bg-[#121212] relative flex items-center justify-center overflow-hidden">
        {viewportFrame ? (
          <canvas
            ref={canvasRef}
            width={1280}
            height={800}
            tabIndex={0}
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onMouseUp={handleCanvasMouseUp}
            onMouseMove={handleCanvasMouseMove}
            onWheel={handleCanvasWheel}
            onKeyDown={handleCanvasKeyDown}
            onKeyUp={handleCanvasKeyUp}
            className="w-full h-full object-contain cursor-default outline-none bg-black shadow-2xl"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-8 space-y-3">
            <Globe size={40} className="text-white/20 animate-spin" />
            <h3 className="text-sm font-semibold text-white">Connecting to Chromium Engine...</h3>
            <p className="text-xs text-white/50 max-w-md">
              Starting headless Chromium 154 instance on port 9222 with 4 verified Chrome extensions.
            </p>
          </div>
        )}

        {/* EXTENSION POPUP DROPDOWN (Native popup rendering) */}
        {activeExtensionPopup && (
          <div className="absolute top-2 right-4 z-40 bg-[#1c1c1c] border border-white/20 rounded-xl shadow-2xl p-4 w-72 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
              <div className="flex items-center gap-2">
                {getExtensionIcon(activeExtensionPopup)}
                <span className="font-bold text-white text-xs">{activeExtensionPopup.name}</span>
              </div>
              <button onClick={() => setActiveExtensionPopup(null)} className="text-white/40 hover:text-white">
                <X size={14} />
              </button>
            </div>

            <div className="text-[11px] text-white/70 space-y-2">
              <p>{activeExtensionPopup.description}</p>
              <div className="p-2 bg-black/40 rounded-lg space-y-1 font-mono text-[10px]">
                <div className="flex justify-between">
                  <span className="text-white/40">Version:</span>
                  <span className="text-white">{activeExtensionPopup.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Manifest:</span>
                  <span className="text-emerald-400">{activeExtensionPopup.runtimeType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Service Worker:</span>
                  <span className={activeExtensionPopup.serviceWorkerActive ? 'text-emerald-400' : 'text-white/40'}>
                    {activeExtensionPopup.serviceWorkerActive ? 'ACTIVE' : 'IDLE'}
                  </span>
                </div>
              </div>

              {activeExtensionPopup.hasPopup && activeExtensionPopup.popupHtml && (
                <div className="pt-2 border-t border-white/10">
                  <div className="text-[10px] uppercase font-bold text-white/40 mb-1">Extension Action View</div>
                  <iframe
                    srcDoc={activeExtensionPopup.popupHtml}
                    title="Popup"
                    className="w-full h-44 rounded border border-white/10 bg-[#181818]"
                  />
                </div>
              )}

              <div className="pt-2 flex justify-between items-center">
                <button
                  onClick={() => handleToggleExtension(activeExtensionPopup.id, false)}
                  className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded font-semibold text-[10px]"
                >
                  Disable
                </button>
                <button
                  onClick={() => {
                    setIsExtensionsModalOpen(true);
                    setActiveExtensionPopup(null);
                  }}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded font-semibold text-[10px]"
                >
                  Manage
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. EXTENSIONS MANAGER MODAL (`arclight://extensions`) */}
      {isExtensionsModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#202020] border border-white/15 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="h-14 border-b border-white/10 px-6 flex items-center justify-between shrink-0 bg-[#242424]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#E95420] flex items-center justify-center text-white">
                  <Puzzle size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Arclight Chrome Extensions</h2>
                  <p className="text-[11px] text-white/50">Genuine Manifest V3 Chrome Extension Runtime in Chromium</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                  {extensions.filter(e => e.enabled).length} Active Extensions
                </span>
                <button
                  onClick={() => setIsExtensionsModalOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Load Unpacked Banner */}
              <div className="bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col md:flex-row items-center gap-3 justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">Load Unpacked Chrome Extension</h4>
                  <p className="text-[11px] text-white/50">Install an extension folder directly into Arclight Chromium.</p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <input
                    type="text"
                    value={unpackedPathInput}
                    onChange={(e) => setUnpackedPathInput(e.target.value)}
                    placeholder="/path/to/extension_folder"
                    className="bg-black/60 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white font-mono w-64 outline-none focus:border-[#E95420]"
                  />
                  <button
                    onClick={handleInstallUnpacked}
                    disabled={isInstallingUnpacked}
                    className="px-4 py-1.5 bg-[#E95420] hover:bg-[#d04515] text-white font-semibold rounded-lg text-xs transition-colors shrink-0"
                  >
                    {isInstallingUnpacked ? 'Loading...' : 'Load'}
                  </button>
                </div>
              </div>

              {/* Installed Extensions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {extensions.map((ext) => (
                  <div
                    key={ext.id}
                    className="bg-black/30 border border-white/10 rounded-xl p-4 flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        {getExtensionIcon(ext)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-white text-xs truncate">{ext.name}</h3>
                          <span className="text-[10px] font-mono text-white/40">v{ext.version}</span>
                        </div>
                        <p className="text-[11px] text-white/60 line-clamp-2 mt-0.5">{ext.description}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-white/5 text-[10px] font-mono text-white/40">
                      <div className="flex justify-between">
                        <span>ID:</span>
                        <span className="text-white/70 truncate max-w-[180px]">{ext.id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Permissions:</span>
                        <span className="text-white/70 truncate max-w-[180px]">{ext.permissions.join(', ') || 'None'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setInspectingManifest(ext)}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-[11px] text-white/70 hover:text-white transition-colors"
                        >
                          Manifest
                        </button>
                        {ext.source !== 'BUILT_IN' && (
                          <button
                            onClick={() => handleUninstallExtension(ext.id)}
                            className="px-2 py-1 bg-red-950/40 hover:bg-red-900/40 text-red-300 rounded text-[11px] transition-colors"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-[11px] text-white/50">{ext.enabled ? 'Enabled' : 'Disabled'}</span>
                        <input
                          type="checkbox"
                          checked={ext.enabled}
                          onChange={(e) => handleToggleExtension(ext.id, e.target.checked)}
                          className="w-4 h-4 accent-[#E95420] cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. MANIFEST INSPECTOR MODAL */}
      {inspectingManifest && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-[#181818] border border-white/20 rounded-2xl w-full max-w-2xl max-h-[75vh] flex flex-col p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <h3 className="text-xs font-bold text-white">manifest.json — {inspectingManifest.name}</h3>
              <button onClick={() => setInspectingManifest(null)} className="text-white/40 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto bg-black/60 p-4 rounded-xl font-mono text-[11px] text-emerald-400">
              {JSON.stringify(inspectingManifest.manifest, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* 7. ENGINE DOCTOR MODAL (`arclight://version`) */}
      {isDoctorModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#202020] border border-white/15 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="h-14 border-b border-white/10 px-6 flex items-center justify-between shrink-0 bg-[#242424]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
                  <Activity size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Arclight Browser Engine Doctor</h2>
                  <p className="text-[11px] text-white/50">Comprehensive Audit of Chromium, CDP Protocol, and Extension Pipeline</p>
                </div>
              </div>
              <button
                onClick={() => setIsDoctorModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3 bg-black/40 p-4 rounded-xl border border-white/10">
                <div>
                  <span className="text-white/40">Chromium Binary:</span>
                  <div className="text-white font-semibold truncate">{engineStatus?.executablePath}</div>
                </div>
                <div>
                  <span className="text-white/40">Engine Version:</span>
                  <div className="text-emerald-400 font-semibold">{engineStatus?.version}</div>
                </div>
                <div>
                  <span className="text-white/40">Process PID:</span>
                  <div className="text-white">{engineStatus?.pid || 'SUPERVISED'}</div>
                </div>
                <div>
                  <span className="text-white/40">CDP Port:</span>
                  <div className="text-white">{engineStatus?.cdpPort} (ws://127.0.0.1:{engineStatus?.cdpPort})</div>
                </div>
              </div>

              <div className="border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10 text-white/60 font-semibold">
                      <th className="p-2.5">Subsystem Check</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Diagnostic Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-white/80">
                    {doctorReport?.checks?.map((check, idx) => {
                      const itemName = check.item || check.domain || `Check ${idx + 1}`;
                      const statusVal = check.status || check.verdict || 'WARN';
                      return (
                        <tr key={idx} className="hover:bg-white/5">
                          <td className="p-2.5 font-bold">{itemName.toUpperCase()}</td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              statusVal === 'PASS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {statusVal}
                            </span>
                          </td>
                          <td className="p-2.5 text-white/60 text-[10px]">{check.evidence}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
