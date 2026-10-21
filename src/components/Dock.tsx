import React, { useState } from 'react';
import { 
  Terminal, 
  Folder, 
  Globe, 
  Code, 
  Calculator, 
  Settings as SettingsIcon,
  Activity,
  Trash2,
  LayoutGrid
} from 'lucide-react';
import { AppId, AppDefinition, DesktopSettings, OsWindow } from '../types/desktop';

interface DockProps {
  settings: DesktopSettings;
  apps: AppDefinition[];
  windows: OsWindow[];
  activeWindowId: string | null;
  onLaunchApp: (appId: AppId) => void;
  onToggleOverview: () => void;
  isOverviewOpen: boolean;
  onCloseAppWindows: (appId: AppId) => void;
}

interface DockItem {
  id: AppId;
  name: string;
  icon: React.ReactNode;
  iconBg: string;
}

export const Dock: React.FC<DockProps> = ({
  settings,
  apps,
  windows,
  activeWindowId,
  onLaunchApp,
  onToggleOverview,
  isOverviewOpen,
  onCloseAppWindows
}) => {
  const [hoveredApp, setHoveredApp] = useState<AppId | 'trash' | 'grid' | null>(null);
  const [contextMenu, setContextMenu] = useState<{ appId: AppId; x: number; y: number } | null>(null);
  const [isDockHovered, setIsDockHovered] = useState(false);

  const dockApps = apps.filter(a => a.isFavorite);

  // Auto-hide calculation
  const shouldHide = settings.dockAutoHide && !isDockHovered;

  const isVertical = settings.dockPosition === 'left';
  const iconSizeClass = settings.dockIconSize <= 36 ? 'w-10 h-10' : settings.dockIconSize >= 52 ? 'w-14 h-14' : 'w-12 h-12';

  const handleContextMenu = (e: React.MouseEvent, appId: AppId) => {
    e.preventDefault();
    setContextMenu({ appId, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <aside
        onMouseEnter={() => setIsDockHovered(true)}
        onMouseLeave={() => {
          setIsDockHovered(false);
          setHoveredApp(null);
        }}
        className={`fixed z-40 transition-transform duration-200 select-none ${
          isVertical 
            ? `left-0 top-7 bottom-0 w-14 bg-[#111111]/92 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-2 justify-between ${
                shouldHide ? '-translate-x-[calc(100%-4px)]' : 'translate-x-0'
              }`
            : `bottom-0 left-0 right-0 h-14 bg-[#111111]/92 backdrop-blur-xl border-t border-white/10 flex flex-row items-center px-4 justify-between ${
                shouldHide ? 'translate-y-[calc(100%-4px)]' : 'translate-y-0'
              }`
        }`}
      >
        {/* Main Dock Apps Stack */}
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center gap-1.5`}>
          {dockApps.map((app) => {
            const appWindows = windows.filter(w => w.appId === app.id);
            const isRunning = appWindows.length > 0;
            const isActive = appWindows.some(w => w.id === activeWindowId && !w.isMinimized);

            return (
              <div key={app.id} className="relative group">
                <button
                  onClick={() => onLaunchApp(app.id)}
                  onContextMenu={(e) => handleContextMenu(e, app.id)}
                  onMouseEnter={() => setHoveredApp(app.id)}
                  onMouseLeave={() => setHoveredApp(null)}
                  className={`${iconSizeClass} rounded-xl flex items-center justify-center transition-all relative ${
                    isActive 
                      ? 'bg-white/15 shadow-inner' 
                      : isRunning 
                        ? 'bg-white/5 hover:bg-white/10' 
                        : 'hover:bg-white/10'
                  } active:scale-95`}
                >
                  {/* Running Indicator Pill on Left Edge (or Bottom edge) */}
                  {isRunning && (
                    <div 
                      className={`absolute rounded-full transition-all ${
                        isVertical 
                          ? `left-0.5 top-1/2 -translate-y-1/2 w-1 ${
                              isActive ? 'h-4 bg-[#E95420] shadow-[0_0_8px_rgba(233,84,32,0.8)]' : 'h-2 bg-white/70'
                            }`
                          : `bottom-0.5 left-1/2 -translate-x-1/2 h-1 ${
                              isActive ? 'w-4 bg-[#E95420] shadow-[0_0_8px_rgba(233,84,32,0.8)]' : 'w-2 bg-white/70'
                            }`
                      }`}
                    />
                  )}

                  {/* Icon */}
                  <div className="group-hover:scale-110 transition-transform">
                    {app.icon}
                  </div>
                </button>

                {/* Ubuntu Style Tooltip Bubble */}
                {hoveredApp === app.id && (
                  <div 
                    className={`absolute z-50 pointer-events-none px-2.5 py-1 bg-[#1a1a1a] text-white text-[11px] font-medium rounded-md shadow-xl border border-white/10 whitespace-nowrap ${
                      isVertical 
                        ? 'left-16 top-1/2 -translate-y-1/2' 
                        : '-top-9 left-1/2 -translate-x-1/2'
                    } animate-in fade-in duration-75`}
                  >
                    {app.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Section: Separator, Trash & Show Applications (9 Dots) */}
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center gap-1.5`}>
          <div className={`${isVertical ? 'w-8 h-px' : 'h-8 w-px'} bg-white/15 my-1`} />

          {/* Trash */}
          {settings.dockShowTrash && (
            <div className="relative">
              <button
                onClick={() => onLaunchApp('files')}
                onMouseEnter={() => setHoveredApp('trash')}
                onMouseLeave={() => setHoveredApp(null)}
                className={`${iconSizeClass} rounded-xl flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/10 transition-all active:scale-95`}
              >
                <Trash2 size={20} />
              </button>
              {hoveredApp === 'trash' && (
                <div 
                  className={`absolute z-50 pointer-events-none px-2.5 py-1 bg-[#1a1a1a] text-white text-[11px] font-medium rounded-md shadow-xl border border-white/10 whitespace-nowrap ${
                    isVertical ? 'left-16 top-1/2 -translate-y-1/2' : '-top-9 left-1/2 -translate-x-1/2'
                  }`}
                >
                  Trash
                </div>
              )}
            </div>
          )}

          {/* Show Applications / Overview 9-Dots Grid Button */}
          <div className="relative">
            <button
              onClick={onToggleOverview}
              onMouseEnter={() => setHoveredApp('grid')}
              onMouseLeave={() => setHoveredApp(null)}
              className={`${iconSizeClass} rounded-xl flex items-center justify-center transition-all ${
                isOverviewOpen 
                  ? 'bg-[#E95420] text-white shadow-md' 
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              } active:scale-95`}
              title="Show Applications"
            >
              <LayoutGrid size={22} />
            </button>
            {hoveredApp === 'grid' && (
              <div 
                className={`absolute z-50 pointer-events-none px-2.5 py-1 bg-[#1a1a1a] text-white text-[11px] font-medium rounded-md shadow-xl border border-white/10 whitespace-nowrap ${
                  isVertical ? 'left-16 top-1/2 -translate-y-1/2' : '-top-9 left-1/2 -translate-x-1/2'
                }`}
              >
                Show Applications
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e1e]/95 backdrop-blur-xl border border-white/15 rounded-xl py-1.5 shadow-2xl text-xs text-white min-w-44 select-none"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <button
            onClick={() => onLaunchApp(contextMenu.appId)}
            className="w-full text-left px-3 py-1.5 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2"
          >
            <span>Open New Window</span>
          </button>
          <div className="h-px bg-white/10 my-1" />
          <button
            onClick={() => onCloseAppWindows(contextMenu.appId)}
            className="w-full text-left px-3 py-1.5 hover:bg-red-600 hover:text-white transition-colors text-red-400"
          >
            <span>Quit</span>
          </button>
        </div>
      )}
    </>
  );
};
