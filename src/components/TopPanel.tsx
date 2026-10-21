import React from 'react';
import { 
  Wifi, 
  WifiOff, 
  Volume2, 
  VolumeX, 
  Battery, 
  ChevronDown,
  Bell,
  Terminal,
  Folder,
  Globe,
  Code,
  Calculator,
  Settings as SettingsIcon,
  Activity,
  LayoutGrid
} from 'lucide-react';
import { DesktopSettings, OsWindow, AppId } from '../types/desktop';

interface TopPanelProps {
  currentTime: string;
  isOverviewOpen: boolean;
  onToggleOverview: () => void;
  onOpenApplications: () => void;
  activeWindow: OsWindow | null;
  settings: DesktopSettings;
  hwState: {
    batteryLevel: number;
    isCharging: boolean;
    hasBattery: boolean;
    bluetoothEnabled: boolean;
    hostIp: string;
  };
  isQuickSettingsOpen: boolean;
  onToggleQuickSettings: () => void;
  onOpenWifiQuickSettings: () => void;
  onOpenVolumeQuickSettings: () => void;
  onOpenPowerQuickSettings: () => void;
  isCalendarOpen: boolean;
  calendarTab: 'calendar' | 'notifications';
  onOpenCalendar: () => void;
  onOpenNotifications: () => void;
  unreadNotificationCount: number;
}

const getAppIcon = (appId: AppId) => {
  switch (appId) {
    case 'terminal': return <Terminal size={13} className="text-emerald-400" />;
    case 'files': return <Folder size={13} className="text-amber-400" />;
    case 'browser': return <Globe size={13} className="text-sky-400" />;
    case 'vscode': return <Code size={13} className="text-blue-400" />;
    case 'calculator': return <Calculator size={13} className="text-orange-400" />;
    case 'settings': return <SettingsIcon size={13} className="text-purple-400" />;
    case 'monitor': return <Activity size={13} className="text-rose-400" />;
    default: return null;
  }
};

export const TopPanel: React.FC<TopPanelProps> = ({
  currentTime,
  isOverviewOpen,
  onToggleOverview,
  onOpenApplications,
  activeWindow,
  settings,
  hwState,
  isQuickSettingsOpen,
  onToggleQuickSettings,
  onOpenWifiQuickSettings,
  onOpenVolumeQuickSettings,
  onOpenPowerQuickSettings,
  isCalendarOpen,
  calendarTab,
  onOpenCalendar,
  onOpenNotifications,
  unreadNotificationCount
}) => {
  return (
    <header className="h-7 bg-[#0c0c0c]/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-3 text-xs font-medium text-white/90 z-50 select-none shrink-0 relative">
      {/* Left: Activities & Applications & Active App Title */}
      <div className="flex items-center gap-1">
        {/* Activities Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleOverview();
          }}
          className={`px-3 py-0.5 rounded-full transition-all text-xs font-semibold ${
            isOverviewOpen 
              ? 'bg-[#E95420] text-white shadow-sm' 
              : 'hover:bg-white/10 text-white/90 active:scale-95'
          }`}
          title="Activities (Overview & Workspaces)"
        >
          Activities
        </button>

        {/* Applications Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenApplications();
          }}
          className="px-2.5 py-0.5 rounded-full transition-all text-xs font-semibold hover:bg-white/10 text-white/70 hover:text-white flex items-center gap-1 active:scale-95"
          title="Applications (App Launcher Grid)"
        >
          <LayoutGrid size={11} className="text-[#E95420]" />
          <span>Applications</span>
        </button>

        {/* Active Window Title */}
        {activeWindow && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-white/10 text-white/80 transition-colors cursor-default text-[11px] ml-1">
            {getAppIcon(activeWindow.appId)}
            <span className="font-semibold truncate max-w-48">{activeWindow.title}</span>
          </div>
        )}
      </div>

      {/* Center: Dynamic Clock & Date & Notifications */}
      <div className="flex items-center gap-1">
        {/* Date/Time Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenCalendar();
          }}
          className={`date-time-trigger px-3 py-0.5 rounded-full transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 ${
            isCalendarOpen && calendarTab === 'calendar'
              ? 'bg-white/20 text-white shadow-sm ring-1 ring-white/20' 
              : 'hover:bg-white/10 text-white/90'
          }`}
          title="Clock & Calendar (Click to toggle panel)"
        >
          <span>{currentTime}</span>
        </button>

        {/* Notifications Bell Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenNotifications();
          }}
          className={`notification-bell-trigger p-1 px-1.5 rounded-full hover:bg-white/10 transition-all relative flex items-center justify-center cursor-pointer active:scale-95 ${
            isCalendarOpen && calendarTab === 'notifications'
              ? 'bg-white/20 text-white shadow-sm ring-1 ring-white/20'
              : unreadNotificationCount > 0 
                ? 'text-[#E95420]' 
                : 'text-white/70 hover:text-white'
          }`}
          title={`Notification Center (${unreadNotificationCount} unread - Click to open)`}
        >
          <Bell size={13} className={unreadNotificationCount > 0 ? 'text-[#E95420]' : ''} />
          {unreadNotificationCount > 0 && (
            <span className="ml-1 px-1 py-0.2 bg-[#E95420] text-white text-[9px] font-bold rounded-full min-w-3.5 h-3.5 flex items-center justify-center shadow-sm">
              {unreadNotificationCount}
            </span>
          )}
        </button>
      </div>

      {/* Right: Individual Interactive System Controls & Quick Settings */}
      <div className="flex items-center gap-1">
        {/* Wi-Fi Control */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenWifiQuickSettings();
          }}
          className="quick-settings-trigger px-1.5 py-0.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors cursor-pointer"
          title={`Wi-Fi: ${settings.wifiEnabled ? `Connected (${hwState.hostIp})` : 'Disconnected'}`}
        >
          {settings.wifiEnabled ? (
            <Wifi size={13} className="text-white/90" />
          ) : (
            <WifiOff size={13} className="text-white/40" />
          )}
        </button>

        {/* Volume Control */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenVolumeQuickSettings();
          }}
          className="quick-settings-trigger px-1.5 py-0.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors cursor-pointer"
          title={`Volume: ${settings.volume}%`}
        >
          {settings.volume === 0 ? (
            <VolumeX size={13} className="text-white/40" />
          ) : (
            <Volume2 size={13} className="text-white/90" />
          )}
        </button>

        {/* Battery / Power Control */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenPowerQuickSettings();
          }}
          className="quick-settings-trigger flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors font-mono text-[10px] cursor-pointer"
          title={`Battery: ${hwState.batteryLevel}% ${hwState.isCharging ? '(Charging)' : '(Discharging)'}`}
        >
          <Battery size={13} className={hwState.batteryLevel < 20 && !hwState.isCharging ? 'text-red-500' : 'text-white/90'} />
          <span className="text-white/60">{hwState.batteryLevel}%</span>
        </button>

        {/* System Menu Dropdown Toggle Pill */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleQuickSettings();
          }}
          className={`quick-settings-trigger p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer ${
            isQuickSettingsOpen ? 'bg-white/15 text-white' : ''
          }`}
          title="System Quick Settings"
        >
          <ChevronDown size={12} className={`transition-transform ${isQuickSettingsOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </header>
  );
};
