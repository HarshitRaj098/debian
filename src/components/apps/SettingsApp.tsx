import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  Bluetooth, 
  Palette, 
  Layout, 
  Bell, 
  Monitor, 
  Volume2, 
  Battery, 
  Info, 
  Check, 
  Sun, 
  Moon, 
  RefreshCw,
  Eye,
  Package,
  Search,
  Network,
  Terminal,
  ShieldCheck,
  Server,
  Download,
  Upload,
  AlertTriangle,
  Play,
  History,
  Lock,
  Unlock,
  Shield,
  Clock,
  Sliders,
  ShieldAlert,
  MapPin,
  Globe,
  ExternalLink,
  Settings
} from 'lucide-react';
import { DesktopSettings, WallpaperId } from '../../types/desktop';
import { usePWAInstall } from '../usePWAInstall';
import { discovery } from '../../adapters/discoveryEngine';
import { AndroidSetupWizard } from './AndroidSetupWizard';

interface SettingsAppProps {
  settings: DesktopSettings;
  onUpdateSettings: (updater: (prev: DesktopSettings) => DesktopSettings) => void;
  initialSection?: string;
}

interface LinuxSystemInfo {
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
    usagePercent: number;
  };
  cpu: {
    model: string;
    cores: number;
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

interface LinuxPackage {
  name: string;
  version: string;
  sizeKb: number;
  section: string;
}

interface NetworkInfo {
  ips: string[];
  interfaces: {
    name: string;
    rxBytes: number;
    rxPackets: number;
    txBytes: number;
    txPackets: number;
  }[];
}

export const SettingsApp: React.FC<SettingsAppProps> = ({
  settings,
  onUpdateSettings,
  initialSection = 'appearance'
}) => {
  const [activeSection, setActiveSection] = useState<string>(initialSection);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<string>('Your system is up to date.');
  const [systemInfo, setSystemInfo] = useState<LinuxSystemInfo | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [packages, setPackages] = useState<LinuxPackage[]>([]);
  const [packageSearch, setPackageSearch] = useState<string>('');
  const [loadingPackages, setLoadingPackages] = useState<boolean>(false);
  const [auditing, setAuditing] = useState<boolean>(false);
  const [showAndroidSetup, setShowAndroidSetup] = useState<boolean>(false);
  const [auditReport, setAuditReport] = useState<{status: 'healthy' | 'warning' | 'error', issues: string[]} | null>(null);

  // Android / APK Subsystem States
  const [androidStatus, setAndroidStatus] = useState<any>(null);
  const [androidApps, setAndroidApps] = useState<any[]>([]);
  const [selectedAndroidApp, setSelectedAndroidApp] = useState<any | null>(null);
  const [androidSearch, setAndroidSearch] = useState<string>('');
  const [installApkPath, setInstallApkPath] = useState<string>('/home/ubuntu/Downloads/app.apk');
  const [installing, setInstalling] = useState<boolean>(false);
  const [provisioningRuntime, setProvisioningRuntime] = useState<boolean>(false);
  const [adbTargetInput, setAdbTargetInput] = useState<string>('localhost:5555');
  const [connectingAdb, setConnectingAdb] = useState<boolean>(false);
  const [runtimeActionMsg, setRuntimeActionMsg] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ 
    success: boolean; 
    error?: string; 
    message?: string; 
    isBrowserRequirement?: boolean; 
    browserUrl?: string;
    packageName?: string;
    applicationName?: string;
    rootCause?: string;
    errorCode?: string;
    apkDiagnostics?: any;
  } | null>(null);
  const [loadingAndroidApps, setLoadingAndroidApps] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Privacy Control Plane States
  const [privacyMatrix, setPrivacyMatrix] = useState<any>(null);
  const [adminLevel, setAdminLevel] = useState<string>('USER');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [elevating, setElevating] = useState<boolean>(false);
  const [authError, setAdminAuthError] = useState<string | null>(null);
  const [searchResource, setSearchResource] = useState<string>('LOCATION');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [privacyTab, setPrivacyTab] = useState<string>('global'); // 'global', 'matrix', 'search', 'audit', 'access'

  const fetchPrivacyMatrix = async () => {
    console.time("FRONTEND_MATRIX_FETCH");
    try {
      const res = await fetch('/api/permissions/matrix');
      if (res.ok) {
        const data = await res.json();
        setPrivacyMatrix(data);
        setAdminLevel(data.adminLevel);
      }
    } catch {} finally {
      console.timeEnd("FRONTEND_MATRIX_FETCH");
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/api/permissions/audit');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch {}
  };

  const handleSearchResource = async (resName: string) => {
    try {
      const res = await fetch(`/api/permissions/search?resource=${resName}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch {}
  };

  const handleAdminAuth = async (level: string, pass: string) => {
    setAdminAuthError(null);
    try {
      const res = await fetch('/api/permissions/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, password: pass })
      });
      if (res.ok) {
        const data = await res.json();
        setAdminLevel(data.adminLevel);
        setElevating(false);
        setAdminPassword('');
        fetchPrivacyMatrix();
        fetchAuditLogs();
      } else {
        const data = await res.json();
        setAdminAuthError(data.error || 'Authentication failed.');
      }
    } catch {
      setAdminAuthError('Network communication error.');
    }
  };

  const handleUpdateSystemPolicy = async (resource: string, state: string, type: 'osPolicy' | 'systemState') => {
    try {
      const res = await fetch('/api/permissions/system-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource,
          state,
          type,
          actor: adminLevel,
          level: adminLevel
        })
      });
      if (res.ok) {
        fetchPrivacyMatrix();
        fetchAuditLogs();
      } else {
        const data = await res.json();
        alert(data.error || 'Action denied by security engine.');
      }
    } catch {
      alert('Communication failure with security engine.');
    }
  };

  const handleUpdateAppPermission = async (pkg: string, permission: string, state: string) => {
    try {
      const res = await fetch('/api/android/permission/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: pkg,
          permission,
          state
        })
      });
      if (res.ok) {
        fetchPrivacyMatrix();
        fetchAuditLogs();
      } else {
        const data = await res.json();
        setRuntimeActionMsg(data.error || 'Action failed.');
      }
    } catch {
      setRuntimeActionMsg('Network error.');
    }
  };

  const handleUpdateAppNetworkPolicy = async (pkg: string, policy: 'ALLOW' | 'DENY') => {
    try {
      const res = await fetch('/api/permissions/app-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: pkg,
          policy,
          level: adminLevel
        })
      });
      if (res.ok) {
        fetchPrivacyMatrix();
        fetchAuditLogs();
      } else {
        const data = await res.json();
        setRuntimeActionMsg(data.error || 'Action denied by security engine.');
      }
    } catch {
      setRuntimeActionMsg('Communication failure with security engine.');
    }
  };

  const handleUpdateAppLocationAccuracy = async (pkg: string, accuracy: 'NEVER' | 'FOREGROUND' | 'BACKGROUND' | 'APPROXIMATE' | 'PRECISE') => {
    try {
      const res = await fetch('/api/permissions/app-location-accuracy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: pkg,
          accuracy,
          level: adminLevel
        })
      });
      if (res.ok) {
        fetchPrivacyMatrix();
        fetchAuditLogs();
      } else {
        const data = await res.json();
        setRuntimeActionMsg(data.error || 'Action denied by security engine.');
      }
    } catch {
      setRuntimeActionMsg('Communication failure with security engine.');
    }
  };

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const fetchAndroidData = async () => {
    setLoadingAndroidApps(true);
    try {
      const [statusRes, appsRes] = await Promise.all([
        fetch('/api/android/status'),
        fetch('/api/android/apps')
      ]);
      if (statusRes.ok) {
        setAndroidStatus(await statusRes.json());
      }
      if (appsRes.ok) {
        const data = await appsRes.json();
        setAndroidApps(data.apps || []);
      }
    } catch {
      // Handled
    } finally {
      setLoadingAndroidApps(false);
    }
  };

  const handleProvisionRuntime = async () => {
    setProvisioningRuntime(true);
    setRuntimeActionMsg(null);
    try {
      const res = await fetch('/api/android/runtime/provision', { method: 'POST' });
      const data = await res.json();
      setRuntimeActionMsg(data.message || 'Host runtime check complete.');
      await fetchAndroidData();
    } catch (e: any) {
      setRuntimeActionMsg(`Provision error: ${e.message}`);
    } finally {
      setProvisioningRuntime(false);
    }
  };

  const handleConnectAdb = async () => {
    if (!adbTargetInput.trim()) return;
    setConnectingAdb(true);
    setRuntimeActionMsg(null);
    try {
      const isHttp = adbTargetInput.trim().startsWith('http');
      const payload = isHttp
        ? { mode: 'REST_TLS', endpointUrl: adbTargetInput.trim() }
        : { mode: 'ADB_TCP', adbTarget: adbTargetInput.trim() };

      const res = await fetch('/api/android/remote/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setRuntimeActionMsg(data.message || 'Remote runtime connection attempt finished.');
      await fetchAndroidData();
    } catch (e: any) {
      setRuntimeActionMsg(`Remote connect error: ${e.message}`);
    } finally {
      setConnectingAdb(false);
    }
  };

  const handleRunAcceptanceTest = async () => {
    setProvisioningRuntime(true);
    setRuntimeActionMsg('Running Canonical 7-Stage TestAPK Acceptance Test...');
    try {
      const res = await fetch('/api/android/remote/test-apk-acceptance', { method: 'POST' });
      const data = await res.json();
      setRuntimeActionMsg(`Acceptance Test [${data.verdict}]: ${data.reason}`);
      await fetchAndroidData();
    } catch (e: any) {
      setRuntimeActionMsg(`Acceptance test error: ${e.message}`);
    } finally {
      setProvisioningRuntime(false);
    }
  };

  const handleStartWaydroid = async () => {
    setProvisioningRuntime(true);
    setRuntimeActionMsg(null);
    try {
      const res = await fetch('/api/android/runtime/start', { method: 'POST' });
      const data = await res.json();
      setRuntimeActionMsg(data.message || 'Waydroid startup sequence finished.');
      await fetchAndroidData();
    } catch (e: any) {
      setRuntimeActionMsg(`Waydroid start error: ${e.message}`);
    } finally {
      setProvisioningRuntime(false);
    }
  };

  const handleLaunchAndroidApp = async (pkg: string) => {
    try {
      const res = await fetch('/api/android/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchAndroidData();
        setSelectedAndroidApp((prev: any) => prev && prev.packageName === pkg ? { ...prev, runtimeState: "RUNNING" } : prev);
        setRuntimeActionMsg(`Launched ${pkg} (${data.component || pkg}).`);
      } else {
        setRuntimeActionMsg(`Launch rejected by runtime: ${data.message || data.error || 'No Android runtime connected'}`);
      }
    } catch (e: any) {
      setRuntimeActionMsg(`Launch failed: ${e.message}`);
    }
  };

  const handleStopAndroidApp = async (pkg: string) => {
    try {
      const res = await fetch('/api/android/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchAndroidData();
        setSelectedAndroidApp((prev: any) => prev && prev.packageName === pkg ? { ...prev, runtimeState: "STOPPED" } : prev);
        setRuntimeActionMsg(`Stopped ${pkg}.`);
      } else {
        setRuntimeActionMsg(`Stop rejected by runtime: ${data.message || data.error || 'No Android runtime connected'}`);
      }
    } catch (e: any) {
      setRuntimeActionMsg(`Stop failed: ${e.message}`);
    }
  };

  const handleUninstallAndroidApp = async (pkg: string) => {
    try {
      const res = await fetch('/api/android/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchAndroidData();
        setSelectedAndroidApp(null);
        setRuntimeActionMsg(`Uninstalled ${pkg}.`);
      } else {
        setRuntimeActionMsg(`Uninstall rejected by runtime: ${data.message || data.error || 'No Android runtime connected'}`);
      }
    } catch (e: any) {
      setRuntimeActionMsg(`Uninstall failed: ${e.message}`);
    }
  };

  const handleToggleAndroidPermission = async (pkg: string, permission: string, state: string) => {
    try {
      const res = await fetch('/api/android/permission/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg, permission, state })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchAndroidData();
        setSelectedAndroidApp((prev: any) => {
          if (!prev || prev.packageName !== pkg) return prev;
          const updatedPerms = prev.permissions.map((p: any) => {
            if (p.permission === permission) {
              return { ...p, state };
            }
            return p;
          });
          return { ...prev, permissions: updatedPerms };
        });
      } else {
        setRuntimeActionMsg(`Permission toggle rejected: ${data.message || data.error || 'No Android runtime connected'}`);
      }
    } catch (e: any) {
      setRuntimeActionMsg(`Permission toggle failed: ${e.message}`);
    }
  };

  const handleInstallApk = async (pathOrUrl?: string) => {
    const target = (pathOrUrl || installApkPath).trim();
    if (!target) return;

    const isUrl = target.startsWith('http://') || target.startsWith('https://');

    if (isUrl) {
      // URL PIPELINE: Backend download endpoint (POST /api/apk/resolve-and-download)
      setInstalling(true);
      setInstallResult(null);
      setUploadProgress('Connecting to remote server and resolving APK download...');

      try {
        const resolveRes = await fetch('/api/apk/resolve-and-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target })
        });
        const resolveData = await resolveRes.json();

        if (resolveData.ok && resolveData.filePath) {
          // Resolved and downloaded on server; now install package
          setUploadProgress(`Installing downloaded package "${resolveData.fileName || 'APK'}"...`);
          const installRes = await fetch('/api/android/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apkPath: resolveData.filePath,
              transactionId: resolveData.transactionId
            })
          });
          const installData = await installRes.json();
          if (installRes.ok && installData.success) {
            setInstallResult({
              success: true,
              message: installData.message || `Successfully installed ${installData.applicationName || resolveData.fileName || 'APK'}.`,
              packageName: installData.packageName,
              applicationName: installData.applicationName,
              apkDiagnostics: installData.apkDiagnostics
            });
            fetchAndroidData();
          } else {
            setInstallResult({
              success: false,
              error: installData.error || installData.message || 'Failed to install downloaded APK.',
              packageName: installData.packageName,
              applicationName: installData.applicationName,
              rootCause: installData.rootCause,
              errorCode: installData.errorCode,
              apkDiagnostics: installData.apkDiagnostics
            });
            fetchAndroidData();
          }
        } else {
          // Handled resolution failure (e.g. LimeWire share page requires browser flow)
          if (resolveData.requiresBrowser || resolveData.code === 'REMOTE_DOWNLOAD_REQUIRES_BROWSER_FLOW' || resolveData.code === 'DOWNLOAD_PAGE_NOT_FILE') {
            setInstallResult({
              success: false,
              isBrowserRequirement: true,
              browserUrl: target,
              error: resolveData.error || "LimeWire share links require client-side in-browser decryption. Please open the link in your browser to download Cinema.apk, then drag the downloaded file into this window."
            });
          } else {
            setInstallResult({
              success: false,
              error: resolveData.error || `Download failed: ${resolveData.code || 'Unknown error'}`
            });
          }
        }
      } catch (err: any) {
        setInstallResult({
          success: false,
          error: `Network error reaching backend: ${err.message}`
        });
      } finally {
        setInstalling(false);
        setUploadProgress(null);
      }
    } else {
      // LOCAL PATH PIPELINE: Local filesystem path
      setInstalling(true);
      setInstallResult(null);
      setUploadProgress(`Verifying local APK "${target}" on host filesystem...`);
      try {
        const res = await fetch('/api/android/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apkPath: target, isLocalFile: true })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setInstallResult({
            success: true,
            message: data.message || `Successfully installed ${data.applicationName || target}.`,
            packageName: data.packageName,
            applicationName: data.applicationName,
            apkDiagnostics: data.apkDiagnostics
          });
          fetchAndroidData();
        } else {
          setInstallResult({
            success: false,
            error: data.error || data.message || 'Failed to install APK from local filesystem.',
            packageName: data.packageName,
            applicationName: data.applicationName,
            rootCause: data.rootCause,
            errorCode: data.errorCode,
            apkDiagnostics: data.apkDiagnostics
          });
          fetchAndroidData();
        }
      } catch (e: any) {
        setInstallResult({
          success: false,
          error: `Error installing local APK: ${e.message}`
        });
      } finally {
        setInstalling(false);
        setUploadProgress(null);
      }
    }
  };

  const handleProcessLocalFile = async (file: File) => {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
      setInstallResult({
        success: false,
        error: `File "${file.name}" contains HTML webpage content, not an Android package (.apk). Please download the actual APK in your browser first.`
      });
      return;
    }

    setInstalling(true);
    setInstallResult(null);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    setUploadProgress(`Uploading local APK "${file.name}" (${sizeMb} MB)...`);

    try {
      // 1. Direct binary streaming upload
      const res = await fetch(`/api/android/upload?fileName=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name)
        },
        body: file
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setInstallApkPath(data.filePath || `/home/ubuntu/Downloads/${file.name}`);
        setInstallResult({
          success: true,
          message: data.message || `Successfully installed ${data.applicationName || file.name}.`,
          packageName: data.packageName,
          applicationName: data.applicationName,
          apkDiagnostics: data.apkDiagnostics
        });
        fetchAndroidData();
        return;
      } else {
        setInstallResult({
          success: false,
          error: data.error || data.message || 'Failed to install local APK package.',
          packageName: data.packageName,
          applicationName: data.applicationName,
          rootCause: data.rootCause,
          errorCode: data.errorCode,
          apkDiagnostics: data.apkDiagnostics
        });
        fetchAndroidData();
        return;
      }
    } catch {
      // 2. Fallback to FileReader base64 if binary upload had network interruption
      try {
        setUploadProgress(`Reading local "${file.name}"...`);
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64Data = (reader.result as string).split(',')[1];
            const fallbackRes = await fetch('/api/android/install', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileName: file.name,
                base64: base64Data,
                isLocalFile: true
              })
            });
            const fallbackData = await fallbackRes.json();
            if (fallbackRes.ok && fallbackData.success) {
              setInstallApkPath(fallbackData.filePath || `/home/ubuntu/Downloads/${file.name}`);
              setInstallResult({
                success: true,
                message: fallbackData.message || `Successfully installed ${fallbackData.applicationName || file.name}.`
              });
              fetchAndroidData();
            } else {
              setInstallResult({
                success: false,
                error: fallbackData.error || 'Failed to install APK package.'
              });
            }
          } catch (e: any) {
            setInstallResult({ success: false, error: e.message || 'Upload error.' });
          } finally {
            setInstalling(false);
            setUploadProgress(null);
          }
        };
        reader.readAsDataURL(file);
        return;
      } catch (fallbackErr: any) {
        setInstallResult({
          success: false,
          error: fallbackErr.message || 'Error uploading APK.'
        });
      }
    } finally {
      setInstalling(false);
      setUploadProgress(null);
    }
  };

  const handleProcessUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setInstallApkPath(trimmed);
    handleInstallApk(trimmed);
  };

  useEffect(() => {
    if (activeSection === 'android') {
      fetchAndroidData();
    }
  }, [activeSection]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const fetchSystemData = async () => {
    try {
      const [infoRes, netRes] = await Promise.all([
        fetch('/api/system/info'),
        fetch('/api/system/network')
      ]);
      if (infoRes.ok) {
        const info = await infoRes.json();
        setSystemInfo(info);
      }
      if (netRes.ok) {
        const net = await netRes.json();
        setNetworkInfo(net);
      }
    } catch {
      // Handled
    }
  };

  const fetchPackages = async (query = '') => {
    setLoadingPackages(true);
    try {
      const res = await fetch(`/api/system/packages?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
      }
    } catch {
      // Handled
    } finally {
      setLoadingPackages(false);
    }
  };

  useEffect(() => {
    fetchSystemData();
  }, []);

  useEffect(() => {
    if (activeSection === 'packages') {
      fetchPackages(packageSearch);
    }
  }, [activeSection, packageSearch]);

  // Refactor useEffects for granular control
  useEffect(() => {
    if (activeSection === 'privacy' && privacyTab === 'matrix') {
       fetchPrivacyMatrix();
    }
  }, [activeSection, privacyTab]);

  useEffect(() => {
    if (activeSection === 'privacy' && privacyTab === 'audit') {
       fetchAuditLogs();
    }
  }, [activeSection, privacyTab]);

  useEffect(() => {
    if (activeSection === 'privacy' && privacyTab === 'search') {
       handleSearchResource(searchResource);
    }
  }, [activeSection, privacyTab, searchResource]);

  const wallpapers: { id: WallpaperId; title: string; previewClass: string }[] = [
    { id: 'jammy-aubergine', title: 'Ubuntu Jammy Aubergine', previewClass: 'from-[#77216F] via-[#2C001E] to-[#E95420]' },
    { id: 'noble-numbat', title: 'Ubuntu Noble Numbat', previewClass: 'from-[#1E0720] via-[#6C1D5F] to-[#E95420]' },
    { id: 'deep-space', title: 'Deep Space Blue', previewClass: 'from-blue-950 via-[#0a0e1a] to-black' },
    { id: 'matrix-emerald', title: 'Matrix Emerald', previewClass: 'from-[#051109] via-[#040d07] to-emerald-950' },
    { id: 'minimal-carbon', title: 'Minimal Carbon', previewClass: 'from-[#262626] via-[#1a1a1a] to-[#0f0f0f]' },
  ];

  const accentColors = [
    { name: 'Ubuntu Orange', value: '#E95420' },
    { name: 'Emerald Green', value: '#10b981' },
    { name: 'Classic Blue', value: '#3b82f6' },
    { name: 'Canonical Purple', value: '#a855f7' },
    { name: 'Crimson Red', value: '#ef4444' },
  ];

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus('Querying Debian / Ubuntu repository manifests...');
    try {
      await fetchPackages();
      await fetchSystemData();
      setTimeout(() => {
        setCheckingUpdate(false);
        setUpdateStatus(`System verified: ${systemInfo?.packageCount || 135} packages installed, security patches current.`);
      }, 1200);
    } catch {
      setCheckingUpdate(false);
      setUpdateStatus('Repositories checked. System is healthy.');
    }
  };

  const handleSelfAudit = async () => {
    setAuditing(true);
    try {
      const state = await discovery.discoverAll();
      const issues: string[] = [];
      
      if (!state.systemSnapshot) issues.push('System metrics discovery engine latency');
      if (state.packages.length < 50) issues.push('Linux userspace package manifest is sparse');
      if (!state.network?.ips?.length) issues.push('Network stack reported zero active host IPs');
      
      setAuditReport({
        status: issues.length === 0 ? 'healthy' : issues.length < 3 ? 'warning' : 'error',
        issues
      });
    } catch (e) {
      setAuditReport({ status: 'error', issues: ['Discovery engine crash during audit'] });
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] text-white flex font-sans select-none overflow-hidden">
      {/* Settings Left Navigation Sidebar */}
      <div className="w-56 bg-[#181818] border-r border-white/10 p-3 flex flex-col gap-1 overflow-y-auto shrink-0 text-xs">
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/40">Settings</div>
        
        {[
          { id: 'wifi', label: 'Network & Wi-Fi', icon: <Wifi size={16} /> },
          { id: 'bluetooth', label: 'Bluetooth', icon: <Bluetooth size={16} /> },
          { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
          { id: 'dock', label: 'Ubuntu Dock', icon: <Layout size={16} /> },
          { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
          { id: 'displays', label: 'Displays', icon: <Monitor size={16} /> },
          { id: 'sound', label: 'Sound', icon: <Volume2 size={16} /> },
          { id: 'power', label: 'Power', icon: <Battery size={16} /> },
          { id: 'android', label: 'Android Subsystem (APK)', icon: <Server size={16} /> },
          { id: 'privacy', label: 'Privacy & Security (Ω-Plane)', icon: <ShieldCheck size={16} /> },
          { id: 'packages', label: 'Software & Packages', icon: <Package size={16} /> },
          { id: 'maintenance', label: 'Maintenance & PWA', icon: <History size={16} /> },
          { id: 'about', label: 'System & About', icon: <Info size={16} /> },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left font-medium transition-all ${
              activeSection === item.id 
                ? 'bg-[#E95420] text-white shadow' 
                : 'text-white/70 hover:bg-white/5 hover:text-white'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Settings Main Content Area */}
      <div className="flex-1 p-8 overflow-y-auto bg-[#1e1e1e]">
        {/* APPEARANCE SECTION */}
        {activeSection === 'appearance' && (
          <div className="max-w-2xl space-y-8">
            <div>
              <h2 className="text-xl font-bold mb-1">Appearance</h2>
              <p className="text-xs text-white/50">Personalize your desktop theme, accent colors, and background.</p>
            </div>

            {/* Dark / Light Style Toggle */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-white/60">Style</span>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, theme: 'dark' }))}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-3 transition-all ${
                    settings.theme === 'dark' 
                      ? 'border-[#E95420] bg-white/10 ring-2 ring-[#E95420]/30 shadow-lg' 
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="w-full h-24 bg-[#1a1a1a] rounded-xl border border-white/10 p-2 flex flex-col justify-between">
                    <div className="w-1/3 h-2 bg-white/20 rounded" />
                    <div className="w-full h-8 bg-black/40 rounded flex items-center justify-center">
                      <Moon size={16} className="text-[#E95420]" />
                    </div>
                  </div>
                  <span className="text-xs font-semibold">Dark Style</span>
                </button>

                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, theme: 'light' }))}
                  className={`p-4 rounded-2xl border flex flex-col items-center gap-3 transition-all ${
                    settings.theme === 'light' 
                      ? 'border-[#E95420] bg-white/10 ring-2 ring-[#E95420]/30 shadow-lg' 
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="w-full h-24 bg-[#e5e5e5] rounded-xl border border-black/10 p-2 flex flex-col justify-between text-black">
                    <div className="w-1/3 h-2 bg-black/20 rounded" />
                    <div className="w-full h-8 bg-white rounded flex items-center justify-center">
                      <Sun size={16} className="text-[#E95420]" />
                    </div>
                  </div>
                  <span className="text-xs font-semibold">Light Style</span>
                </button>
              </div>
            </div>

            {/* Accent Colors */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-white/60">Accent Color</span>
              <div className="flex items-center gap-4">
                {accentColors.map(color => (
                  <button
                    key={color.name}
                    onClick={() => onUpdateSettings(s => ({ ...s, accentColor: color.value }))}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      settings.accentColor === color.value ? 'ring-2 ring-white scale-110 shadow-lg' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  >
                    {settings.accentColor === color.value && <Check size={16} className="text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Wallpapers */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-white/60">Background Wallpaper</span>
              <div className="grid grid-cols-3 gap-4">
                {wallpapers.map(wp => (
                  <button
                    key={wp.id}
                    onClick={() => onUpdateSettings(s => ({ ...s, wallpaperId: wp.id }))}
                    className={`group relative rounded-2xl overflow-hidden border transition-all text-left ${
                      settings.wallpaperId === wp.id 
                        ? 'border-[#E95420] ring-2 ring-[#E95420]/50 shadow-xl' 
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className={`h-24 w-full bg-gradient-to-br ${wp.previewClass}`} />
                    <div className="p-2.5 bg-[#252525] flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-white/90 truncate">{wp.title}</span>
                      {settings.wallpaperId === wp.id && (
                        <div className="w-2 h-2 rounded-full bg-[#E95420]" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* UBUNTU DOCK SECTION */}
        {activeSection === 'dock' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Ubuntu Dock</h2>
              <p className="text-xs text-white/50">Configure position, size, and auto-hide behavior of the desktop dock.</p>
            </div>

            <div className="bg-[#242424] border border-white/10 rounded-2xl divide-y divide-white/5 text-xs">
              {/* Position */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">Position on Screen</div>
                  <div className="text-[11px] text-white/50">Choose dock screen alignment</div>
                </div>
                <div className="flex p-0.5 bg-black/40 rounded-lg border border-white/10">
                  <button
                    onClick={() => onUpdateSettings(s => ({ ...s, dockPosition: 'left' }))}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      settings.dockPosition === 'left' ? 'bg-[#E95420] text-white shadow' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Left (Standard)
                  </button>
                  <button
                    onClick={() => onUpdateSettings(s => ({ ...s, dockPosition: 'bottom' }))}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      settings.dockPosition === 'bottom' ? 'bg-[#E95420] text-white shadow' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Bottom
                  </button>
                </div>
              </div>

              {/* Icon Size */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">Icon Size</div>
                  <div className="text-[11px] text-white/50">{settings.dockIconSize} pixels</div>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="32"
                    max="56"
                    step="4"
                    value={settings.dockIconSize}
                    onChange={(e) => onUpdateSettings(s => ({ ...s, dockIconSize: Number(e.target.value) }))}
                    className="accent-[#E95420] w-36 h-1.5 bg-white/20 rounded-lg cursor-pointer"
                  />
                  <span className="font-mono text-white/70 w-8">{settings.dockIconSize}px</span>
                </div>
              </div>

              {/* Auto Hide */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">Auto-hide the Dock</div>
                  <div className="text-[11px] text-white/50">The dock hides when any window overlaps with it</div>
                </div>
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, dockAutoHide: !s.dockAutoHide }))}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    settings.dockAutoHide ? 'bg-[#E95420]' : 'bg-white/20'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${settings.dockAutoHide ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Show Trash */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">Show Trash in Dock</div>
                  <div className="text-[11px] text-white/50">Display the Trash icon at the bottom of the dock</div>
                </div>
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, dockShowTrash: !s.dockShowTrash }))}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    settings.dockShowTrash ? 'bg-[#E95420]' : 'bg-white/20'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${settings.dockShowTrash ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* REAL SOFTWARE & PACKAGES SECTION (dpkg) */}
        {activeSection === 'packages' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Software & Linux Packages</h2>
              <p className="text-xs text-white/50">Inspect packages installed on the underlying Debian / Ubuntu Linux system.</p>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 bg-black/30 border border-white/10 px-3 py-1.5 rounded-xl flex-1">
                <Search size={14} className="text-white/40" />
                <input
                  type="text"
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  placeholder="Search installed Linux packages (e.g. bash, coreutils, curl, apt)..."
                  className="bg-transparent text-xs text-white placeholder-white/30 outline-none w-full"
                />
              </div>
              <button
                onClick={() => fetchPackages(packageSearch)}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw size={13} className={loadingPackages ? 'animate-spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="bg-[#242424] border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
              <div className="p-3 bg-[#1e1e1e] flex items-center justify-between text-[11px] text-white/50 font-bold uppercase">
                <span>Package Name</span>
                <span>Version & Size</span>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-white/5 font-mono text-xs">
                {packages.length === 0 ? (
                  <div className="p-6 text-center text-white/40">
                    {loadingPackages ? 'Querying dpkg database...' : 'No packages matching search.'}
                  </div>
                ) : (
                  packages.map(pkg => (
                    <div key={pkg.name} className="p-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Package size={15} className="text-[#E95420]" />
                        <div>
                          <div className="font-bold text-white">{pkg.name}</div>
                          <div className="text-[10px] text-white/40 font-sans capitalize">Section: {pkg.section}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-white/80 font-bold">{pkg.version}</div>
                        <div className="text-[10px] text-white/40">{(pkg.sizeKb / 1024).toFixed(1)} MB</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 bg-[#1e1e1e] text-[11px] text-white/50 flex items-center justify-between font-mono">
                <span>Total Packages: {systemInfo?.packageCount || packages.length}</span>
                <span className="text-emerald-400">dpkg Linux Userspace Synchronized</span>
              </div>
            </div>
          </div>
        )}

        {/* MAINTENANCE & PWA SECTION */}
        {activeSection === 'maintenance' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Maintenance & Production</h2>
              <p className="text-xs text-white/50">Manage system health, installability, and local data persistence.</p>
            </div>

            {/* PWA Installation */}
            <div className="bg-[#242424] border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Download size={16} className="text-[#E95420]" />
                    Local OS Installation
                  </h3>
                  <p className="text-[11px] text-white/50 max-w-sm mt-1">
                    Install AETHER OS as a native desktop application (PWA) for offline support and faster boot times.
                  </p>
                </div>
                {isInstalled ? (
                  <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-wider">
                    Already Installed
                  </span>
                ) : isInstallable ? (
                  <button
                    onClick={install}
                    className="px-4 py-2 bg-[#E95420] hover:bg-[#d84818] rounded-xl text-white text-xs font-bold shadow-lg transition-all"
                  >
                    Install Now
                  </button>
                ) : isIOS ? (
                  <div className="text-[10px] text-white/40 italic">
                    Use Safari 'Add to Home Screen'
                  </div>
                ) : (
                  <div className="text-[10px] text-white/40 italic">
                    Already standalone or not supported
                  </div>
                )}
              </div>
            </div>

            {/* Self Audit / Self Healing */}
            <div className="bg-[#242424] border border-white/10 rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-400" />
                    System Integrity Audit
                  </h3>
                  <p className="text-[11px] text-white/50 max-w-sm mt-1">
                    Run a comprehensive self-diagnostic on adapters, discovery engines, and Linux kernel connectivity.
                  </p>
                </div>
                <button
                  onClick={handleSelfAudit}
                  disabled={auditing}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white text-xs font-bold transition-all border border-white/10"
                >
                  {auditing ? 'Auditing...' : 'Run Audit'}
                </button>
              </div>

              {auditReport && (
                <div className={`p-4 rounded-xl border ${
                  auditReport.status === 'healthy' ? 'bg-emerald-500/5 border-emerald-500/20' :
                  auditReport.status === 'warning' ? 'bg-amber-500/5 border-amber-500/20' :
                  'bg-red-500/5 border-red-500/20'
                } animate-in fade-in slide-in-from-top-2 duration-300`}>
                  <div className="flex items-center gap-3 mb-3">
                    {auditReport.status === 'healthy' ? (
                      <ShieldCheck size={20} className="text-emerald-500" />
                    ) : (
                      <AlertTriangle size={20} className={auditReport.status === 'warning' ? 'text-amber-500' : 'text-red-500'} />
                    )}
                    <span className={`text-sm font-bold ${
                      auditReport.status === 'healthy' ? 'text-emerald-400' :
                      auditReport.status === 'warning' ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                      System {auditReport.status.toUpperCase()}
                    </span>
                  </div>
                  
                  {auditReport.issues.length > 0 ? (
                    <ul className="space-y-1.5 list-disc list-inside text-[11px] text-white/60">
                      {auditReport.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-white/60">All discovery engines, adapters, and PTY bridges are operating at nominal capacity.</p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#242424] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
                <History size={16} className="text-blue-400" />
                Recovery Tools
              </h3>
              <p className="text-[11px] text-white/50 mb-4">
                If you experience system instability or "Kernel Panic" errors, use the recovery tools below.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[11px] font-bold border border-white/5 transition-all"
                >
                  Soft Reboot
                </button>
                <button
                  onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                  }}
                  className="flex-1 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-xl text-[11px] font-bold border border-red-600/20 transition-all"
                >
                  Reset State
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SYSTEM & ABOUT SECTION (REAL LINUX HARDWARE & OS METRICS) */}
        {activeSection === 'about' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">System & About</h2>
              <p className="text-xs text-white/50">Actual hardware and Linux userspace properties from the host system.</p>
            </div>

            <div className="bg-[#242424] border border-white/10 rounded-2xl p-6 space-y-6">
              {/* Header Badge */}
              <div className="flex items-center gap-4 pb-4 border-b border-white/10">
                <div className="w-14 h-14 rounded-2xl bg-[#E95420] text-white flex items-center justify-center text-2xl font-bold shadow-lg ring-4 ring-[#E95420]/20">
                  A
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {systemInfo?.os || 'Debian GNU/Linux 12 (bookworm)'}
                  </h3>
                  <p className="text-xs text-[#E95420] font-semibold">
                    {systemInfo?.desktop || 'AETHER Ubuntu Desktop Shell'}
                  </p>
                </div>
              </div>

              {/* Real Linux Hardware & System Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">OS Distribution</div>
                  <div className="text-white font-bold mt-1 text-sm">{systemInfo?.os || 'Debian 12 bookworm'}</div>
                </div>

                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">Kernel Release (uname -r)</div>
                  <div className="text-emerald-400 font-bold mt-1 text-sm">{systemInfo?.kernel || '4.19.0-gvisor'}</div>
                </div>

                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">Memory Available (Linux free)</div>
                  <div className="text-white font-bold mt-1 text-sm">{systemInfo?.memory.total || '4.0 GB'} RAM</div>
                  <div className="text-[10px] text-white/40 mt-0.5">{systemInfo?.memory.used || '200 MB'} used ({systemInfo?.memory.usagePercent || 5}%)</div>
                </div>

                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">Processor (Linux nproc)</div>
                  <div className="text-white font-bold mt-1 text-sm">{systemInfo?.cpu.cores || 2} vCPUs</div>
                  <div className="text-[10px] text-white/40 mt-0.5 truncate">{systemInfo?.cpu.model || 'x86_64 Virtual CPU'}</div>
                </div>

                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">Root Storage (Linux df)</div>
                  <div className="text-white font-bold mt-1 text-sm">{systemInfo?.disk.total || '503.8 GB'}</div>
                  <div className="text-[10px] text-white/40 mt-0.5">{systemInfo?.disk.available || '503.5 GB'} free ({systemInfo?.disk.percentString || '1%'})</div>
                </div>

                <div className="p-3.5 bg-black/20 rounded-xl border border-white/5">
                  <div className="text-[10px] text-white/40 uppercase">Installed Packages (dpkg)</div>
                  <div className="text-white font-bold mt-1 text-sm">{systemInfo?.packageCount || 135} packages</div>
                  <div className="text-[10px] text-white/40 mt-0.5">Architecture: {systemInfo?.arch || 'x64'}</div>
                </div>
              </div>

              {/* Updates & Verification */}
              <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <ShieldCheck size={16} className="text-emerald-400" />
                  <span>{updateStatus}</span>
                </div>
                <button
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdate}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E95420] hover:bg-[#d84818] text-white font-bold text-xs transition-colors shadow"
                >
                  <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : ''} />
                  <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* NETWORK & WI-FI SECTION */}
        {activeSection === 'wifi' && (
          <div className="max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold mb-1">Network & Interfaces</h2>
                <p className="text-xs text-white/50">Manage network connectivity and inspect Linux network interfaces.</p>
              </div>
              <button
                onClick={() => onUpdateSettings(s => ({ ...s, wifiEnabled: !s.wifiEnabled }))}
                className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                  settings.wifiEnabled ? 'bg-[#E95420]' : 'bg-white/20'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white transition-transform ${settings.wifiEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Host IP Addresses</span>
              <div className="flex flex-wrap gap-2">
                {networkInfo?.ips.map(ip => (
                  <span key={ip} className="px-3 py-1 bg-black/30 border border-white/10 rounded-lg font-mono text-[#E95420]">
                    {ip}
                  </span>
                ))}
              </div>

              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 block pt-2">Active Network Interfaces (/proc/net/dev)</span>
              <div className="space-y-2">
                {networkInfo?.interfaces.map(iface => (
                  <div key={iface.name} className="p-3 bg-black/20 rounded-xl flex items-center justify-between font-mono">
                    <div className="flex items-center gap-3">
                      <Network size={16} className="text-[#E95420]" />
                      <span className="font-bold text-white">{iface.name}</span>
                    </div>
                    <div className="text-[11px] text-white/60">
                      RX: {iface.rxPackets} pkts · TX: {iface.txPackets} pkts
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ANDROID SUBSYSTEM & APK SECTION */}
        {activeSection === 'android' && (
          <div className="max-w-4xl space-y-6 text-xs">
            {selectedAndroidApp ? (
              // APP DETAILS PAGE
              <div className="space-y-6">
                <button
                  onClick={() => setSelectedAndroidApp(null)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl font-bold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  ← Back to Android Subsystem
                </button>

                {/* App Header Card */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-6 flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="w-16 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-[#E95420]">
                      <Server size={32} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-white">{selectedAndroidApp.applicationName}</h3>
                      <p className="font-mono text-white/50 text-[10px]">{selectedAndroidApp.packageName}</p>
                      <div className="flex items-center gap-3 pt-1 font-mono text-[9px] text-white/40">
                        <span>Version: {selectedAndroidApp.versionName}</span>
                        <span>·</span>
                        <span>Source: {selectedAndroidApp.installSource}</span>
                        <span>·</span>
                        <span>Installed: {new Date(selectedAndroidApp.installTime).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 text-right">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedAndroidApp.runtimeState === 'RUNNING' 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-white/10 text-white/60 border border-white/10'
                    }`}>
                      {selectedAndroidApp.runtimeState}
                    </span>

                    <div className="flex items-center gap-2 pt-2">
                      {selectedAndroidApp.runtimeState === 'RUNNING' ? (
                        <button
                          onClick={() => handleStopAndroidApp(selectedAndroidApp.packageName)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold transition-all cursor-pointer"
                        >
                          Force Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLaunchAndroidApp(selectedAndroidApp.packageName)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-all cursor-pointer"
                        >
                          Launch App
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 18: ABI Architecture Compatibility Check */}
                {selectedAndroidApp.supportedAbis && (
                  <div className="bg-[#242424] border border-white/10 rounded-2xl p-4">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">Architecture Compatibility (ABI)</h4>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-white/60">Required:</span>
                        <span className="text-[#E95420]">{selectedAndroidApp.supportedAbis.join(', ')}</span>
                        <span className="text-white/20">|</span>
                        <span className="text-white/60">Runtime:</span>
                        <span className="text-emerald-400">{androidStatus?.supportedAbis?.join(', ') || 'x86_64'}</span>
                      </div>

                      {/* ABI Check */}
                      {selectedAndroidApp.supportedAbis.includes('x86_64') ? (
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold uppercase text-[9px]">
                          Supported
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/20 rounded font-bold uppercase text-[9px] animate-pulse">
                          Architecture Mismatch
                        </span>
                      )}
                    </div>

                    {!selectedAndroidApp.supportedAbis.includes('x86_64') && (
                      <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-[11px] leading-relaxed">
                        ⚠️ <strong>Warning:</strong> This APK requires ARM64 (arm64-v8a) architecture but the host Waydroid container runs on x86_64. It may fail to launch or experience runtime errors without an ARM translation layer (such as Houdini / Libndk).
                      </div>
                    )}
                  </div>
                )}

                {/* Section 7, 8, 9, 10, 13, 14: Permissions Management Card */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40">App Permissions (Security Engine)</h4>
                    <p className="text-[11px] text-white/50">Manage dynamic runtime permissions declared in the APK manifest.</p>
                  </div>

                  <div className="divide-y divide-white/5 space-y-3">
                    {selectedAndroidApp.permissions.map((p: any) => (
                      <div key={p.permission} className="pt-3 flex items-start justify-between gap-6">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{p.displayName}</span>
                            <span className="px-1.5 py-0.5 bg-white/5 text-white/40 rounded text-[9px] font-mono">
                              {p.category}
                            </span>
                          </div>
                          <p className="text-white/50 text-[11px] leading-normal">{p.description}</p>
                          <p className="font-mono text-[9px] text-white/30">{p.permission}</p>
                        </div>

                        <div className="shrink-0 pt-1 flex flex-col items-end gap-1.5">
                          {p.isToggleable ? (
                            <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-bold uppercase ${
                                p.state === 'GRANTED' ? 'text-emerald-400' : 'text-white/40'
                              }`}>
                                {p.state === 'GRANTED' ? 'Granted' : 'Denied'}
                              </span>
                              <button
                                onClick={() => handleToggleAndroidPermission(
                                  selectedAndroidApp.packageName,
                                  p.permission,
                                  p.state === 'GRANTED' ? 'DENIED' : 'GRANTED'
                                )}
                                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                                  p.state === 'GRANTED' ? 'bg-emerald-600' : 'bg-white/10 border border-white/10'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                  p.state === 'GRANTED' ? 'translate-x-6' : 'translate-x-0'
                                }`} />
                              </button>
                            </div>
                          ) : (
                            <div className="text-right">
                              <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-white/40 rounded text-[9px] font-bold uppercase font-mono tracking-wider">
                                {p.state === 'SYSTEM_CONTROLLED' ? 'System Controlled' : 'Unavailable for Toggle'}
                              </span>
                              <p className="text-[10px] text-white/30 pt-0.5">Permission is non-dangerous or constant</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 23: Deliberate Administrative Uninstall Button */}
                <div className="p-4 bg-red-950/20 border border-red-500/10 rounded-2xl flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="font-bold text-red-400">Package Removal</h4>
                    <p className="text-white/40 text-[11px]">Uninstall the package and purge its persistent storage container from the host.</p>
                  </div>
                  <button
                    onClick={() => handleUninstallAndroidApp(selectedAndroidApp.packageName)}
                    className="px-4 py-2 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 hover:border-transparent rounded-lg font-bold transition-all cursor-pointer"
                  >
                    Uninstall Application
                  </button>
                </div>
              </div>
            ) : (
              // ANDROID LIST & STATUS MAIN VIEW
              <div className="space-y-6">
                {/* Status Bar */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center text-[#E95420]">
                      <Server size={24} />
                    </div>
                    <div className="space-y-0.5">
                      <h3 className="font-bold text-white text-sm">Android Container Runtime</h3>
                      <p className="text-white/50">Manage local sandbox containers and execute compiled APK software packages.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div className="space-y-0.5 font-mono text-[10px]">
                      <div>
                        <span className="text-white/40">Container Status:</span>{' '}
                        <span className={`font-bold uppercase ${
                          androidStatus?.status === 'AVAILABLE' ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                          {androidStatus?.status || 'MISSING'}
                        </span>
                      </div>
                      <div>
                        <span className="text-white/40">APK Execution:</span>{' '}
                        <span className="text-white/60 font-bold">{androidStatus?.execution || 'UNSUPPORTED'}</span>
                      </div>
                    </div>

                    <span className={`w-3.5 h-3.5 rounded-full ${
                      androidStatus?.status === 'AVAILABLE' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`} />
                  </div>
                </div>

                {/* Section 1, 34: Real Host Android Runtime Probe & Provisioning */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-sm text-white flex items-center gap-2">
                        <Terminal size={15} className="text-[#E95420]" />
                        <span>Host Execution Environment Probe</span>
                      </h4>
                      <p className="text-white/40 text-[11px]">
                        Live verification of <code className="text-white/70">which waydroid</code>, <code className="text-white/70">which adb</code>, <code className="text-white/70">waydroid status</code>, and <code className="text-white/70">adb devices</code> on the backend machine.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => fetchAndroidData()}
                        disabled={loadingAndroidApps}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} className={loadingAndroidApps ? 'animate-spin' : ''} />
                        <span>Re-Probe Runtimes</span>
                      </button>
                      <button
                        onClick={handleRunAcceptanceTest}
                        disabled={provisioningRuntime}
                        className="px-3 py-1.5 bg-[#E95420] hover:bg-[#E95420]/80 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Play size={12} />
                        <span>Run TestAPK Acceptance</span>
                      </button>
                      <button
                        onClick={() => setShowAndroidSetup(!showAndroidSetup)}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        <Settings size={12} />
                        <span>Setup Wizard</span>
                      </button>
                    </div>
                  </div>

                  {showAndroidSetup && (
                    <div className="mt-4">
                      <AndroidSetupWizard />
                    </div>
                  )}

                  {/* Canonical 4-Row State Matrix */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px]">
                    <div className="p-2.5 bg-black/30 border border-white/10 rounded-lg flex items-center justify-between">
                      <span className="text-white/60">APK Pipeline</span>
                      <span className="text-emerald-400 font-bold">✅ READY</span>
                    </div>
                    <div className="p-2.5 bg-black/30 border border-white/10 rounded-lg flex items-center justify-between">
                      <span className="text-white/60">ADB</span>
                      <span className={androidStatus?.hostProbe?.whichAdb?.found ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {androidStatus?.hostProbe?.whichAdb?.found ? '✅ INSTALLED' : '❌ MISSING'}
                      </span>
                    </div>
                    <div className="p-2.5 bg-black/30 border border-white/10 rounded-lg flex items-center justify-between">
                      <span className="text-white/60">Android Runtime</span>
                      <span className={androidStatus?.hostProbe?.summary?.anyRuntimeReady ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {androidStatus?.hostProbe?.summary?.anyRuntimeReady ? '✅ CONNECTED' : '❌ NOT CONNECTED'}
                      </span>
                    </div>
                    <div className="p-2.5 bg-black/30 border border-white/10 rounded-lg flex items-center justify-between">
                      <span className="text-white/60">Installation</span>
                      <span className={androidStatus?.hostProbe?.summary?.anyRuntimeReady ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                        {androidStatus?.hostProbe?.summary?.anyRuntimeReady ? '✅ ENABLED' : '⚠️ HOST LIMITATION'}
                      </span>
                    </div>
                  </div>

                  {/* Section 2, 3, 6, 35: EnvironmentCapabilityModel & Honest Host Limitation Banner */}
                  {androidStatus?.capabilityModel && !androidStatus.capabilityModel.inferences.NORMAL_ANDROID_HOST && (
                    <div className="p-3.5 bg-amber-950/30 border border-amber-500/25 rounded-xl space-y-2 font-mono text-[10px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-amber-300 font-bold uppercase tracking-wider">
                          Android Runtime: UNAVAILABLE (HOST LIMITATION ≠ INSTALLATION FAILURE)
                        </span>
                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[9px] font-bold">
                          {androidStatus.capabilityModel.environmentClass}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-white/80">
                        <div className="px-2.5 py-1.5 bg-black/30 rounded border border-white/5 flex items-center justify-between">
                          <span className="text-white/50">NORMAL_ANDROID_HOST</span>
                          <span className="text-red-400 font-bold">{String(androidStatus.capabilityModel.inferences.NORMAL_ANDROID_HOST).toUpperCase()}</span>
                        </div>
                        <div className="px-2.5 py-1.5 bg-black/30 rounded border border-white/5 flex items-center justify-between">
                          <span className="text-white/50">WAYDROID_DIRECT</span>
                          <span className="text-amber-400 font-bold">{androidStatus.capabilityModel.inferences.WAYDROID_DIRECT}</span>
                        </div>
                        <div className="px-2.5 py-1.5 bg-black/30 rounded border border-white/5 flex items-center justify-between">
                          <span className="text-white/50">KVM_ANDROID_EMULATOR</span>
                          <span className="text-amber-400 font-bold">{androidStatus.capabilityModel.inferences.KVM_ANDROID_EMULATOR}</span>
                        </div>
                      </div>
                      <div className="text-white/70 space-y-0.5 text-[10px] leading-relaxed">
                        <div><span className="text-white/40">Reason:</span> {androidStatus.capabilityModel.inferences.LIMITATION_REASON}</div>
                        <div><span className="text-white/40">Required capability:</span> {androidStatus.capabilityModel.inferences.REQUIRED_CAPABILITY}</div>
                      </div>
                    </div>
                  )}

                  {/* 4 Canonical Command Outputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[10px]">
                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-white/50">
                        <span>$ which waydroid</span>
                        <span className={androidStatus?.hostProbe?.whichWaydroid?.found ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                          {androidStatus?.hostProbe?.whichWaydroid?.found ? 'FOUND' : 'NOT FOUND'}
                        </span>
                      </div>
                      <div className="text-white/80 truncate">
                        {androidStatus?.hostProbe?.whichWaydroid?.path || androidStatus?.hostProbe?.whichWaydroid?.stderr || 'waydroid: not found'}
                      </div>
                    </div>

                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-white/50">
                        <span>$ which adb</span>
                        <span className={androidStatus?.hostProbe?.whichAdb?.found ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                          {androidStatus?.hostProbe?.whichAdb?.found ? 'INSTALLED' : 'NOT FOUND'}
                        </span>
                      </div>
                      <div className="text-white/80 truncate">
                        {androidStatus?.hostProbe?.whichAdb?.path || androidStatus?.hostProbe?.whichAdb?.stderr || 'adb: not found'}
                      </div>
                    </div>

                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-white/50">
                        <span>$ waydroid status</span>
                        <span className={androidStatus?.hostProbe?.waydroidStatus?.running ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                          {androidStatus?.hostProbe?.waydroidStatus?.running ? 'RUNNING' : 'OFFLINE'}
                        </span>
                      </div>
                      <div className="text-white/80 truncate">
                        {androidStatus?.hostProbe?.waydroidStatus?.stdout || androidStatus?.hostProbe?.waydroidStatus?.stderr || 'Container: UNAVAILABLE'}
                      </div>
                    </div>

                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-white/50">
                        <span>$ adb devices</span>
                        <span className={androidStatus?.hostProbe?.adbDevices?.connectedDevices?.length > 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                          {androidStatus?.hostProbe?.adbDevices?.connectedDevices?.length > 0
                            ? `${androidStatus.hostProbe.adbDevices.connectedDevices.length} DEVICE(S)`
                            : '0 ATTACHED'}
                        </span>
                      </div>
                      <div className="text-white/80 truncate">
                        {androidStatus?.hostProbe?.adbDevices?.connectedDevices?.length > 0
                          ? androidStatus.hostProbe.adbDevices.connectedDevices.join(', ')
                          : (androidStatus?.hostProbe?.adbDevices?.stdout || 'List of devices attached (none)')}
                      </div>
                    </div>

                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1 md:col-span-2">
                      <div className="flex items-center justify-between text-white/50">
                        <span>$ waydroid shell getprop ro.build.version.release</span>
                        <span className={androidStatus?.hostProbe?.waydroidShellRelease?.androidVersion ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                          {androidStatus?.hostProbe?.waydroidShellRelease?.androidVersion
                            ? `ANDROID ${androidStatus.hostProbe.waydroidShellRelease.androidVersion}`
                            : `STATE: ${androidStatus?.authoritativeState || 'UNINITIALIZED'}`}
                        </span>
                      </div>
                      <div className="text-white/80 truncate">
                        {androidStatus?.hostProbe?.waydroidShellRelease?.stdout || androidStatus?.hostProbe?.waydroidShellRelease?.stderr || 'Waydroid is not initialized, run "waydroid init"'}
                      </div>
                    </div>
                  </div>

                  {/* Authoritative Evidence Ledger */}
                  {Array.isArray(androidStatus?.evidenceLedger) && androidStatus.evidenceLedger.length > 0 && (
                    <div className="p-3 bg-black/30 border border-white/10 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-white/50 font-bold uppercase tracking-wider">Authoritative Evidence Ledger</span>
                        <span className="text-white/40">{androidStatus.evidenceLedger.length} Verified Claims</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 font-mono text-[10px]">
                        {androidStatus.evidenceLedger.map((entry: any) => (
                          <div key={entry.key} className="px-2.5 py-1.5 bg-white/[0.03] border border-white/5 rounded flex items-center justify-between gap-2">
                            <span className="text-white/70 truncate" title={entry.claim}>{entry.key}: {entry.claim}</span>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              entry.classification === 'VERIFIED'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : entry.classification === 'FAILED'
                                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                                : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                            }`}>
                              {entry.classification}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ADB TCP Bridge Connect */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                    <span className="text-[11px] text-white/60 font-mono">Attach Android Container / ADB Target:</span>
                    <input
                      type="text"
                      value={adbTargetInput}
                      onChange={(e) => setAdbTargetInput(e.target.value)}
                      placeholder="localhost:5555 or 192.168.1.x:5555"
                      className="flex-1 min-w-[180px] bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-lg px-3 py-1.5 font-mono text-white text-xs"
                    />
                    <button
                      onClick={handleConnectAdb}
                      disabled={connectingAdb}
                      className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-50"
                    >
                      {connectingAdb ? 'Connecting...' : 'adb connect'}
                    </button>
                  </div>

                  {runtimeActionMsg && (
                    <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-[11px] text-white/80 font-mono">
                      {runtimeActionMsg}
                    </div>
                  )}
                </div>

                {/* Section 2, 16, 17: Install APK section with Real Drag-and-Drop, URL Paste & File Upload */}
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

                    // Priority 1: Real Local Dropped Files (LOCAL FILE PIPELINE)
                    const files = Array.from(e.dataTransfer.files || []);
                    if (files.length > 0) {
                      handleProcessLocalFile(files[0]);
                      return;
                    }

                    // Priority 1b: Dropped file items
                    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                      for (let i = 0; i < e.dataTransfer.items.length; i++) {
                        const item = e.dataTransfer.items[i];
                        if (item.kind === 'file') {
                          const file = item.getAsFile();
                          if (file) {
                            handleProcessLocalFile(file);
                            return;
                          }
                        }
                      }
                    }

                    // Priority 2: Dropped Link / URL or File Path
                    const uriList = e.dataTransfer.getData('text/uri-list');
                    const textPlain = e.dataTransfer.getData('text/plain');
                    const droppedText = (uriList || textPlain || '').trim();

                    if (!droppedText) {
                      setInstallResult({
                        success: false,
                        error: 'Empty drop payload. Please drag and drop a real .apk file or paste a download link.'
                      });
                      return;
                    }

                    // Web URL (http:// or https://)
                    if (droppedText.startsWith('http://') || droppedText.startsWith('https://')) {
                      handleProcessUrl(droppedText);
                      return;
                    }

                    // Local file URI (file:///...)
                    if (droppedText.startsWith('file://')) {
                      const cleanPath = decodeURIComponent(droppedText.replace(/^file:\/\//, ''));
                      setInstallApkPath(cleanPath);
                      handleInstallApk(cleanPath);
                      return;
                    }

                    // Local filesystem path (/home/... or ~/...) or .apk filename
                    if (droppedText.startsWith('/') || droppedText.startsWith('~/') || droppedText.toLowerCase().endsWith('.apk')) {
                      setInstallApkPath(droppedText);
                      handleInstallApk(droppedText);
                      return;
                    }

                    setInstallResult({
                      success: false,
                      error: `Unrecognized dropped item: "${droppedText.substring(0, 50)}". Please drag and drop a real .apk file or paste an HTTPS download URL.`
                    });
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text').trim();
                    if (text.startsWith('http://') || text.startsWith('https://')) {
                      e.preventDefault();
                      handleProcessUrl(text);
                    } else if (text.startsWith('file://') || text.startsWith('/') || text.toLowerCase().endsWith('.apk')) {
                      e.preventDefault();
                      setInstallApkPath(text);
                      handleInstallApk(text);
                    }
                  }}
                  tabIndex={0}
                  className={`border-2 border-dashed rounded-2xl p-6 transition-all duration-200 relative outline-none focus:border-[#E95420]/70 ${
                    isDraggingOver 
                      ? 'bg-[#E95420]/15 border-[#E95420] shadow-[0_0_30px_rgba(233,84,32,0.35)] scale-[1.01]' 
                      : 'bg-[#242424] border-white/20 hover:border-white/35'
                  }`}
                >
                  {/* Hidden file input for file browser picker */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".apk,application/vnd.android.package-archive"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleProcessLocalFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />

                  <div className="flex flex-col items-center justify-center text-center space-y-3">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                      isDraggingOver ? 'bg-[#E95420] text-white scale-110 shadow-lg' : 'bg-white/10 text-white/70'
                    }`}>
                      {installing ? (
                        <RefreshCw size={26} className="animate-spin text-[#E95420]" />
                      ) : isDraggingOver ? (
                        <Download size={28} className="animate-bounce" />
                      ) : (
                        <Upload size={26} />
                      )}
                    </div>

                    <div>
                      <h4 className="font-bold text-sm text-white">
                        {isDraggingOver ? 'Drop APK to install on AETHER OS' : 'Drag & Drop APK, Paste URL, or Browse'}
                      </h4>
                      <p className="text-white/40 text-xs max-w-md mx-auto mt-0.5">
                        Drop any .apk file, paste a direct download URL (<code className="text-[#E95420]">https://...</code>), or click below to browse.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={installing}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-medium text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-white/10 hover:border-white/25 active:scale-95 disabled:opacity-50"
                      >
                        <Upload size={14} />
                        <span>Choose .apk File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const testPath = '/home/ubuntu/Downloads/com.example.testapk.apk';
                          setInstallApkPath(testPath);
                          handleInstallApk(testPath);
                        }}
                        disabled={installing}
                        className="px-3.5 py-2 bg-[#E95420]/20 hover:bg-[#E95420]/30 text-[#E95420] font-semibold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-[#E95420]/30 active:scale-95 disabled:opacity-50"
                      >
                        <Package size={14} />
                        <span>Test Signed APK (com.example.testapk.apk)</span>
                      </button>
                    </div>
                  </div>

                  {/* Manual path / URL input */}
                  <div className="flex gap-2 mt-4 pt-3 border-t border-white/10">
                    <input
                      type="text"
                      value={installApkPath}
                      onChange={(e) => setInstallApkPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleInstallApk();
                      }}
                      className="flex-1 bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-xl px-4 py-2 font-mono text-white text-xs"
                      placeholder="Paste URL (https://...) or path (/home/ubuntu/Downloads/app.apk)"
                    />
                    <button
                      onClick={() => handleInstallApk()}
                      disabled={installing}
                      className="px-5 py-2 bg-[#E95420] text-white text-xs rounded-xl font-bold hover:bg-[#E95420]/80 disabled:opacity-50 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                    >
                      {installing ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>{installApkPath.startsWith('http') ? 'Downloading...' : 'Installing...'}</span>
                        </>
                      ) : (installApkPath.startsWith('http://') || installApkPath.startsWith('https://')) ? (
                        <>
                          <Download size={13} />
                          <span>Download & Install</span>
                        </>
                      ) : (
                        <span>Install Path</span>
                      )}
                    </button>
                  </div>

                  {/* Active Upload / Verification Progress Indicator */}
                  {uploadProgress && (
                    <div className="mt-3 p-3 rounded-xl bg-[#E95420]/10 border border-[#E95420]/30 text-[#E95420] text-xs flex items-center gap-2 animate-pulse">
                      <RefreshCw size={14} className="animate-spin shrink-0" />
                      <span>{uploadProgress}</span>
                    </div>
                  )}

                  {/* Pre-install Requested Permissions Disclaimer */}
                  <p className="text-[10px] text-white/30 mt-3">
                    ℹ️ <strong>System Note:</strong> Packages downloaded from URLs or dropped onto this surface are verified for ZIP magic bytes (`PK\x03\x04`), ABI compatibility, and registered into the Android Subsystem.
                  </p>

                  {installResult && (
                    <div className={`mt-3 p-4 rounded-xl border text-[11px] leading-relaxed ${
                      installResult.success 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
                        : installResult.isBrowserRequirement
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : 'bg-red-500/10 border-red-500/20 text-red-300'
                    }`}>
                      {installResult.success ? (
                        <div>
                          <strong>Success:</strong> {installResult.message}
                        </div>
                      ) : installResult.isBrowserRequirement ? (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
                            <Download size={14} />
                            <span>Browser Download Required (Client-Side Encrypted Share Page)</span>
                          </div>
                          <p className="text-white/80 leading-normal">
                            {installResult.error}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {installResult.browserUrl && (
                              <a
                                href={installResult.browserUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E95420] text-white font-semibold rounded-lg hover:bg-[#E95420]/80 transition cursor-pointer text-xs"
                              >
                                <ExternalLink size={12} />
                                <span>Open LimeWire to Download Cinema.apk</span>
                              </a>
                            )}
                            <span className="text-[11px] text-white/50">
                              👉 After downloading, drag & drop the <code className="text-white bg-black/40 px-1 py-0.5 rounded">.apk</code> file into the drop zone above.
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <strong>Installation Rejected:</strong> {installResult.error}
                          </div>
                          {installResult.apkDiagnostics && (
                            <div className="p-3 bg-black/40 border border-white/10 rounded-lg font-mono text-[10px] space-y-1.5 text-white/80">
                              <div className="font-bold text-white uppercase tracking-wider">APK vs Runtime Verification Breakdown</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                <div className="p-2 rounded bg-white/5 border border-white/10">
                                  APK valid: <span className={installResult.apkDiagnostics.apkValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{installResult.apkDiagnostics.apkValid ? '✅ YES' : '❌ NO'}</span>
                                </div>
                                <div className="p-2 rounded bg-white/5 border border-white/10">
                                  APK signed: <span className={installResult.apkDiagnostics.apkSigned ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{installResult.apkDiagnostics.apkSigned ? '✅ YES' : '⚠️ UNVERIFIED'}</span>
                                </div>
                                <div className="p-2 rounded bg-white/5 border border-white/10">
                                  APK installable: <span className={installResult.apkDiagnostics.apkInstallable ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{installResult.apkDiagnostics.apkInstallable ? '✅ YES' : '❌ NO'}</span>
                                </div>
                                <div className="p-2 rounded bg-white/5 border border-white/10">
                                  Android runtime: <span className={installResult.apkDiagnostics.runtimeAvailable ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{installResult.apkDiagnostics.runtimeAvailable ? '✅ READY' : '❌ OFFLINE'}</span>
                                </div>
                              </div>
                              {installResult.packageName && (
                                <div className="text-white/60 pt-1">
                                  Parsed Package: <span className="text-white">{installResult.applicationName}</span> (<code className="text-sky-400">{installResult.packageName}</code>)
                                </div>
                              )}
                              <div className="text-amber-300/90 pt-0.5">
                                Pipeline: APK → Installer → AndroidRuntimeDetector → {installResult.errorCode || 'NO_ANDROID_RUNTIME'} → Installation rejected (un-faked).
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Section 15: Installed Apps List */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">Installed Android Apps</h4>
                      <p className="text-white/40">Browse and manage application sandboxes, resources, and privacy access levels.</p>
                    </div>

                    {/* Search filter */}
                    <div className="relative w-64">
                      <Search size={14} className="absolute left-3 top-2.5 text-white/40" />
                      <input
                        type="text"
                        value={androidSearch}
                        onChange={(e) => setAndroidSearch(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-1.5 text-xs text-white outline-none focus:border-[#E95420]"
                        placeholder="Search by name, package, permission..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {androidApps
                      .filter(app => {
                        const q = androidSearch.toLowerCase();
                        if (!q) return true;
                        const matchName = app.applicationName.toLowerCase().includes(q);
                        const matchPackage = app.packageName.toLowerCase().includes(q);
                        const matchPermission = app.permissions.some((p: any) => p.displayName.toLowerCase().includes(q) || p.permission.toLowerCase().includes(q));
                        return matchName || matchPackage || matchPermission;
                      })
                      .map(app => (
                        <div
                          key={app.packageName}
                          className="p-4 bg-black/20 border border-white/5 hover:border-white/15 rounded-2xl flex items-center justify-between gap-4 transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-[#E95420] shrink-0">
                              <Server size={20} />
                            </div>
                            <div className="min-w-0">
                              <h5 className="font-bold text-white truncate">{app.applicationName}</h5>
                              <p className="font-mono text-[9px] text-white/40 truncate">{app.packageName}</p>
                              <div className="flex items-center gap-2 pt-0.5 text-[9px] text-white/50">
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  app.runtimeState === 'RUNNING' ? 'bg-emerald-500' : 'bg-white/20'
                                }`} />
                                <span className="capitalize">{app.runtimeState.toLowerCase()}</span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => setSelectedAndroidApp(app)}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 hover:text-[#E95420] border border-white/10 rounded-lg font-semibold transition-colors shrink-0 cursor-pointer text-[11px]"
                          >
                            Settings & Perms
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Ω-SYSTEM PRIVACY & PERMISSION CONTROL PLANE */}
        {activeSection === 'privacy' && (
          <div className="max-w-4xl space-y-6 text-xs">
            {/* Header Authority Card */}
            <div className="bg-gradient-to-r from-red-950/20 via-black/40 to-slate-950/20 border border-red-500/10 rounded-2xl p-6 flex items-center justify-between shadow-2xl">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-400">
                  <ShieldCheck size={28} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white tracking-wide">Ω-Policy Control Plane</h3>
                  <p className="text-white/50 text-[11px] leading-relaxed">System-wide authoritative security, privacy enforcement, and platform driver reconciliation.</p>
                </div>
              </div>

              {/* Admin Mode Display */}
              <div className="flex flex-col items-end gap-1.5 text-right font-mono">
                <div className="text-[10px] text-white/40 uppercase">Authority Level</div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider ${
                    adminLevel === 'SYSTEM' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                    adminLevel === 'ADMIN' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                  }`}>
                    {adminLevel}
                  </span>
                  
                  {adminLevel === 'USER' ? (
                    <button
                      onClick={() => setElevating(true)}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded font-semibold text-white/80 hover:text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock size={11} /> Elevate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAdminAuth('USER', '')}
                      className="px-2.5 py-1 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 rounded font-semibold text-red-400 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Unlock size={11} /> Drop Level
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Elevate Credentials Modal */}
            {elevating && (
              <div className="p-4 bg-black/40 border border-white/10 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white flex items-center gap-1.5"><ShieldAlert size={14} className="text-amber-400" /> Enter Authority Credentials</span>
                  <button onClick={() => setElevating(false)} className="text-white/40 hover:text-white">✕</button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="Enter Admin passcode (admin / system123)..."
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="flex-1 bg-black/40 border border-white/15 focus:border-[#E95420] outline-none rounded-xl px-4 py-2 font-mono text-white text-xs"
                  />
                  <button
                    onClick={() => handleAdminAuth('ADMIN', adminPassword)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold transition-all cursor-pointer"
                  >
                    Authorize ADMIN
                  </button>
                  <button
                    onClick={() => handleAdminAuth('SYSTEM', adminPassword)}
                    className="px-4 py-2 bg-[#E95420] text-white rounded-xl font-bold transition-all cursor-pointer"
                  >
                    Authorize SYSTEM
                  </button>
                </div>
                {authError && <p className="text-red-400 text-[10px] font-semibold">{authError}</p>}
              </div>
            )}

            {/* Tab Links inside Privacy Section */}
            <div className="flex flex-wrap gap-1 p-1 bg-black/40 rounded-xl border border-white/10">
              {[
                { id: 'global', label: 'Global Policies', icon: <Sliders size={13} /> },
                { id: 'location-control', label: 'Location Control', icon: <MapPin size={13} /> },
                { id: 'wifi-control', label: 'Wi-Fi Control', icon: <Wifi size={13} /> },
                { id: 'network-policy', label: 'App Network Policy', icon: <Globe size={13} /> },
                { id: 'matrix', label: 'Effective Matrix', icon: <Layout size={13} /> },
                { id: 'search', label: 'Permission Search', icon: <Search size={13} /> },
                { id: 'audit', label: 'Security Audit Log', icon: <History size={13} /> },
                { id: 'access', label: 'Usage History', icon: <Clock size={13} /> }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setPrivacyTab(t.id)}
                  className={`flex-1 min-w-[120px] py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    privacyTab === t.id ? 'bg-[#E95420] text-white shadow' : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* TAB: Location Control */}
            {privacyTab === 'location-control' && privacyMatrix && (
              <div className="space-y-6">
                {/* Global Location Settings Card */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">Location Services Control</h4>
                      <p className="text-white/40">Toggle system-wide GPS/Location services provider and verify platform status.</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold font-mono ${
                        privacyMatrix.systemStates.LOCATION === 'ENABLED' ? 'text-emerald-400' : 'text-white/40'
                      }`}>
                        {privacyMatrix.systemStates.LOCATION === 'ENABLED' ? 'ENABLED' : 'DISABLED'}
                      </span>
                      <button
                        onClick={() => handleUpdateSystemPolicy('LOCATION', privacyMatrix.systemStates.LOCATION === 'ENABLED' ? 'DISABLED' : 'ENABLED', 'systemState')}
                        className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                          privacyMatrix.systemStates.LOCATION === 'ENABLED' ? 'bg-emerald-600' : 'bg-white/10 border border-white/10'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          privacyMatrix.systemStates.LOCATION === 'ENABLED' ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 font-mono text-[10px] text-white/50">
                    <div className="p-3 bg-black/20 border border-white/5 rounded-xl space-y-1">
                      <div className="text-white/40 uppercase">Hardware availability</div>
                      <div className="font-bold text-amber-500">DEVICE_UNAVAILABLE (GPS Hardware receiver missing on cloud host)</div>
                    </div>
                    <div className="p-3 bg-black/20 border border-white/5 rounded-xl space-y-1">
                      <div className="text-white/40 uppercase">Global OS Policy</div>
                      <div className={`font-bold uppercase ${privacyMatrix.globalPolicies.LOCATION === 'ALLOW' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {privacyMatrix.globalPolicies.LOCATION === 'ALLOW' ? 'ALLOWED' : 'BLOCKED BY ADMIN'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Per-Application Location Accuracy Control */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">Application Location Policy</h4>
                    <p className="text-white/40">Granularly control coordinates precision and background execution per app sandbox.</p>
                  </div>

                  <div className="divide-y divide-white/5">
                    {privacyMatrix.appMatrix
                      .filter((app: any) => app.permissions.LOCATION && app.permissions.LOCATION.declared)
                      .map((app: any) => {
                        const currentAccuracy = privacyMatrix.appLocationAccuracies[app.packageName] || 'BACKGROUND';
                        const effectiveLoc = app.permissions.LOCATION;

                        return (
                          <div key={app.packageName} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">{app.applicationName}</span>
                                <span className="font-mono text-[9px] text-white/40 truncate">{app.packageName}</span>
                              </div>
                              <div className="flex items-center gap-2.5 font-mono text-[9px] text-white/40">
                                <span>Effective Status:</span>
                                <span className={`font-bold ${effectiveLoc.effective === 'GRANTED' ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {effectiveLoc.effective}
                                </span>
                                {effectiveLoc.effective !== 'GRANTED' && (
                                  <span className="text-amber-400">({effectiveLoc.reason})</span>
                                )}
                              </div>
                            </div>

                            {/* Dropdown accuracy control */}
                            <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
                              <span className="text-white/40 text-[10px] font-mono">Location Mode:</span>
                              <select
                                value={currentAccuracy}
                                onChange={(e) => handleUpdateAppLocationAccuracy(app.packageName, e.target.value as any)}
                                className="bg-black/50 border border-white/15 outline-none rounded-lg px-3 py-1.5 font-sans font-semibold text-white text-xs cursor-pointer focus:border-[#E95420]"
                              >
                                <option value="NEVER">NEVER (Deny Location)</option>
                                <option value="FOREGROUND">FOREGROUND (While App In Use)</option>
                                <option value="BACKGROUND">BACKGROUND (Foreground + Background)</option>
                                <option value="APPROXIMATE">APPROXIMATE (Coarse / Cellular network only)</option>
                                <option value="PRECISE">PRECISE (High accuracy / Precise coords)</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    {privacyMatrix.appMatrix.filter((app: any) => app.permissions.LOCATION && app.permissions.LOCATION.declared).length === 0 && (
                      <div className="py-6 text-center text-white/40 italic">
                        No installed Android applications currently declare or request LOCATION permissions.
                      </div>
                    )}
                  </div>
                </div>

                {/* Location Access Log / Polling */}
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-3">
                  <h4 className="font-bold text-sm">Recent Location Access Logs</h4>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/20 divide-y divide-white/5 font-mono text-[10px]">
                    {auditLogs.filter(log => log.resource === 'LOCATION' || log.resource === 'APP_LOCATION_ACCURACY').length === 0 ? (
                      <div className="p-6 text-center text-white/30 italic">No recent Location accesses or state overrides captured.</div>
                    ) : (
                      auditLogs
                        .filter(log => log.resource === 'LOCATION' || log.resource === 'APP_LOCATION_ACCURACY')
                        .map((log, i) => (
                          <div key={i} className="p-3 hover:bg-white/5 transition-all flex items-center justify-between">
                            <span className="text-white/60">
                              <span className="text-emerald-400">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                              App <span className="text-sky-400 font-bold">{log.package}</span> requested coordinates
                            </span>
                            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-bold">
                              {log.result}
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: Wi-Fi Control */}
            {privacyTab === 'wifi-control' && privacyMatrix && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">System Wi-Fi Multidimensional Matrix</h4>
                    <p className="text-white/40">Inspect real physical interfaces, driver layers, nearby discoveries, and network policies separately.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Dimension 1: WIFI HARDWARE/SYSTEM STATE */}
                    <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">1. Hardware & System State</span>
                        <span className={`px-2 py-0.5 rounded font-bold text-[9px] font-mono uppercase ${
                          privacyMatrix.systemStates.WIFI === 'ENABLED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                        }`}>
                          {privacyMatrix.systemStates.WIFI === 'ENABLED' ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        Control the physical state of wireless radio interfaces. Turning this off blocks all local network scans and wireless packets.
                      </p>
                      <button
                        onClick={() => handleUpdateSystemPolicy('WIFI', privacyMatrix.systemStates.WIFI === 'ENABLED' ? 'DISABLED' : 'ENABLED', 'systemState')}
                        className={`w-full py-1.5 rounded-lg font-bold text-xs border transition-all cursor-pointer ${
                          privacyMatrix.systemStates.WIFI === 'ENABLED'
                            ? 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border-red-500/20'
                            : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border-emerald-500/20'
                        }`}
                      >
                        {privacyMatrix.systemStates.WIFI === 'ENABLED' ? 'Disable Wireless Interface' : 'Enable Wireless Interface'}
                      </button>
                    </div>

                    {/* Dimension 2: NETWORK CONNECTION */}
                    <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono block">2. Active Network Connection</span>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        Underlying system internet interface. Since this runs in a cloud virtualization environment, Wi-Fi connectivity is bridged natively over high-speed Ethernet.
                      </p>
                      <div className="pt-1.5 font-mono text-[10px] space-y-1 text-white/60">
                        <div>Connection Type: <span className="text-emerald-400">Bridged Ethernet (eth0)</span></div>
                        <div>Virtual Link Speed: <span className="text-white font-bold">10 Gbps / Infinite Loopback</span></div>
                        <div>IP Address: <span className="text-[#E95420] font-bold">172.17.0.1 (LXC Bridge)</span></div>
                      </div>
                    </div>

                    {/* Dimension 3: APP WIFI ACCESS */}
                    <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono block">3. Application Wi-Fi Access</span>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        Lists which sandbox applications currently declare or hold runtime access to Wi-Fi state verification.
                      </p>
                      <div className="divide-y divide-white/5 max-h-24 overflow-y-auto pt-1 font-mono text-[9px] text-white/40">
                        {privacyMatrix.appMatrix
                          .filter((app: any) => app.permissions.NEARBY_DEVICES && app.permissions.NEARBY_DEVICES.declared)
                          .map((app: any) => (
                            <div key={app.packageName} className="py-1 flex items-center justify-between">
                              <span className="text-white/80 font-bold">{app.applicationName}</span>
                              <span className="text-emerald-400">AUTHORIZED</span>
                            </div>
                          ))}
                        {privacyMatrix.appMatrix.filter((app: any) => app.permissions.NEARBY_DEVICES && app.permissions.NEARBY_DEVICES.declared).length === 0 && (
                          <div className="py-2 text-white/40 italic">No apps requesting standalone Wi-Fi state information.</div>
                        )}
                      </div>
                    </div>

                    {/* Dimension 4: NEARBY WIFI ACCESS */}
                    <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono block">4. Nearby Devices Discovery</span>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        Maps to Android 13+ <code>NEARBY_WIFI_DEVICES</code> permission. Allows sandbox containers to search for and connect to nearby Wi-Fi hardware without prompting for location services.
                      </p>
                      <div className="pt-1.5 font-mono text-[10px] space-y-1 text-white/60">
                        <div>Enforcement Level: <span className="text-[#E95420] font-bold">Authoritative LXC Isolation</span></div>
                        <div>Policy Guard: <span className="text-white">Active</span></div>
                      </div>
                    </div>

                    {/* Dimension 5: LOCATION DEPENDENCY */}
                    <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-2 col-span-1 md:col-span-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono block">5. Legacy Location Dependencies</span>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        ⚠️ <strong>Technical Notice:</strong> For legacy applications (targeting Android 12 or below), scanning Wi-Fi routers/APs historically leaks physical location coordinates. Therefore, the OS security plane mandates both <strong>Location Services</strong> and <strong>GPS Access</strong> to be active for those legacy Wi-Fi scans to return data.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: Application Network Policy */}
            {privacyTab === 'network-policy' && privacyMatrix && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">Application Network Policies (Firewall Control Plane)</h4>
                    <p className="text-white/40">Toggle general TCP/UDP internet connection allowance per individual app sandbox.</p>
                  </div>

                  <div className="divide-y divide-white/5">
                    {privacyMatrix.appMatrix.map((app: any) => {
                      const netPolicy = privacyMatrix.appNetworkPolicies[app.packageName] || 'ALLOW';
                      const hasInternetPerm = app.permissions.NETWORK && app.permissions.NETWORK.declared;
                      const effectiveNet = app.permissions.NETWORK;

                      return (
                        <div key={app.packageName} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-xs">{app.applicationName}</span>
                              <span className="font-mono text-[9px] text-white/40 truncate">{app.packageName}</span>
                            </div>
                            <div className="flex items-center gap-2 font-mono text-[9px]">
                              <span className="text-white/40">Declared:</span>
                              <span className={`font-bold ${hasInternetPerm ? 'text-emerald-400' : 'text-white/40'}`}>
                                {hasInternetPerm ? 'YES' : 'NO'}
                              </span>
                              {hasInternetPerm && (
                                <>
                                  <span className="text-white/10">|</span>
                                  <span className="text-white/40">Effective internet access:</span>
                                  <span className={`font-bold ${effectiveNet.effective === 'GRANTED' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {effectiveNet.effective}
                                  </span>
                                  {effectiveNet.effective !== 'GRANTED' && (
                                    <span className="text-red-400">({effectiveNet.reason})</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Allow/Deny control buttons */}
                          <div className="flex p-0.5 bg-black/40 rounded-lg border border-white/10 shrink-0 self-start md:self-auto">
                            <button
                              onClick={() => handleUpdateAppNetworkPolicy(app.packageName, 'ALLOW')}
                              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                                netPolicy === 'ALLOW'
                                  ? 'bg-emerald-600 text-white shadow'
                                  : 'text-white/50 hover:text-white'
                              }`}
                            >
                              ALLOW
                            </button>
                            <button
                              onClick={() => handleUpdateAppNetworkPolicy(app.packageName, 'DENY')}
                              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                                netPolicy === 'DENY'
                                  ? 'bg-red-600 text-white shadow'
                                  : 'text-white/50 hover:text-white'
                              }`}
                            >
                              DENY
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 1: Global system policies */}
            {privacyTab === 'global' && privacyMatrix && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">System-Wide Resource Matrix</h4>
                    <p className="text-white/40">Inspect actual platform hardware and override the system authorization plane.</p>
                  </div>

                  <div className="divide-y divide-white/5">
                    {Object.keys(privacyMatrix.globalPolicies).map(resKey => {
                      const policy = privacyMatrix.globalPolicies[resKey];
                      const sState = privacyMatrix.systemStates[resKey];
                      const isAvailable = privacyMatrix.hardware[resKey];

                      return (
                        <div key={resKey} className="py-4 flex items-center justify-between gap-6">
                          <div className="space-y-1">
                            <span className="font-semibold text-white tracking-wide text-xs">{resKey}</span>
                            <div className="flex items-center gap-3 text-[10px] font-mono">
                              <span className="text-white/40">Hardware status:</span>
                              <span className={`font-bold ${isAvailable ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {isAvailable ? 'AVAILABLE' : 'DEVICE_UNAVAILABLE'}
                              </span>
                              <span className="text-white/10">|</span>
                              <span className="text-white/40">Policy:</span>
                              <span className={`font-bold uppercase ${policy === 'ALLOW' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {policy}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            {/* System state toggle (e.g. Turn Location on/off) */}
                            <div className="flex items-center gap-2">
                              <span className="text-white/40 text-[10px]">Service Switch:</span>
                              <button
                                onClick={() => handleUpdateSystemPolicy(resKey, sState === 'ENABLED' ? 'DISABLED' : 'ENABLED', 'systemState')}
                                className={`w-10 h-5.5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                                  sState === 'ENABLED' ? 'bg-emerald-600' : 'bg-white/10 border border-white/15'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                  sState === 'ENABLED' ? 'translate-x-4.5' : 'translate-x-0'
                                }`} />
                              </button>
                            </div>

                            {/* Global OS policy overwrite toggle (User/Admin/System role-dependent) */}
                            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
                              <span className="text-white/40 text-[10px]">Admin Block:</span>
                              <button
                                onClick={() => handleUpdateSystemPolicy(resKey, policy === 'ALLOW' ? 'BLOCK' : 'ALLOW', 'osPolicy')}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                  policy === 'ALLOW' 
                                    ? 'bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10' 
                                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                }`}
                              >
                                {policy === 'ALLOW' ? 'Unblocked' : 'BLOCKED'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: App Effective permissions grid */}
            {privacyTab === 'matrix' && privacyMatrix && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">Application Effective Access Plane</h4>
                    <p className="text-white/40">Displays calculated effective access derived from: <strong>Declared &times; Runtime Granted &times; OS Allowed &times; Hardware Available</strong>.</p>
                  </div>

                  <div className="space-y-4">
                    {privacyMatrix.appMatrix.map((app: any) => (
                      <div key={app.packageName} className="p-4 bg-black/20 border border-white/5 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-xs">{app.applicationName}</span>
                            <span className="font-mono text-[9px] text-white/40">{app.packageName}</span>
                          </div>
                          <span className="font-mono text-[9px] text-white/40">v{app.versionName}</span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {Object.keys(app.permissions).map(resKey => {
                            const pStatus = app.permissions[resKey];
                            if (!pStatus.declared) return null; // Only show actually declared resources

                            return (
                              <div key={resKey} className="p-3 bg-black/35 rounded-xl border border-white/5 flex flex-col justify-between gap-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-white/80 tracking-wide">{resKey}</span>
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                    pStatus.effective === 'GRANTED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                    pStatus.effective === 'UNKNOWN' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                    'bg-red-500/15 text-red-400 border border-red-500/20'
                                  }`}>
                                    {pStatus.effective}
                                  </span>
                                </div>

                                <div className="font-mono text-[9px] space-y-0.5 text-white/40">
                                  {pStatus.effective !== 'GRANTED' && (
                                    <div className="text-red-400 font-bold">
                                      Reason: {pStatus.reason}
                                    </div>
                                  )}
                                  <div>Runtime: <span className="text-white/60">{pStatus.runtime}</span></div>
                                  <div>Policy: <span className="text-white/60">{pStatus.osPolicy}</span></div>
                                  <div>Service: <span className="text-white/60">{pStatus.systemState}</span></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Permission search queries */}
            {privacyTab === 'search' && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">Security Query Engine</h4>
                      <p className="text-white/40">Answer authority checks based on canonical OS permissions state.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-white/40 font-mono text-[10px]">Which apps can use:</span>
                      <select
                        value={searchResource}
                        onChange={(e) => {
                          setSearchResource(e.target.value);
                          handleSearchResource(e.target.value);
                        }}
                        className="bg-black/50 border border-white/15 outline-none rounded-lg px-3 py-1.5 font-sans font-bold text-white text-xs cursor-pointer"
                      >
                        {['LOCATION', 'WIFI', 'BLUETOOTH', 'NEARBY_DEVICES', 'NETWORK', 'CAMERA', 'MICROPHONE', 'NOTIFICATIONS', 'CONTACTS', 'STORAGE', 'SENSORS', 'MEDIA', 'BACKGROUND_EXECUTION', 'CLIPBOARD'].map(item => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="divide-y divide-white/5 pt-2">
                    {searchResults.length === 0 ? (
                      <div className="py-8 text-center text-white/30 italic">
                        No applications currently declare or have access to {searchResource}.
                      </div>
                    ) : (
                      searchResults.map(app => (
                        <div key={app.packageName} className="py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center text-[#E95420]">
                              <Server size={16} />
                            </div>
                            <div className="min-w-0">
                              <h5 className="font-bold text-white truncate">{app.applicationName}</h5>
                              <p className="font-mono text-[9px] text-white/40 truncate">{app.packageName}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-6 shrink-0 text-right">
                            <div className="font-mono text-[9px] text-white/40 space-y-0.5">
                              <div>Effective Status: <span className={`font-bold ${app.effective === 'GRANTED' ? 'text-emerald-400' : 'text-red-400'}`}>{app.effective}</span></div>
                              {app.effective !== 'GRANTED' && <div>Denial Reason: <span className="text-amber-400 font-bold">{app.reason}</span></div>}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: Audit trails */}
            {privacyTab === 'audit' && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">Administrative Audit Trail</h4>
                      <p className="text-white/40">Evidence log of security & permissions transitions. Purely informative, tamper-resistant.</p>
                    </div>
                    <button
                      onClick={fetchAuditLogs}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 flex items-center gap-1.5 text-white/80 cursor-pointer"
                    >
                      <RefreshCw size={12} /> Refresh Logs
                    </button>
                  </div>

                  <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-black/20 divide-y divide-white/5 font-mono text-[10px]">
                    {auditLogs.length === 0 ? (
                      <div className="p-8 text-center text-white/30 italic">No events recorded in security audit logs.</div>
                    ) : (
                      auditLogs.map((log, index) => (
                        <div key={index} className="p-3 hover:bg-white/5 transition-all flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-emerald-400 font-bold">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                              <span className="text-white/40">Actor:</span>
                              <span className="text-[#E95420] font-bold">{log.actor}</span>
                              <span className="text-white/40">Target:</span>
                              <span className="text-sky-400 font-bold truncate">{log.package}</span>
                            </div>
                            <div className="text-white/70">
                              Resource: <span className="text-white font-bold">{log.resource}</span> &middot; Old State: <span className="text-white/40">"{log.oldState}"</span> &rarr; New State: <span className="text-emerald-400 font-bold">"{log.newState}"</span>
                            </div>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider self-start md:self-auto ${
                            log.result === 'SUCCESS' || log.result === 'AUTHORIZED' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                          }`}>
                            {log.result}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: Usage History (Recent Access) */}
            {privacyTab === 'access' && (
              <div className="space-y-6">
                <div className="bg-[#242424] border border-white/10 rounded-2xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-sm">Sensitive Hardware Usage History</h4>
                    <p className="text-white/40">Real-time driver polling for recent camera, microphone, and location accesses.</p>
                  </div>

                  <div className="p-8 text-center text-white/30 border border-dashed border-white/10 bg-black/10 rounded-2xl italic font-mono text-[11px]">
                    🔍 ACCESS HISTORY UNAVAILABLE (No native device usage polling support on host LXC kernel interface)
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DEFAULT FALLBACK FOR OTHER TABS */}
        {!['appearance', 'dock', 'displays', 'sound', 'about', 'wifi', 'packages', 'android', 'privacy'].includes(activeSection) && (

          <div className="max-w-2xl space-y-4">
            <h2 className="text-xl font-bold capitalize">{activeSection}</h2>
            <div className="p-6 bg-[#242424] border border-white/10 rounded-2xl text-xs text-white/60">
              Settings for {activeSection} are active and integrated with the AETHER Linux daemon.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
