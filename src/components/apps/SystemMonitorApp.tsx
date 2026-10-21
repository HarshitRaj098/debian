import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  RefreshCw, 
  XCircle, 
  Search, 
  Network, 
  Layers, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';

interface ProcessItem {
  pid: string;
  user: string;
  cpu: number;
  mem: number;
  stat: string;
  name: string;
}

interface SystemInfo {
  os: string;
  desktop: string;
  kernel: string;
  uptime: string;
  arch: string;
  nodeVersion: string;
  hostIp: string;
  packageCount: number;
  memory: {
    total: string;
    used: string;
    free: string;
    available: string;
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg: number[];
    usagePercent: number;
  };
  disk: {
    total: string;
    used: string;
    available: string;
    usagePercent: number;
    percentString: string;
    mountPoint: string;
  };
}

interface NetworkInterface {
  name: string;
  rxBytes: number;
  rxPackets: number;
  txBytes: number;
  txPackets: number;
}

export const SystemMonitorApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'processes' | 'resources' | 'storage'>('processes');
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [networkInfo, setNetworkInfo] = useState<{ ips: string[]; interfaces: NetworkInterface[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [killMessage, setKillMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fetchData = async () => {
    try {
      const [procRes, infoRes, netRes] = await Promise.all([
        fetch('/api/system/processes'),
        fetch('/api/system/info'),
        fetch('/api/system/network')
      ]);
      if (procRes.ok) {
        const procData = await procRes.json();
        setProcesses(procData.processes || []);
      }
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        setSystemInfo(infoData);
      }
      if (netRes.ok) {
        const netData = await netRes.json();
        setNetworkInfo(netData);
      }
    } catch {
      // Handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleEndProcess = async (pid: string) => {
    try {
      const res = await fetch('/api/system/process/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid, signal: '-15' })
      });
      const data = await res.json();
      if (res.ok) {
        setKillMessage({ text: `Terminated process PID ${pid}` });
        setProcesses(prev => prev.filter(p => p.pid !== pid));
        setSelectedPid(null);
      } else {
        setKillMessage({ text: `Cannot kill PID ${pid}: ${data.error || 'Permission denied'}`, isError: true });
      }
    } catch (e: any) {
      setKillMessage({ text: `Error: ${e.message}`, isError: true });
    }
    setTimeout(() => setKillMessage(null), 3500);
  };

  const filteredProcesses = processes.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.pid.includes(q) || p.user.toLowerCase().includes(q);
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] text-white flex flex-col font-sans select-none overflow-hidden text-xs">
      {/* GNOME System Monitor Top Tabs Bar */}
      <div className="h-10 bg-[#252525] border-b border-white/10 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('processes')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'processes' 
                ? 'bg-[#E95420] text-white shadow' 
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Activity size={14} />
            <span>Processes ({processes.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'resources' 
                ? 'bg-[#E95420] text-white shadow' 
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Cpu size={14} />
            <span>Resources</span>
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'storage' 
                ? 'bg-[#E95420] text-white shadow' 
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <HardDrive size={14} />
            <span>File Systems</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {killMessage && (
            <span className={`text-[11px] px-2 py-0.5 rounded ${killMessage.isError ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {killMessage.text}
            </span>
          )}
          <button
            onClick={fetchData}
            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
            title="Refresh System Data"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'processes' && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#181818]">
          {/* Search Bar & End Process Toolbar */}
          <div className="px-4 py-2 bg-[#202020] border-b border-white/5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 bg-black/30 border border-white/10 px-2.5 py-1 rounded-lg w-72">
              <Search size={13} className="text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search processes by name, PID, user..."
                className="bg-transparent text-xs text-white placeholder-white/30 outline-none w-full"
              />
            </div>

            <div className="flex items-center gap-2">
              {selectedPid ? (
                <button
                  onClick={() => handleEndProcess(selectedPid)}
                  className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow"
                >
                  <XCircle size={13} />
                  <span>Kill PID {selectedPid}</span>
                </button>
              ) : (
                <span className="text-[11px] text-white/40">Select a process row to kill</span>
              )}
            </div>
          </div>

          {/* Processes Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#222222] text-[10px] uppercase font-semibold text-white/50 sticky top-0 border-b border-white/10 z-10">
                <tr>
                  <th className="p-2.5 pl-4">Process Name</th>
                  <th className="p-2.5">User</th>
                  <th className="p-2.5">PID</th>
                  <th className="p-2.5">% CPU</th>
                  <th className="p-2.5">% Memory</th>
                  <th className="p-2.5 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                {filteredProcesses.map((p) => {
                  const isSelected = selectedPid === p.pid;
                  return (
                    <tr
                      key={p.pid}
                      onClick={() => setSelectedPid(p.pid)}
                      className={`cursor-pointer transition-colors ${
                        isSelected 
                          ? 'bg-[#E95420]/30 text-white font-bold' 
                          : 'hover:bg-white/5 text-white/80'
                      }`}
                    >
                      <td className="p-2.5 pl-4 flex items-center gap-2 font-sans font-medium text-xs">
                        <div className={`w-2 h-2 rounded-full ${p.cpu > 2 ? 'bg-[#E95420]' : 'bg-emerald-400'}`} />
                        <span className="truncate max-w-56">{p.name}</span>
                      </td>
                      <td className="p-2.5 text-white/50 text-[10px]">{p.user}</td>
                      <td className="p-2.5 text-[#E95420] font-bold">{p.pid}</td>
                      <td className="p-2.5 tabular-nums">{p.cpu.toFixed(1)}%</td>
                      <td className="p-2.5 tabular-nums">{p.mem.toFixed(1)}%</td>
                      <td className="p-2.5 pr-4 text-white/40 text-[10px]">{p.stat}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-4 py-2 bg-[#202020] border-t border-white/10 text-[11px] text-white/50 flex items-center justify-between">
            <span>Showing {filteredProcesses.length} of {processes.length} Linux processes</span>
            <span className="font-mono text-emerald-400">Host Process Gateway Active</span>
          </div>
        </div>
      )}

      {activeTab === 'resources' && (
        <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-[#181818]">
          {/* CPU History Card */}
          <div className="bg-[#242424] border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-[#E95420]" />
                <span className="font-bold text-white text-sm">CPU Utilization</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-[#E95420] font-bold">{systemInfo?.cpu.usagePercent || 5}% Active</span>
                <span className="text-white/40">Load Avg: {systemInfo?.cpu.loadAvg?.join(', ') || '0.1, 0.1, 0.05'}</span>
              </div>
            </div>

            <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden">
              <div 
                className="bg-[#E95420] h-full rounded-full transition-all duration-500" 
                style={{ width: `${Math.max(5, systemInfo?.cpu.usagePercent || 5)}%` }} 
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-white/60 font-mono pt-1">
              <div>Processor: <span className="text-white font-semibold">{systemInfo?.cpu.model || 'Virtual x86_64 Core'}</span></div>
              <div>Cores: <span className="text-white font-semibold">{systemInfo?.cpu.cores || 2} vCPUs (Linux nproc)</span></div>
            </div>
          </div>

          {/* Memory & Swap Card */}
          <div className="bg-[#242424] border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-emerald-400" />
                <span className="font-bold text-white text-sm">Memory & Swap (Linux free)</span>
              </div>
              <span className="font-mono text-xs text-emerald-400 font-bold">
                {systemInfo?.memory.used || '240 MB'} / {systemInfo?.memory.total || '4.0 GB'} ({systemInfo?.memory.usagePercent || 6}%)
              </span>
            </div>

            <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${Math.max(4, systemInfo?.memory.usagePercent || 6)}%` }} 
              />
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs text-white/60 font-mono pt-1">
              <div>Total: <span className="text-white font-semibold">{systemInfo?.memory.total || '4.0 GB'}</span></div>
              <div>Used: <span className="text-white font-semibold">{systemInfo?.memory.used || '240 MB'}</span></div>
              <div>Available: <span className="text-emerald-400 font-semibold">{systemInfo?.memory.available || '3.5 GB'}</span></div>
            </div>
          </div>

          {/* Network Activity Card */}
          <div className="bg-[#242424] border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-sky-400" />
                <span className="font-bold text-white text-sm">Network Interfaces (/proc/net/dev)</span>
              </div>
              <span className="text-xs font-mono text-white/50">Host IP: {systemInfo?.hostIp || '127.0.0.1'}</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {networkInfo?.interfaces.map(iface => (
                <div key={iface.name} className="p-3 bg-black/20 rounded-xl border border-white/5 space-y-1 font-mono text-[11px]">
                  <div className="font-bold text-sky-400 flex items-center justify-between">
                    <span>{iface.name}</span>
                    <span className="text-[9px] text-white/40">Active</span>
                  </div>
                  <div className="text-white/60">RX: <span className="text-white font-semibold">{formatBytes(iface.rxBytes)}</span></div>
                  <div className="text-white/60">TX: <span className="text-white font-semibold">{formatBytes(iface.txBytes)}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'storage' && (
        <div className="flex-1 p-5 overflow-y-auto bg-[#181818] space-y-4">
          <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive size={18} className="text-amber-400" />
                <span className="text-sm font-bold text-white">Root File System (Linux df -B1)</span>
              </div>
              <span className="text-xs font-mono text-white/60">Mount: /</span>
            </div>

            <div className="w-full bg-white/10 h-3 rounded-full overflow-hidden">
              <div 
                className="bg-amber-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${Math.max(2, systemInfo?.disk.usagePercent || 1)}%` }} 
              />
            </div>

            <div className="grid grid-cols-4 gap-4 font-mono text-xs pt-1">
              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">Total Capacity</div>
                <div className="text-white font-bold text-sm mt-0.5">{systemInfo?.disk.total || '503.8 GB'}</div>
              </div>
              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">Used Space</div>
                <div className="text-white font-bold text-sm mt-0.5">{systemInfo?.disk.used || '269 MB'}</div>
              </div>
              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">Available Space</div>
                <div className="text-emerald-400 font-bold text-sm mt-0.5">{systemInfo?.disk.available || '503.5 GB'}</div>
              </div>
              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="text-[10px] text-white/40 uppercase">Usage Percentage</div>
                <div className="text-amber-400 font-bold text-sm mt-0.5">{systemInfo?.disk.percentString || '1%'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
