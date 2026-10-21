import React from 'react';
import { 
  FolderPlus, 
  FilePlus, 
  Terminal, 
  Image, 
  Monitor, 
  Settings as SettingsIcon, 
  RefreshCw 
} from 'lucide-react';

interface DesktopContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onOpenTerminal: () => void;
  onOpenSettings: (section?: string) => void;
  onRefresh: () => void;
}

export const DesktopContextMenu: React.FC<DesktopContextMenuProps> = ({
  x,
  y,
  onClose,
  onNewFolder,
  onNewFile,
  onOpenTerminal,
  onOpenSettings,
  onRefresh
}) => {
  return (
    <div 
      className="fixed z-50 bg-[#1e1e1e]/95 backdrop-blur-2xl border border-white/15 rounded-xl py-1.5 shadow-2xl text-xs text-white min-w-52 select-none animate-in fade-in zoom-in-95 duration-75"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 260) }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onNewFolder();
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <FolderPlus size={15} />
        <span>New Folder</span>
      </button>

      <button
        onClick={() => {
          onNewFile();
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <FilePlus size={15} />
        <span>New Document</span>
      </button>

      <div className="h-px bg-white/10 my-1" />

      <button
        onClick={() => {
          onOpenTerminal();
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <Terminal size={15} />
        <span>Open in Terminal</span>
      </button>

      <div className="h-px bg-white/10 my-1" />

      <button
        onClick={() => {
          onOpenSettings('appearance');
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <Image size={15} />
        <span>Change Background...</span>
      </button>

      <button
        onClick={() => {
          onOpenSettings('displays');
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <Monitor size={15} />
        <span>Display Settings...</span>
      </button>

      <button
        onClick={() => {
          onOpenSettings();
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-[#E95420] hover:text-white transition-colors flex items-center gap-2.5"
      >
        <SettingsIcon size={15} />
        <span>System Settings...</span>
      </button>

      <div className="h-px bg-white/10 my-1" />

      <button
        onClick={() => {
          onRefresh();
          onClose();
        }}
        className="w-full text-left px-3.5 py-2 hover:bg-white/10 transition-colors flex items-center gap-2.5 text-white/70"
      >
        <RefreshCw size={14} />
        <span>Refresh Desktop</span>
      </button>
    </div>
  );
};
