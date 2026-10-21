import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Terminal, 
  Folder, 
  Globe, 
  Code, 
  Calculator, 
  Settings as SettingsIcon,
  Activity,
  X,
  Play,
  Layers
} from 'lucide-react';
import { AppId, AppDefinition, OsWindow } from '../types/desktop';
import { linux } from '../adapters/linuxAdapter';

interface ActivitiesOverviewProps {
  isOpen: boolean;
  onClose: () => void;
  apps: AppDefinition[];
  windows: OsWindow[];
  activeWorkspaceId: number;
  initialTab?: 'windows' | 'apps';
  onSelectWorkspace: (workspaceId: number) => void;
  onLaunchApp: (appId: AppId) => void;
  onFocusWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
}

export const ActivitiesOverview: React.FC<ActivitiesOverviewProps> = ({
  isOpen,
  onClose,
  apps,
  windows,
  activeWorkspaceId,
  initialTab = 'windows',
  onSelectWorkspace,
  onLaunchApp,
  onFocusWindow,
  onCloseWindow
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'windows' | 'apps'>(initialTab);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setActiveTab(initialTab);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(async () => {
        const results = await linux.searchFiles(searchQuery);
        setSearchResults(results);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  if (!isOpen) return null;

  const currentWorkspaceWindows = windows.filter(w => w.workspaceId === activeWorkspaceId && !w.isMinimized);

  const filteredApps = apps.filter(app => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return app.name.toLowerCase().includes(q) || 
           app.description.toLowerCase().includes(q) || 
           app.keywords.some(k => k.toLowerCase().includes(q));
  });

  const filteredWindows = windows.filter(w => {
    if (!searchQuery) return false;
    const q = searchQuery.toLowerCase();
    return w.title.toLowerCase().includes(q) || w.appId.toLowerCase().includes(q);
  });

  return (
    <div 
      className="fixed inset-0 z-40 bg-black/65 backdrop-blur-2xl flex flex-col items-center pt-10 pb-6 px-16 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Top Search Bar */}
      <div 
        className="w-full max-w-md relative mb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Type to search apps, windows, or commands..."
          className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/20 border border-white/15 focus:border-[#E95420] text-white placeholder-white/40 pl-10 pr-4 py-2.5 rounded-full outline-none text-sm shadow-2xl transition-all"
        />
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Workspace Body */}
      <div 
        className="flex-1 w-full max-w-6xl flex gap-8 min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left / Center Area */}
        <div className="flex-1 flex flex-col min-h-0">
          {searchQuery ? (
            /* Search Results View */
            <div className="flex-1 overflow-y-auto pr-2">
              {filteredWindows.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#E95420] mb-3">Open Windows</h3>
                  <div className="grid grid-cols-3 gap-4">
                    {filteredWindows.map(w => (
                      <div
                        key={w.id}
                        onClick={() => {
                          onFocusWindow(w.id);
                          onClose();
                        }}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Layers size={18} className="text-[#E95420]" />
                          <div className="text-left">
                            <div className="text-xs font-semibold text-white">{w.title}</div>
                            <div className="text-[10px] text-white/40">Workspace {w.workspaceId}</div>
                          </div>
                        </div>
                        <Play size={14} className="text-white/40" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">Applications</h3>
              <div className="grid grid-cols-4 gap-4 mb-6">
                {filteredApps.map(app => (
                  <button
                    key={app.id}
                    onClick={() => {
                      onLaunchApp(app.id);
                      onClose();
                    }}
                    className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 rounded-2xl p-4 flex flex-col items-center text-center gap-2 transition-all active:scale-95 group"
                  >
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-black/30 group-hover:scale-110 transition-transform">
                      {app.icon}
                    </div>
                    <span className="text-xs font-semibold text-white/90">{app.name}</span>
                    <span className="text-[10px] text-white/40 leading-snug line-clamp-2">{app.description}</span>
                  </button>
                ))}
              </div>

              {searchResults.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-500 mb-3">System Files & Resources</h3>
                  <div className="space-y-2">
                    {searchResults.map((res, i) => (
                      <div 
                        key={i}
                        onClick={() => {
                          if (res.type === 'APPLICATION') onLaunchApp(res.name.toLowerCase());
                          else onLaunchApp('files');
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {res.type === 'DIRECTORY' ? <Folder size={16} className="text-amber-400" /> : <Globe size={16} className="text-sky-400" />}
                          <div className="text-left">
                            <div className="text-xs font-medium text-white">{res.name}</div>
                            <div className="text-[10px] text-white/30 font-mono truncate max-w-md">{res.path}</div>
                          </div>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/30 text-white/40 border border-white/5 uppercase tracking-tighter">
                          {res.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Standard GNOME Windows Spread / App Grid */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Navigation Tabs (Windows Spread vs Applications) */}
              <div className="flex items-center justify-center gap-2 mb-6">
                <button
                  onClick={() => setActiveTab('windows')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeTab === 'windows' 
                      ? 'bg-white/20 text-white shadow-sm' 
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  Workspace Windows ({currentWorkspaceWindows.length})
                </button>
                <button
                  onClick={() => setActiveTab('apps')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeTab === 'apps' 
                      ? 'bg-white/20 text-white shadow-sm' 
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  All Applications
                </button>
              </div>

              {activeTab === 'windows' ? (
                /* Windows Overview Spread */
                <div className="flex-1 overflow-y-auto">
                  {currentWorkspaceWindows.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-white/40">
                      <Layers size={48} className="mb-3 opacity-30 text-[#E95420]" />
                      <span className="text-sm font-semibold">No open windows on Workspace {activeWorkspaceId}</span>
                      <button
                        onClick={() => setActiveTab('apps')}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-[#E95420] text-white text-xs font-medium hover:bg-[#d84818] transition-colors"
                      >
                        Launch an Application
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 p-2">
                      {currentWorkspaceWindows.map((win) => (
                        <div
                          key={win.id}
                          onClick={() => {
                            onFocusWindow(win.id);
                            onClose();
                          }}
                          className="bg-[#1e1e1e] hover:bg-[#282828] border border-white/10 hover:border-[#E95420] rounded-2xl overflow-hidden shadow-2xl transition-all cursor-pointer group flex flex-col h-56"
                        >
                          {/* Mini Window Title Header */}
                          <div className="bg-[#121212] px-3 py-2 flex items-center justify-between border-b border-white/5">
                            <span className="text-xs font-semibold truncate text-white/90">{win.title}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseWindow(win.id);
                              }}
                              className="w-5 h-5 rounded-full bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {/* Miniature Preview Representation */}
                          <div className="flex-1 bg-black/40 p-4 flex flex-col items-center justify-center text-white/50 group-hover:scale-105 transition-transform">
                            {win.appId === 'terminal' && <Terminal size={40} className="text-emerald-400 opacity-80" />}
                            {win.appId === 'files' && <Folder size={40} className="text-amber-400 opacity-80" />}
                            {win.appId === 'browser' && <Globe size={40} className="text-sky-400 opacity-80" />}
                            {win.appId === 'vscode' && <Code size={40} className="text-blue-400 opacity-80" />}
                            {win.appId === 'calculator' && <Calculator size={40} className="text-orange-400 opacity-80" />}
                            {win.appId === 'settings' && <SettingsIcon size={40} className="text-purple-400 opacity-80" />}
                            {win.appId === 'monitor' && <Activity size={40} className="text-rose-400 opacity-80" />}
                            <span className="text-xs font-medium text-white/70 mt-2">{win.title}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Full Ubuntu Application Grid */
                <div className="flex-1 overflow-y-auto grid grid-cols-4 gap-6 p-4">
                  {apps.map(app => (
                    <button
                      key={app.id}
                      onClick={() => {
                        onLaunchApp(app.id);
                        onClose();
                      }}
                      className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl p-5 flex flex-col items-center text-center gap-2.5 transition-all active:scale-95 group"
                    >
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-black/30 group-hover:scale-110 transition-transform shadow-lg">
                        {app.icon}
                      </div>
                      <span className="text-xs font-bold text-white">{app.name}</span>
                      <span className="text-[11px] text-white/40 leading-snug">{app.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Workspaces Strip (GNOME Shell Style) */}
        <div className="w-36 flex flex-col gap-3 py-2 border-l border-white/10 pl-4 justify-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Workspaces</span>
          {[1, 2, 3, 4].map(wId => {
            const count = windows.filter(w => w.workspaceId === wId).length;
            const isCurrent = wId === activeWorkspaceId;
            return (
              <button
                key={wId}
                onClick={() => onSelectWorkspace(wId)}
                className={`w-full h-20 rounded-xl p-2 flex flex-col justify-between text-left transition-all border ${
                  isCurrent 
                    ? 'border-[#E95420] bg-[#E95420]/20 shadow-lg scale-105' 
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[10px] font-bold ${isCurrent ? 'text-[#E95420]' : 'text-white/60'}`}>
                    Desktop {wId}
                  </span>
                  {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-[#E95420]" />}
                </div>
                <span className="text-[9px] text-white/40">
                  {count === 0 ? 'Empty' : `${count} window${count > 1 ? 's' : ''}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
