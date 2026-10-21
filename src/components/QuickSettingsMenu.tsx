import React from 'react';
import { 
  Wifi, 
  WifiOff, 
  Bluetooth, 
  Moon, 
  Sun, 
  Volume2, 
  VolumeX, 
  SunMedium, 
  Settings as SettingsIcon, 
  Lock, 
  Power, 
  Battery, 
  Eye, 
  EyeOff,
  Plane,
  BellOff
} from 'lucide-react';
import { DesktopSettings } from '../types/desktop';

import { linux } from '../adapters/linuxAdapter';

interface QuickSettingsMenuProps {
  settings: DesktopSettings;
  hwState: {
    batteryLevel: number;
    isCharging: boolean;
    hasBattery: boolean;
    bluetoothEnabled: boolean;
    hostIp: string;
  };
  onUpdateSettings: (updater: (prev: DesktopSettings) => DesktopSettings) => void;
  onOpenSettings: (section?: string) => void;
  onLockScreen: () => void;
  onPowerOff: () => void;
  onClose: () => void;
}

export const QuickSettingsMenu: React.FC<QuickSettingsMenuProps> = ({
  settings,
  hwState,
  onUpdateSettings,
  onOpenSettings,
  onLockScreen,
  onPowerOff,
  onClose
}) => {
  return (
    <div 
      className="quick-settings-menu absolute top-8 right-2 w-84 bg-[#1e1e1e]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-4 shadow-2xl z-50 text-white select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Quick Toggle Tiles (GNOME 46 / Ubuntu 24/26 style) */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {/* Wi-Fi */}
        <button
          onClick={async () => {
            const newVal = !settings.wifiEnabled;
            onUpdateSettings(s => ({ ...s, wifiEnabled: newVal }));
            await linux.executeAction('network.toggle', 'eth0', newVal);
          }}
          className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
            settings.wifiEnabled ? 'bg-[#E95420] text-white shadow-md' : 'bg-white/5 hover:bg-white/10 text-white/70'
          }`}
        >
          {settings.wifiEnabled ? <Wifi size={18} /> : <WifiOff size={18} />}
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">Wi-Fi</span>
            <span className="text-[10px] opacity-75 truncate">{settings.wifiEnabled ? hwState.hostIp : 'Off'}</span>
          </div>
        </button>

        {/* Bluetooth */}
        <button
          onClick={async () => {
            const newVal = !settings.bluetoothEnabled;
            onUpdateSettings(s => ({ ...s, bluetoothEnabled: newVal }));
            await linux.executeAction('bluetooth.toggle', 'hci0', newVal);
          }}
          className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
            settings.bluetoothEnabled ? 'bg-[#E95420] text-white shadow-md' : 'bg-white/5 hover:bg-white/10 text-white/70'
          }`}
        >
          <Bluetooth size={18} />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">Bluetooth</span>
            <span className="text-[10px] opacity-75 truncate">{settings.bluetoothEnabled ? 'Active' : 'Off'}</span>
          </div>
        </button>

        {/* Dark Style */}
        <button
          onClick={() => onUpdateSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
          className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
            settings.theme === 'dark' ? 'bg-[#E95420] text-white shadow-md' : 'bg-white/5 hover:bg-white/10 text-white/70'
          }`}
        >
          {settings.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">Dark Style</span>
            <span className="text-[10px] opacity-75 truncate">{settings.theme === 'dark' ? 'On' : 'Light'}</span>
          </div>
        </button>

        {/* Night Light */}
        <button
          onClick={() => onUpdateSettings(s => ({ ...s, nightLight: !s.nightLight }))}
          className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
            settings.nightLight ? 'bg-[#E95420] text-white shadow-md' : 'bg-white/5 hover:bg-white/10 text-white/70'
          }`}
        >
          {settings.nightLight ? <Eye size={18} /> : <EyeOff size={18} />}
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">Night Light</span>
            <span className="text-[10px] opacity-75 truncate">{settings.nightLight ? '3200K Warm' : 'Off'}</span>
          </div>
        </button>

        {/* Do Not Disturb */}
        <button
          onClick={() => onUpdateSettings(s => ({ ...s, doNotDisturb: !s.doNotDisturb }))}
          className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
            settings.doNotDisturb ? 'bg-[#E95420] text-white shadow-md' : 'bg-white/5 hover:bg-white/10 text-white/70'
          }`}
        >
          <BellOff size={18} />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">DND</span>
            <span className="text-[10px] opacity-75 truncate">{settings.doNotDisturb ? 'Silent' : 'Off'}</span>
          </div>
        </button>

        {/* Power Mode */}
        <button
          onClick={() => onUpdateSettings(s => ({ 
            ...s, 
            powerMode: s.powerMode === 'performance' ? 'balanced' : s.powerMode === 'balanced' ? 'power-saver' : 'performance' 
          }))}
          className="flex items-center gap-2.5 p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 transition-all text-left"
        >
          <Battery size={18} className={hwState.isCharging ? 'text-emerald-400' : 'text-amber-400'} />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold leading-tight">Battery</span>
            <span className="text-[10px] text-white/50 capitalize truncate">
              {hwState.batteryLevel}% · {hwState.isCharging ? 'Charging' : 'On Battery'}
            </span>
          </div>
        </button>
      </div>

      {/* Sliders Area */}
      <div className="bg-white/5 rounded-xl p-3 flex flex-col gap-3 mb-4">
        {/* Volume Slider */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onUpdateSettings(s => ({ ...s, volume: s.volume > 0 ? 0 : 75 }))}
            className="text-white/70 hover:text-white transition-colors"
          >
            {settings.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.volume}
            onChange={(e) => onUpdateSettings(s => ({ ...s, volume: Number(e.target.value) }))}
            className="flex-1 accent-[#E95420] h-1.5 bg-white/20 rounded-lg cursor-pointer"
          />
          <span className="text-[11px] font-mono text-white/60 w-8 text-right">{settings.volume}%</span>
        </div>

        {/* Brightness Slider */}
        <div className="flex items-center gap-3">
          <SunMedium size={16} className="text-white/70" />
          <input
            type="range"
            min="10"
            max="100"
            value={settings.brightness}
            onChange={(e) => onUpdateSettings(s => ({ ...s, brightness: Number(e.target.value) }))}
            className="flex-1 accent-[#E95420] h-1.5 bg-white/20 rounded-lg cursor-pointer"
          />
          <span className="text-[11px] font-mono text-white/60 w-8 text-right">{settings.brightness}%</span>
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/10">
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title="Settings"
          >
            <SettingsIcon size={16} />
          </button>
          <button
            onClick={() => {
              onLockScreen();
              onClose();
            }}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title="Lock Screen"
          >
            <Lock size={16} />
          </button>
        </div>

        <button
          onClick={() => {
            onPowerOff();
            onClose();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium transition-colors"
        >
          <Power size={14} />
          <span>Power Off</span>
        </button>
      </div>
    </div>
  );
};
