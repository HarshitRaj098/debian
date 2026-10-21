import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Terminal,
  Activity,
  Download,
  HardDrive,
  Cpu,
  Layers,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Sliders,
  CornerDownLeft,
  CircleDot
} from 'lucide-react';
import {
  RemoteRuntimeStatus,
  RemoteRuntimeConfig,
  TestApkAcceptanceReport,
  AndroidEndToEndVerificationReport,
  VerificationStageCheck,
  QuickInstallReport,
  QuickInstallStageDetail
} from '../../types/android';

interface AndroidBridgeAppProps {
  onNotify?: (title: string, message: string, app?: string) => void;
}

export const AndroidBridgeApp: React.FC<AndroidBridgeAppProps> = ({ onNotify }) => {
  const [status, setStatus] = useState<RemoteRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [runningTestApk, setRunningTestApk] = useState(false);
  const [testApkReport, setTestApkReport] = useState<TestApkAcceptanceReport | null>(null);
  const [runningE2EVerify, setRunningE2EVerify] = useState(false);
  const [e2eReport, setE2eReport] = useState<AndroidEndToEndVerificationReport | null>(null);
  const [runningQuickInstall, setRunningQuickInstall] = useState(false);
  const [quickInstallReport, setQuickInstallReport] = useState<QuickInstallReport | null>(null);
  const [quickInstallApkPath, setQuickInstallApkPath] = useState('./TestAPK.apk');
  const [packages, setPackages] = useState<string[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'connection' | 'display' | 'acceptance' | 'packages' | 'logs'>('connection');

  // Form Config
  const [mode, setMode] = useState<'REST_TLS' | 'ADB_TCP' | 'COMPANION'>('REST_TLS');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8555);
  const [token, setToken] = useState('');
  const [adbTarget, setAdbTarget] = useState('localhost:5555');
  const [tlsEnabled, setTlsEnabled] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Display Stream State
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/android/remote/status');
      if (res.ok) {
        const data: RemoteRuntimeStatus = await res.json();
        setStatus(data);
        if (data.mode && data.mode !== 'NONE') {
          setMode(data.mode);
        }
      }
    } catch (e: any) {
      console.warn('Failed to fetch remote status:', e.message);
    }
  }, []);

  const fetchPackages = useCallback(async () => {
    setLoadingPackages(true);
    try {
      const res = await fetch('/api/android/remote/packages');
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
      }
    } catch {
      setPackages([]);
    } finally {
      setLoadingPackages(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/android/remote/logs?lines=60');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (activeTab === 'packages' && status?.connected) {
      fetchPackages();
    }
    if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab, status?.connected, fetchPackages, fetchLogs]);

  // Connect Action
  const handleConnect = async () => {
    setLoading(true);
    setActionMessage(null);
    try {
      const payload: Partial<RemoteRuntimeConfig> = {
        mode,
        host,
        port: Number(port),
        token: token.trim() || undefined,
        tlsEnabled,
        adbTarget: mode === 'ADB_TCP' ? adbTarget : undefined
      };
      const res = await fetch('/api/android/remote/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setActionMessage(data.message);
      if (data.success) {
        onNotify?.('Android Runtime Connected', data.message, 'android');
      } else {
        onNotify?.('Android Connection Error', data.message, 'android');
      }
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`Connection attempt failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Test Connection Action
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setActionMessage(null);
    try {
      const payload: Partial<RemoteRuntimeConfig> = {
        mode,
        host,
        port: Number(port),
        token: token.trim() || undefined,
        tlsEnabled,
        adbTarget: mode === 'ADB_TCP' ? adbTarget : undefined
      };
      const res = await fetch('/api/android/remote/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setActionMessage(`Test Result: ${data.message}`);
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`Test failed: ${err.message}`);
    } finally {
      setTestingConnection(false);
    }
  };

  // Disconnect Action
  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/android/remote/disconnect', { method: 'POST' });
      const data = await res.json();
      setActionMessage(data.message);
      onNotify?.('Android Runtime Disconnected', data.message, 'android');
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`Disconnect error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Run TestAPK Acceptance Test
  const handleRunTestApk = async () => {
    setRunningTestApk(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/android/remote/test-apk-acceptance', { method: 'POST' });
      const data: TestApkAcceptanceReport = await res.json();
      setTestApkReport(data);
      setActionMessage(`Acceptance Test Finished: ${data.verdict} — ${data.reason}`);
      onNotify?.(`TestAPK Acceptance: ${data.verdict}`, data.reason, 'android');
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`Acceptance test failed: ${err.message}`);
    } finally {
      setRunningTestApk(false);
    }
  };

  // Run Full End-to-End Verification (`android verify --full`)
  const handleRunE2EVerify = async () => {
    setRunningE2EVerify(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/android/verify-e2e', { method: 'POST' });
      const data: AndroidEndToEndVerificationReport = await res.json();
      setE2eReport(data);
      setActionMessage(`E2E Verification: ${data.overallStatus} (${data.firstBlockerCode}) — ${data.rootCause}`);
      onNotify?.(`android verify --full: ${data.overallStatus}`, data.rootCause, 'android');
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`E2E verification failed: ${err.message}`);
    } finally {
      setRunningE2EVerify(false);
    }
  };

  // Run Quick Install (`android quick-install <apk>`)
  const handleRunQuickInstall = async () => {
    setRunningQuickInstall(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/android/quick-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apkPath: quickInstallApkPath })
      });
      const data: QuickInstallReport = await res.json();
      setQuickInstallReport(data);
      setActionMessage(`Quick-Install: ${data.result} (${data.blockerCode}) — ${data.rootCause || 'Completed'}`);
      onNotify?.(`Quick-Install: ${data.result}`, data.rootCause || 'Installation pipeline finished', 'android');
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`Quick-Install failed: ${err.message}`);
    } finally {
      setRunningQuickInstall(false);
    }
  };

  // Package Actions
  const handleLaunchApp = async (pkg: string) => {
    try {
      const res = await fetch('/api/android/remote/packages/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg })
      });
      const data = await res.json();
      setActionMessage(data.message);
      if (data.success) {
        setActiveTab('display');
      }
    } catch (e: any) {
      setActionMessage(`Launch error: ${e.message}`);
    }
  };

  const handleStopApp = async (pkg: string) => {
    try {
      const res = await fetch('/api/android/remote/packages/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg })
      });
      const data = await res.json();
      setActionMessage(data.message);
    } catch (e: any) {
      setActionMessage(`Stop error: ${e.message}`);
    }
  };

  // Display Stream Frame Polling
  useEffect(() => {
    if (activeTab === 'display' && status?.connected) {
      setStreamActive(true);
      const pollFrame = async () => {
        try {
          const res = await fetch(`/api/android/remote/stream/frame?t=${Date.now()}`);
          if (res.status === 200) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setFrameUrl(url);
          }
        } catch {}
      };

      pollFrame();
      pollTimerRef.current = setInterval(pollFrame, 500);
    } else {
      setStreamActive(false);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeTab, status?.connected]);

  // Input Forwarding
  const handleCanvasClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!status?.connected) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const scaleX = 360 / rect.width;
    const scaleY = 640 / rect.height;

    const x = Math.round(clickX * scaleX);
    const y = Math.round(clickY * scaleY);

    try {
      await fetch('/api/android/remote/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'tap', x, y })
      });
    } catch {}
  };

  const handleNavKey = async (type: 'back' | 'home') => {
    try {
      await fetch('/api/android/remote/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
    } catch {}
  };

  const getStateBadge = (stateVal?: string) => {
    switch (stateVal) {
      case 'ANDROID_READY':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ANDROID_READY</span>;
      case 'CONNECTED':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">CONNECTED</span>;
      case 'CONNECTING':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse">CONNECTING</span>;
      case 'DEGRADED':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">DEGRADED</span>;
      case 'LOCAL_UNSUPPORTED':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">LOCAL_UNSUPPORTED</span>;
      case 'FAILED':
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">FAILED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-white/10 text-white/60 border border-white/15">REMOTE_DISCONNECTED</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181818] text-white font-sans select-none overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#202020] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#E95420]/20 text-[#E95420] flex items-center justify-center font-bold">
            <Smartphone size={18} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              Arclight Android Runtime Bridge
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-white/70 font-mono">v2.0</span>
            </h1>
            <p className="text-[11px] text-white/50">
              Real Android Execution via Remote Adapter & Scoped TLS Bridge
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStateBadge(status?.state)}
          <button
            onClick={fetchStatus}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
            title="Refresh Status"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 bg-[#252525] border-b border-white/5 text-xs font-semibold text-white/70 shrink-0">
        <button
          onClick={() => setActiveTab('connection')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'connection' ? 'bg-[#E95420] text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <Wifi size={13} />
          <span>Runtime Connection</span>
        </button>
        <button
          onClick={() => setActiveTab('acceptance')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'acceptance' ? 'bg-[#E95420] text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <ShieldCheck size={13} />
          <span>TestAPK Acceptance</span>
        </button>
        <button
          onClick={() => setActiveTab('display')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'display' ? 'bg-[#E95420] text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <Smartphone size={13} />
          <span>Remote Display Stream</span>
        </button>
        <button
          onClick={() => setActiveTab('packages')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'packages' ? 'bg-[#E95420] text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <Layers size={13} />
          <span>Installed Packages</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'logs' ? 'bg-[#E95420] text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <Terminal size={13} />
          <span>Runtime Logs</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Action message banner */}
        {actionMessage && (
          <div className="p-3 bg-black/40 border border-[#E95420]/30 rounded-xl text-xs font-mono text-white/90 flex items-center justify-between gap-2">
            <span>{actionMessage}</span>
            <button onClick={() => setActionMessage(null)} className="text-white/40 hover:text-white text-xs">✕</button>
          </div>
        )}

        {/* Tab 1: Connection Screen */}
        {activeTab === 'connection' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* Local Host Capability Disclosure Banner */}
            <div className="p-4 rounded-xl bg-amber-950/25 border border-amber-500/25 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-amber-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  Local Host Environment Analysis
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300">
                  {status?.localSupport?.isGvisor ? 'GVISOR_CONTAINER' : 'LINUX_HOST'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-mono text-[11px] text-white/70">
                <div className="p-2 bg-black/30 rounded border border-white/5 flex justify-between">
                  <span>Kernel</span>
                  <span className="text-white font-bold">{status?.localSupport?.kernel || '4.19.0-gvisor'}</span>
                </div>
                <div className="p-2 bg-black/30 rounded border border-white/5 flex justify-between">
                  <span>/dev/binder</span>
                  <span className={status?.localSupport?.hasBinder ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {status?.localSupport?.hasBinder ? 'AVAILABLE' : 'MISSING'}
                  </span>
                </div>
                <div className="p-2 bg-black/30 rounded border border-white/5 flex justify-between">
                  <span>/dev/kvm</span>
                  <span className={status?.localSupport?.hasKvm ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {status?.localSupport?.hasKvm ? 'AVAILABLE' : 'MISSING'}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                {status?.localSupport?.reason || 'Local host kernel lacks binder_linux and KVM virtualization. Automatic local Waydroid loops are permanently avoided.'}
              </p>
            </div>

            {/* Target Remote Runtime Setup Card */}
            <div className="p-4 rounded-xl bg-[#202020] border border-white/10 space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white/60 flex items-center gap-2">
                <Sliders size={13} />
                Configure External Android Runtime
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-white/60 mb-1 font-mono text-[11px]">Bridge Protocol</label>
                  <select
                    value={mode}
                    onChange={(e: any) => setMode(e.target.value)}
                    className="w-full bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg p-2 text-white text-xs font-mono"
                  >
                    <option value="REST_TLS">REST over HTTPS / TLS (Scoped Auth Token)</option>
                    <option value="ADB_TCP">ADB over Network (adb connect host:port)</option>
                    <option value="COMPANION">Local Companion Simulator Bridge</option>
                  </select>
                </div>

                {mode !== 'ADB_TCP' ? (
                  <div>
                    <label className="block text-white/60 mb-1 font-mono text-[11px]">Host / IP Address</label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="192.168.1.100 or android.external-host.com"
                      className="w-full bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg p-2 text-white text-xs font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-white/60 mb-1 font-mono text-[11px]">ADB Target (host:port)</label>
                    <input
                      type="text"
                      value={adbTarget}
                      onChange={(e) => setAdbTarget(e.target.value)}
                      placeholder="192.168.1.100:5555"
                      className="w-full bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg p-2 text-white text-xs font-mono"
                    />
                  </div>
                )}

                {mode !== 'ADB_TCP' && (
                  <div>
                    <label className="block text-white/60 mb-1 font-mono text-[11px]">Port</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      placeholder="8555"
                      className="w-full bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg p-2 text-white text-xs font-mono"
                    />
                  </div>
                )}

                {mode !== 'ADB_TCP' && (
                  <div>
                    <label className="block text-white/60 mb-1 font-mono text-[11px]">Bearer Auth Token (Optional)</label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Bearer secret key"
                      className="w-full bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg p-2 text-white text-xs font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="px-4 py-2 bg-[#E95420] hover:bg-[#E95420]/80 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {loading ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />}
                  <span>Connect Runtime</span>
                </button>

                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {testingConnection ? <RefreshCw size={13} className="animate-spin" /> : <Activity size={13} />}
                  <span>Test Connection</span>
                </button>

                {status?.connected && (
                  <button
                    onClick={handleDisconnect}
                    disabled={loading}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <WifiOff size={13} />
                    <span>Disconnect</span>
                  </button>
                )}
              </div>
            </div>

            {/* Real Probed Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
              <div className="p-3 bg-[#202020] border border-white/10 rounded-xl space-y-1">
                <span className="text-white/50 text-[10px] uppercase">Android Version</span>
                <div className="font-bold text-sm text-white">
                  {status?.androidVersion ? `Android ${status.androidVersion}` : 'UNREACHABLE'}
                </div>
              </div>

              <div className="p-3 bg-[#202020] border border-white/10 rounded-xl space-y-1">
                <span className="text-white/50 text-[10px] uppercase">Host Architecture</span>
                <div className="font-bold text-sm text-white">
                  {status?.architecture || 'N/A'}
                </div>
              </div>

              <div className="p-3 bg-[#202020] border border-white/10 rounded-xl space-y-1">
                <span className="text-white/50 text-[10px] uppercase">Package Manager</span>
                <div className={`font-bold text-sm ${status?.packageManagerReady ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {status?.packageManagerReady ? 'ONLINE' : 'UNREACHABLE'}
                </div>
              </div>

              <div className="p-3 bg-[#202020] border border-white/10 rounded-xl space-y-1">
                <span className="text-white/50 text-[10px] uppercase">Last Error</span>
                <div className="font-bold text-xs truncate text-red-400" title={status?.lastError || 'None'}>
                  {status?.lastError || 'None'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: TestAPK Acceptance & E2E Verification */}
        {activeTab === 'acceptance' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* Quick Install Card (ARCLIGHT SPEEDMAX 02) */}
            <div className="p-4 rounded-xl bg-[#202020] border border-white/10 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Download size={15} className="text-[#E95420]" />
                    <span>Quick Install (`android quick-install &lt;apk&gt;`)</span>
                  </h2>
                  <p className="text-[11px] text-white/50">
                    Fastest practical path: Target probe &rarr; PM Install &rarr; Independent Query &rarr; Launch &rarr; Display Check. Stops at first blocker without fake success.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={quickInstallApkPath}
                    onChange={(e) => setQuickInstallApkPath(e.target.value)}
                    placeholder="./TestAPK.apk"
                    className="bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg px-2.5 py-1.5 text-white text-xs font-mono w-48"
                  />
                  <button
                    onClick={handleRunQuickInstall}
                    disabled={runningQuickInstall || !quickInstallApkPath.trim()}
                    className="px-4 py-2 bg-[#E95420] hover:bg-[#E95420]/80 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {runningQuickInstall ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                    <span>{runningQuickInstall ? 'Quick-Installing...' : 'Quick Install'}</span>
                  </button>
                </div>
              </div>

              {quickInstallReport && (
                <div className="space-y-3 pt-2 font-mono text-xs">
                  <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                    quickInstallReport.result === 'PASS'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : quickInstallReport.result === 'BLOCKED'
                      ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                      : 'bg-red-950/30 border-red-500/30 text-red-300'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold">RESULT: {quickInstallReport.result} (Blocker: {quickInstallReport.blockerCode})</span>
                      <span className="text-[10px] text-white/50">Exit Code {quickInstallReport.exitCode} · {quickInstallReport.timestamp}</span>
                    </div>
                    {quickInstallReport.targetInfo && (
                      <div className="text-[11px] text-white/80">
                        Target: {quickInstallReport.targetInfo.targetId} ({quickInstallReport.targetInfo.mode}) · Android {quickInstallReport.targetInfo.androidVersion || 'N/A'} · ABI {quickInstallReport.targetInfo.architecture || 'N/A'}
                      </div>
                    )}
                    {quickInstallReport.packageInfo && (
                      <div className="text-[11px] text-white/80">
                        Package: {quickInstallReport.packageInfo.packageName} v{quickInstallReport.packageInfo.versionName} · Activity: {quickInstallReport.packageInfo.launchableActivity || 'Default'}
                      </div>
                    )}
                    {quickInstallReport.rootCause && (
                      <div className="text-[11px] text-white/70">Root Cause: {quickInstallReport.rootCause}</div>
                    )}
                    {quickInstallReport.recoveryAction && (
                      <div className="text-[11px] text-amber-200/90 pt-1 border-t border-white/10 whitespace-pre-wrap">
                        Recovery Action:
                        {'\n'}{quickInstallReport.recoveryAction}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(quickInstallReport.stages).map(([stageName, detail]: [string, QuickInstallStageDetail]) => (
                      <div key={stageName} className="p-2.5 bg-black/40 border border-white/10 rounded-lg flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-[11px] truncate">
                            {stageName}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            detail.status === 'PASS'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : detail.status === 'BLOCKED' || detail.status === 'UNKNOWN'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {detail.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/60 break-words">{detail.evidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Full End-to-End Verification Card (ARCLIGHT FIX 09) */}
            <div className="p-4 rounded-xl bg-[#202020] border border-white/10 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck size={15} className="text-[#E95420]" />
                    <span>End-to-End Verification (`android verify --full`)</span>
                  </h2>
                  <p className="text-[11px] text-white/50">
                    Executes independent checks across Host, Connection, Installation, and Launch stages with strict PASS / FAIL / BLOCKED / UNSUPPORTED states.
                  </p>
                </div>
                <button
                  onClick={handleRunE2EVerify}
                  disabled={runningE2EVerify}
                  className="px-4 py-2 bg-[#E95420] hover:bg-[#E95420]/80 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {runningE2EVerify ? <RefreshCw size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  <span>{runningE2EVerify ? 'Running android verify --full...' : 'Run android verify --full'}</span>
                </button>
              </div>

              {e2eReport && (
                <div className="space-y-3 pt-2 font-mono text-xs">
                  <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                    e2eReport.overallStatus === 'PASS'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : e2eReport.overallStatus === 'BLOCKED'
                      ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                      : 'bg-red-950/30 border-red-500/30 text-red-300'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold">OVERALL STATUS: {e2eReport.overallStatus} (Blocker: {e2eReport.firstBlockerCode})</span>
                      <span className="text-[10px] text-white/50">Exit Code {e2eReport.exitCode} · {e2eReport.timestamp}</span>
                    </div>
                    <div className="text-[11px] text-white/80">
                      First Failing Stage: <span className="font-bold">{e2eReport.firstFailingStage || 'NONE'}</span>
                    </div>
                    <div className="text-[11px] text-white/70">Root Cause: {e2eReport.rootCause}</div>
                    {e2eReport.remainingExternalRequirement && (
                      <div className="text-[11px] text-amber-200/90 pt-1 border-t border-white/10">
                        External Requirement: {e2eReport.remainingExternalRequirement}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[
                      ...Object.values(e2eReport.hostChecks),
                      ...Object.values(e2eReport.connectionChecks),
                      ...Object.values(e2eReport.installationChecks),
                      ...Object.values(e2eReport.launchChecks)
                    ].map((chk: VerificationStageCheck) => (
                      <div key={chk.id} className="p-2.5 bg-black/40 border border-white/10 rounded-lg flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-[11px] truncate" title={chk.name}>
                            [{chk.category}] {chk.name}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            chk.status === 'PASS'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : chk.status === 'BLOCKED' || chk.status === 'UNSUPPORTED'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {chk.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/60 break-words">{chk.evidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-[#202020] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">Canonical TestAPK.apk Acceptance Test</h2>
                  <p className="text-[11px] text-white/50">
                    Runs the 7-stage cryptographic transfer, installation, and Activity launch verification.
                  </p>
                </div>
                <button
                  onClick={handleRunTestApk}
                  disabled={runningTestApk}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {runningTestApk ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>{runningTestApk ? 'Verifying 7 Stages...' : 'Run TestAPK Acceptance'}</span>
                </button>
              </div>

              {testApkReport && (
                <div className="space-y-3 pt-2">
                  <div className={`p-3 rounded-lg border flex items-center justify-between font-mono text-xs ${
                    testApkReport.verdict === 'PASS'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : testApkReport.verdict === 'UNSUPPORTED'
                      ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                      : 'bg-red-950/30 border-red-500/30 text-red-300'
                  }`}>
                    <div>
                      <span className="font-bold">VERDICT: {testApkReport.verdict}</span>
                      <p className="text-[11px] text-white/70">{testApkReport.reason}</p>
                    </div>
                    <span className="text-[10px] text-white/50">{testApkReport.timestamp}</span>
                  </div>

                  <div className="space-y-2">
                    {testApkReport.steps.map((st) => (
                      <div
                        key={st.step}
                        className="p-3 bg-black/40 border border-white/5 rounded-lg flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>Step {st.step}: {st.name}</span>
                            <span className="text-[10px] text-white/40 font-mono">({st.durationMs}ms)</span>
                          </div>
                          <div className="text-[11px] text-white/60 font-mono">{st.details}</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          st.status === 'PASS'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : st.status === 'UNSUPPORTED'
                            ? 'bg-amber-500/20 text-amber-400 border border-emerald-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {st.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Display Stream */}
        {activeTab === 'display' && (
          <div className="flex flex-col items-center justify-center space-y-3 h-full">
            <div className="relative border-4 border-black/80 rounded-2xl overflow-hidden shadow-2xl bg-black w-[360px] h-[640px] flex flex-col justify-between">
              {/* Screen Content */}
              <div
                className="w-full h-full relative cursor-crosshair flex items-center justify-center bg-[#111]"
                onClick={handleCanvasClick}
              >
                {frameUrl ? (
                  <img src={frameUrl} alt="Android Surface" className="w-full h-full object-contain" />
                ) : (
                  <div className="text-center p-6 space-y-2 text-white/50">
                    <Smartphone size={40} className="mx-auto text-white/20" />
                    <p className="text-xs">
                      {status?.connected ? 'Awaiting screen frames from remote runtime...' : 'Remote runtime disconnected'}
                    </p>
                  </div>
                )}
              </div>

              {/* Navigation Bar */}
              <div className="h-10 bg-black/90 border-t border-white/10 flex items-center justify-around text-white/70">
                <button onClick={() => handleNavKey('back')} className="p-2 hover:text-white cursor-pointer" title="Back">
                  <CornerDownLeft size={16} />
                </button>
                <button onClick={() => handleNavKey('home')} className="p-2 hover:text-white cursor-pointer" title="Home">
                  <CircleDot size={18} />
                </button>
                <button className="p-2 hover:text-white cursor-pointer" title="Recents">
                  <Square size={15} />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-white/40 font-mono">
              Display stream powered by RemoteAndroidAdapter · Mouse taps forwarded to runtime
            </p>
          </div>
        )}

        {/* Tab 4: Packages */}
        {activeTab === 'packages' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white/60">
                Authoritative Package Registry ({packages.length})
              </h2>
              <button
                onClick={fetchPackages}
                disabled={loadingPackages}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-white flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw size={12} className={loadingPackages ? 'animate-spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {packages.map((pkg) => (
                <div
                  key={pkg}
                  className="p-3 bg-[#202020] border border-white/10 rounded-xl flex items-center justify-between gap-2"
                >
                  <div className="space-y-0.5 min-w-0">
                    <span className="font-mono text-xs text-white truncate block">{pkg}</span>
                    <span className="text-[10px] text-emerald-400 font-bold">VERIFIED_INSTALLED</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleLaunchApp(pkg)}
                      className="p-1.5 rounded hover:bg-white/10 text-emerald-400 cursor-pointer"
                      title="Launch App"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => handleStopApp(pkg)}
                      className="p-1.5 rounded hover:bg-white/10 text-amber-400 cursor-pointer"
                      title="Stop App"
                    >
                      <Square size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 5: Logs */}
        {activeTab === 'logs' && (
          <div className="p-3 bg-black/60 rounded-xl border border-white/10 font-mono text-[11px] h-[500px] overflow-y-auto space-y-1">
            <div className="flex items-center justify-between text-white/40 pb-2 border-b border-white/10">
              <span>Runtime Output Log</span>
              <button onClick={fetchLogs} className="hover:text-white cursor-pointer">Refresh</button>
            </div>
            {logs.map((line, idx) => (
              <div key={idx} className="text-white/80 leading-relaxed">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
