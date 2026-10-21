import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FileText, 
  FileCode, 
  Image, 
  ChevronLeft, 
  ChevronRight, 
  FolderPlus, 
  RefreshCw, 
  Trash2, 
  Search, 
  Home, 
  Monitor, 
  File, 
  Music, 
  HardDrive,
  Upload,
  Package,
  Download
} from 'lucide-react';
import { eventBridge } from '../../adapters/discoveryEngine';

interface FileItem {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

interface FilesAppProps {
  onOpenFileInEditor?: (path: string) => void;
}

export const FilesApp: React.FC<FilesAppProps> = ({ onOpenFileInEditor }) => {
  const [currentDir, setCurrentDir] = useState<string>('.');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [history, setHistory] = useState<string[]>(['.']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [showNewFolderModal, setShowNewFolderModal] = useState<boolean>(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [apkInstallBanner, setApkInstallBanner] = useState<{ success: boolean; message: string; details?: string } | null>(null);

  const handleInstallApkFromFile = async (filePath: string) => {
    setUploadMessage(`Validating & installing APK "${filePath}" via AndroidPackageService...`);
    setApkInstallBanner(null);
    try {
      const res = await fetch('/api/android/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apkPath: filePath, isLocalFile: true })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApkInstallBanner({
          success: true,
          message: data.message || `Installed ${data.applicationName} (${data.packageName}).`,
          details: `APK valid: YES | Signed: ${data.apkDiagnostics?.apkSigned ? 'YES' : 'UNVERIFIED'} | Runtime: READY`
        });
      } else {
        const diag = data.apkDiagnostics;
        setApkInstallBanner({
          success: false,
          message: `APK Installation Rejected: ${data.error || data.message || 'Android runtime offline'}`,
          details: diag
            ? `APK valid: ${diag.apkValid ? '✅ YES' : '❌ NO'} · Signed: ${diag.apkSigned ? '✅ YES' : '⚠️ UNVERIFIED'} · Package: ${data.applicationName || ''} (${data.packageName || ''}) · Runtime: ${diag.runtimeAvailable ? '✅ READY' : '❌ OFFLINE'}`
            : undefined
        });
      }
    } catch (e: any) {
      setApkInstallBanner({
        success: false,
        message: `APK Installer Error: ${e.message}`
      });
    } finally {
      setUploadMessage(null);
    }
  };

  const handleDropUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploadMessage(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    try {
      for (const file of files) {
        await new Promise<void>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onload = async () => {
            try {
              const base64 = (reader.result as string).split(',')[1];
              await fetch('/api/fs/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  targetDir: currentDir,
                  name: file.name,
                  base64
                })
              });
              resolve();
            } catch (e) {
              reject(e);
            }
          };
          reader.readAsDataURL(file);
        });
      }
      await fetchFiles(currentDir);
    } catch (e) {
      console.error('File upload failed:', e);
    } finally {
      setUploadMessage(null);
    }
  };

  const fetchFiles = async (dir: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setCurrentDir(data.relativeCurrentPath || dir);
      }
    } catch {
      // Fallback
      setItems([
        { name: 'Documents', path: 'Documents', relativePath: 'Documents', isDirectory: true, size: 4096, mtime: new Date().toISOString() },
        { name: 'Downloads', path: 'Downloads', relativePath: 'Downloads', isDirectory: true, size: 4096, mtime: new Date().toISOString() },
        { name: 'README.md', path: 'README.md', relativePath: 'README.md', isDirectory: false, size: 1024, mtime: new Date().toISOString() },
        { name: 'kernel.bin', path: 'kernel.bin', relativePath: 'kernel.bin', isDirectory: false, size: 2048, mtime: new Date().toISOString() }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(currentDir);

    const handleFsChange = (event: string) => {
      if (event === 'fs.changed') {
        fetchFiles(currentDir);
      }
    };

    const unsubscribe = eventBridge.subscribe(handleFsChange);
    
    // Also refresh on window focus
    const handleFocus = () => fetchFiles(currentDir);
    window.addEventListener('focus', handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentDir]);

  const navigateTo = (newDir: string) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(newDir);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setCurrentDir(newDir);
    fetchFiles(newDir);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      const target = history[nextIdx];
      setCurrentDir(target);
      fetchFiles(target);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      const target = history[nextIdx];
      setCurrentDir(target);
      fetchFiles(target);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await fetch('/api/fs/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: currentDir, name: newFolderName.trim() })
      });
      setNewFolderName('');
      setShowNewFolderModal(false);
      fetchFiles(currentDir);
    } catch {}
  };

  const handleDelete = async (filePath: string) => {
    try {
      await fetch(`/api/fs/delete?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
      fetchFiles(currentDir);
    } catch {}
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getFileIcon = (item: FileItem) => {
    if (item.isDirectory) {
      return <Folder size={38} className="text-amber-400 group-hover:scale-105 transition-transform" fill="#f59e0b" fillOpacity={0.2} />;
    }
    const ext = item.name.split('.').pop()?.toLowerCase();
    if (ext === 'apk') {
      return <Package size={38} className="text-[#E95420] group-hover:scale-105 transition-transform" />;
    }
    if (['ts', 'tsx', 'js', 'json', 'py', 'c', 'h', 'sh', 'html', 'css'].includes(ext || '')) {
      return <FileCode size={38} className="text-sky-400 group-hover:scale-105 transition-transform" />;
    }
    if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext || '')) {
      return <Image size={38} className="text-emerald-400 group-hover:scale-105 transition-transform" />;
    }
    return <FileText size={38} className="text-gray-300 group-hover:scale-105 transition-transform" />;
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] text-white flex flex-col font-sans select-none overflow-hidden">
      {/* Top Nautilus Toolbar */}
      <div className="h-11 bg-[#282828] border-b border-white/10 px-3 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            className="w-7 h-7 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center text-white/80 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            className="w-7 h-7 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center text-white/80 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => fetchFiles(currentDir)}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/80 transition-colors ml-1"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Breadcrumb Path Bar */}
        <div className="flex-1 max-w-lg bg-black/30 border border-white/10 rounded-lg px-3 py-1 text-xs text-white/80 flex items-center gap-1 font-mono truncate">
          <button onClick={() => navigateTo('.')} className="hover:text-[#E95420] transition-colors">~</button>
          {currentDir !== '.' && currentDir.split('/').filter(Boolean).map((part, i, arr) => {
            const pathUpTo = arr.slice(0, i + 1).join('/');
            return (
              <React.Fragment key={pathUpTo}>
                <span className="text-white/30">/</span>
                <button onClick={() => navigateTo(pathUpTo)} className="hover:text-[#E95420] transition-colors truncate">
                  {part}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Quick Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="bg-black/30 border border-white/10 text-white placeholder-white/30 text-xs pl-8 pr-3 py-1 rounded-lg w-32 focus:w-44 transition-all outline-none focus:border-[#E95420]"
            />
          </div>

          <button
            onClick={() => setShowNewFolderModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white transition-colors"
          >
            <FolderPlus size={14} />
            <span>New Folder</span>
          </button>
        </div>
      </div>

      {/* Main Nautilus View: Sidebar + File Grid */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-44 bg-[#181818] border-r border-white/10 p-2 flex flex-col gap-0.5 text-xs text-white/70 shrink-0">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Places</div>
          <button
            onClick={() => navigateTo('.')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
              currentDir === '.' ? 'bg-[#E95420] text-white font-semibold' : 'hover:bg-white/5 hover:text-white'
            }`}
          >
            <Home size={15} />
            <span>Home</span>
          </button>
          <button
            onClick={() => navigateTo('/home/ubuntu/Downloads')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
              currentDir.includes('Downloads') ? 'bg-[#E95420] text-white font-semibold' : 'hover:bg-white/5 hover:text-white'
            }`}
          >
            <Download size={15} />
            <span>Downloads (APKs)</span>
          </button>
          <button
            onClick={() => navigateTo('src')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
              currentDir === 'src' ? 'bg-[#E95420] text-white font-semibold' : 'hover:bg-white/5 hover:text-white'
            }`}
          >
            <Monitor size={15} />
            <span>Project Src</span>
          </button>
          <button
            onClick={() => navigateTo('app')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
              currentDir === 'app' ? 'bg-[#E95420] text-white font-semibold' : 'hover:bg-white/5 hover:text-white'
            }`}
          >
            <File size={15} />
            <span>App Root</span>
          </button>

          <div className="h-px bg-white/10 my-2" />

          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Devices</div>
          <button
            onClick={() => navigateTo('.')}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/5 hover:text-white transition-colors"
          >
            <HardDrive size={15} />
            <span>Linux Root (/)</span>
          </button>
        </div>

        {/* Content Grid with Drag & Drop Upload Zone */}
        <div 
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            if (!isDraggingOver) setIsDraggingOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDraggingOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
              handleDropUpload(files);
            }
          }}
          className="flex-1 p-4 overflow-y-auto bg-[#1a1a1a] relative"
        >
          {/* Visual Drop Overlay */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-[#E95420]/20 border-2 border-dashed border-[#E95420] rounded-xl flex flex-col items-center justify-center z-30 pointer-events-none backdrop-blur-xs">
              <Upload size={36} className="text-[#E95420] animate-bounce mb-2" />
              <span className="text-white font-bold text-sm">Drop files to upload here</span>
              <span className="text-white/60 text-xs">Files will be saved to {currentDir}</span>
            </div>
          )}

          {/* Upload Progress Bar */}
          {uploadMessage && (
            <div className="mb-3 px-3 py-2 bg-[#E95420]/15 border border-[#E95420]/40 rounded-xl text-white text-xs flex items-center gap-2 animate-pulse">
              <RefreshCw size={14} className="animate-spin text-[#E95420]" />
              <span>{uploadMessage}</span>
            </div>
          )}

          {apkInstallBanner && (
            <div className={`mb-3 p-3 rounded-xl border text-xs flex items-start justify-between gap-3 ${
              apkInstallBanner.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              <div className="space-y-1">
                <div className="font-bold">{apkInstallBanner.message}</div>
                {apkInstallBanner.details && (
                  <div className="font-mono text-[10px] text-white/70">{apkInstallBanner.details}</div>
                )}
              </div>
              <button
                onClick={() => setApkInstallBanner(null)}
                className="text-white/50 hover:text-white text-[11px] px-2 py-0.5 rounded bg-white/5"
              >
                Dismiss
              </button>
            </div>
          )}
          {loading ? (
            <div className="h-full flex items-center justify-center text-white/40 text-xs">
              <RefreshCw size={20} className="animate-spin mb-2" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40 text-xs">
              <Folder size={40} className="mb-2 opacity-30" />
              <span>This folder is empty</span>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.path}
                  onClick={() => setSelectedItem(item.path)}
                  onDoubleClick={() => {
                    if (item.isDirectory) {
                      navigateTo(item.relativePath);
                    } else if (item.name.toLowerCase().endsWith('.apk')) {
                      handleInstallApkFromFile(item.path);
                    } else if (onOpenFileInEditor) {
                      onOpenFileInEditor(item.path);
                    }
                  }}
                  className={`group flex flex-col items-center p-2.5 rounded-xl cursor-pointer transition-all border ${
                    selectedItem === item.path
                      ? 'bg-white/15 border-[#E95420]/60 shadow-md'
                      : 'border-transparent hover:bg-white/5'
                  }`}
                  title={`${item.name} (${item.isDirectory ? 'Folder' : `${(item.size / 1024).toFixed(1)} KB`})`}
                >
                  <div className="mb-1">
                    {getFileIcon(item)}
                  </div>
                  <span className="text-xs text-white/90 text-center font-medium truncate w-full group-hover:text-white">
                    {item.name}
                  </span>
                  <span className="text-[10px] text-white/40 mt-0.5">
                    {item.isDirectory ? 'Folder' : `${(item.size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nautilus Status Bar */}
      <div className="h-6 bg-[#242424] border-t border-white/10 px-3 flex items-center justify-between text-[11px] text-white/50 shrink-0 font-mono">
        <span>{filteredItems.length} items</span>
        <div className="flex items-center gap-3">
          {selectedItem && (
            <button
              onClick={() => handleDelete(selectedItem)}
              className="text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
            >
              <Trash2 size={12} />
              <span>Delete</span>
            </button>
          )}
          <span>AETHER Storage</span>
        </div>
      </div>

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowNewFolderModal(false)}
        >
          <div 
            className="bg-[#242424] border border-white/15 rounded-2xl p-5 w-80 shadow-2xl text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3">Create New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#E95420] mb-4"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[#E95420] hover:bg-[#d84818] font-bold text-white shadow"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
