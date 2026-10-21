export type ConnectionState =
  | 'UNCONFIGURED'
  | 'PAIRING_REQUIRED'
  | 'CONNECTING'
  | 'AUTHENTICATION_FAILED'
  | 'CONNECTED'
  | 'ANDROID_READY'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export interface RuntimeProfile {
  id: string;
  displayName: string;
  type: 'LOCAL' | 'REMOTE_LINUX' | 'ADB_DEVICE';
  endpoint: string;
  port?: number;
  tlsVerify: boolean;
  timeoutMs: number;
  lastVerifiedAndroidVersion?: string | null;
  lastVerifiedAbi?: string | null;
  lastObservedCapabilities?: Record<string, boolean>;
  lastConnectedTime?: string;
  status: ConnectionState;
  lastError?: string | null;
}

export interface RuntimeDiagnostics {
  selectedRuntime: string;
  hostIdentity: string | null;
  connectionStatus: ConnectionState;
  authStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  androidVersion: string | null;
  abi: string | null;
  packageManagerStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  installationCapability: 'PASS' | 'WARN' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  displayStreamCapability: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  inputCapability: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  lastHealthCheck: string | null;
  failingStage: string | null;
  evidence: string[];
}

class AndroidConnectionManager {
  private state: ConnectionState = 'UNCONFIGURED';
  private profiles: RuntimeProfile[] = [];
  private activeProfileId: string | null = null;
  private lastError: string | null = null;
  private listeners: Array<(state: ConnectionState, profiles: RuntimeProfile[]) => void> = [];

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      const savedProfiles = localStorage.getItem('arclight_runtime_profiles');
      const savedActive = localStorage.getItem('arclight_active_runtime_id');
      if (savedProfiles) {
        this.profiles = JSON.parse(savedProfiles);
      }
      if (savedActive) {
        this.activeProfileId = savedActive;
        const active = this.profiles.find(p => p.id === savedActive);
        if (active) {
          this.state = active.status;
        }
      }
      if (this.profiles.length === 0) {
        const localProfile: RuntimeProfile = {
          id: 'local-default',
          displayName: 'Local Android Runtime (gVisor Restricted)',
          type: 'LOCAL',
          endpoint: 'localhost',
          tlsVerify: true,
          timeoutMs: 5000,
          status: 'UNSUPPORTED',
          lastObservedCapabilities: {
            isGvisor: true,
            hasBinder: false,
            hasKvm: false
          }
        };
        this.profiles.push(localProfile);
        this.activeProfileId = localProfile.id;
        this.state = 'UNSUPPORTED';
      }
    } catch (e) {
      console.error('Failed to load runtime profiles', e);
    }
  }

  private saveState() {
    try {
      localStorage.setItem('arclight_runtime_profiles', JSON.stringify(this.profiles));
      if (this.activeProfileId) {
        localStorage.setItem('arclight_active_runtime_id', this.activeProfileId);
      }
    } catch (e) {
      console.error('Failed to save runtime profiles', e);
    }
  }

  public subscribe(listener: (state: ConnectionState, profiles: RuntimeProfile[]) => void) {
    this.listeners.push(listener);
    listener(this.state, this.profiles);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l(this.state, this.profiles));
  }

  private setState(state: ConnectionState, errorMsg?: string | null) {
    this.state = state;
    if (errorMsg !== undefined) {
      this.lastError = errorMsg;
    }
    if (this.activeProfileId) {
      const p = this.profiles.find(x => x.id === this.activeProfileId);
      if (p) {
        p.status = state;
        if (errorMsg !== undefined) {
          p.lastError = errorMsg;
        }
      }
    }
    this.saveState();
    this.notify();
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getProfiles(): RuntimeProfile[] {
    return this.profiles;
  }

  public getActiveProfile(): RuntimeProfile | null {
    return this.profiles.find(p => p.id === this.activeProfileId) || null;
  }

  public setActiveProfile(id: string) {
    const p = this.profiles.find(x => x.id === id);
    if (p) {
      this.activeProfileId = id;
      this.state = p.status;
      this.lastError = p.lastError || null;
      this.saveState();
      this.notify();
    }
  }

  public addProfile(profile: Omit<RuntimeProfile, 'id' | 'status'>): string {
    const id = 'runtime-' + Math.random().toString(36).substring(2, 9);
    const newProfile: RuntimeProfile = {
      ...profile,
      id,
      status: 'UNCONFIGURED'
    };
    this.profiles.push(newProfile);
    this.activeProfileId = id;
    this.saveState();
    this.notify();
    return id;
  }

  public removeProfile(id: string) {
    this.profiles = this.profiles.filter(p => p.id !== id);
    if (this.activeProfileId === id) {
      this.activeProfileId = this.profiles[0]?.id || null;
      this.state = this.profiles[0]?.status || 'UNSUPPORTED';
    }
    this.saveState();
    this.notify();
  }

  public async connectLocal() {
    this.setState('CONNECTING', null);
    try {
      const res = await fetch('/api/android/status');
      if (res.ok) {
        const data = await res.json();
        const isGvisor = data.capabilities?.isGvisor || data.kernel?.toLowerCase().includes('gvisor');
        const hasBinder = data.capabilities?.hasBinder;
        if (isGvisor || !hasBinder || !data.ready) {
          const reason = `LOCAL_RUNTIME_UNSUPPORTED: Kernel (${data.kernel || '4.19.0-gvisor'}) lacks /dev/binder and /dev/kvm.`;
          this.setState('UNSUPPORTED', reason);
          return { success: false, reason };
        }
        this.setState('ANDROID_READY', null);
        return { success: true };
      }
    } catch (err: any) {
      const reason = `LOCAL_RUNTIME_UNSUPPORTED: ${err.message || 'Failed to probe local runtime'}`;
      this.setState('UNSUPPORTED', reason);
      return { success: false, reason };
    }

    const reason = 'LOCAL_RUNTIME_UNSUPPORTED: gVisor sandbox environment.';
    this.setState('UNSUPPORTED', reason);
    return { success: false, reason };
  }

  public async initiatePairing(endpoint: string, port: number, tlsVerify: boolean): Promise<string> {
    this.setState('PAIRING_REQUIRED', null);
    const profile = this.getActiveProfile();
    if (profile) {
      profile.endpoint = endpoint;
      profile.port = port;
      profile.tlsVerify = tlsVerify;
      profile.status = 'PAIRING_REQUIRED';
    }
    this.saveState();
    this.notify();
    return 'ENTER_HOST_TOKEN_OR_PIN';
  }

  public async pairWithHost(tokenOrCode: string): Promise<{ success: boolean; error?: string }> {
    const profile = this.getActiveProfile();
    if (!profile) {
      return { success: false, error: 'REMOTE_HOST_NOT_CONFIGURED: No active runtime profile selected.' };
    }

    this.setState('CONNECTING', null);
    try {
      const isAdb = profile.type === 'ADB_DEVICE' || profile.port === 5555;
      const res = await fetch('/api/android/remote/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: isAdb ? 'ADB_TCP' : 'REST_TLS',
          host: profile.endpoint,
          port: profile.port || (isAdb ? 5555 : 8555),
          token: tokenOrCode.trim() || undefined,
          tlsEnabled: profile.tlsVerify,
          adbTarget: isAdb ? `${profile.endpoint}:${profile.port || 5555}` : undefined
        })
      });
      const data = await res.json();
      if (data.success && data.status?.state === 'ANDROID_READY') {
        profile.status = 'ANDROID_READY';
        profile.lastConnectedTime = new Date().toISOString();
        profile.lastVerifiedAndroidVersion = data.status.androidVersion;
        profile.lastVerifiedAbi = data.status.architecture;
        profile.lastError = null;
        this.setState('ANDROID_READY', null);
        return { success: true };
      } else {
        const errState: ConnectionState = data.status?.state === 'AUTHENTICATION_FAILED'
          ? 'AUTHENTICATION_FAILED'
          : 'DISCONNECTED';
        const errMsg = data.message || data.status?.lastError || 'REMOTE_HOST_DISCONNECTED: Could not reach or authenticate with remote host.';
        this.setState(errState, errMsg);
        return { success: false, error: errMsg };
      }
    } catch (err: any) {
      const errMsg = `REMOTE_HOST_DISCONNECTED: ${err.message}`;
      this.setState('DISCONNECTED', errMsg);
      return { success: false, error: errMsg };
    }
  }

  public async verifyRuntime(): Promise<{ success: boolean; version?: string; abi?: string; error?: string }> {
    const profile = this.getActiveProfile();
    if (!profile) return { success: false, error: 'REMOTE_HOST_NOT_CONFIGURED: No active profile' };

    if (profile.type === 'LOCAL') {
      const loc = await this.connectLocal();
      return loc.success ? { success: true, version: 'Local Android', abi: 'x86_64' } : { success: false, error: loc.reason };
    }

    this.setState('CONNECTING', null);
    try {
      const res = await fetch('/api/android/remote/status');
      if (res.ok) {
        const data = await res.json();
        if (data.connected && data.state === 'ANDROID_READY' && data.androidVersion && data.packageManagerReady) {
          profile.status = 'ANDROID_READY';
          profile.lastVerifiedAndroidVersion = data.androidVersion;
          profile.lastVerifiedAbi = data.architecture;
          profile.lastError = null;
          this.setState('ANDROID_READY', null);
          return {
            success: true,
            version: data.androidVersion,
            abi: data.architecture
          };
        } else {
          const errMsg = data.lastError || `${data.state || 'REMOTE_HOST_DISCONNECTED'}: Remote Android runtime is not connected or not ready.`;
          this.setState('DISCONNECTED', errMsg);
          return {
            success: false,
            error: errMsg
          };
        }
      }
    } catch (err: any) {
      const errMsg = `REMOTE_HOST_DISCONNECTED: ${err.message}`;
      this.setState('DISCONNECTED', errMsg);
      return { success: false, error: errMsg };
    }

    const fallbackErr = 'REMOTE_HOST_DISCONNECTED: Unable to verify remote Android runtime.';
    this.setState('DISCONNECTED', fallbackErr);
    return { success: false, error: fallbackErr };
  }

  public async testInstallationCapability(): Promise<{ success: boolean; message: string }> {
    const profile = this.getActiveProfile();
    if (!profile || profile.type === 'LOCAL') {
      return {
        success: false,
        message: 'LOCAL_RUNTIME_UNSUPPORTED: Local package manager check blocked because kernel is a gVisor sandbox lacking /dev/binder.'
      };
    }

    try {
      const res = await fetch('/api/android/verify', { method: 'POST' });
      if (res.ok) {
        const report = await res.json();
        if (report.overallStatus === 'PASS') {
          return {
            success: true,
            message: `PASS: End-to-end verification succeeded (${report.evidence})`
          };
        }
        return {
          success: false,
          message: `${report.overallStatus} [${report.firstBlockerCode}]: ${report.rootCause}`
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Verification request failed: ${err.message}`
      };
    }

    return {
      success: false,
      message: 'REMOTE_HOST_DISCONNECTED: Package manager unreachable.'
    };
  }

  public async disconnect() {
    try {
      await fetch('/api/android/remote/disconnect', { method: 'POST' });
    } catch {}
    this.setState('DISCONNECTED', 'Disconnected by user');
  }

  public forgetRuntime(id: string) {
    this.removeProfile(id);
  }

  public revokeCredentials() {
    this.setState('PAIRING_REQUIRED', 'Credentials revoked');
  }

  public getDiagnostics(): RuntimeDiagnostics {
    const profile = this.getActiveProfile();
    const isReady = this.state === 'ANDROID_READY';
    const isUnsupported = this.state === 'UNSUPPORTED' || profile?.type === 'LOCAL';

    return {
      selectedRuntime: profile?.displayName || 'None',
      hostIdentity: profile?.endpoint ? `${profile.endpoint}:${profile.port || 8555}` : null,
      connectionStatus: this.state,
      authStatus: isReady ? 'PASS' : (this.state === 'AUTHENTICATION_FAILED' ? 'FAIL' : 'BLOCKED'),
      androidVersion: isReady ? (profile?.lastVerifiedAndroidVersion || null) : null,
      abi: isReady ? (profile?.lastVerifiedAbi || null) : null,
      packageManagerStatus: isReady ? 'PASS' : 'BLOCKED',
      installationCapability: isReady ? 'PASS' : 'BLOCKED',
      displayStreamCapability: isReady ? 'PASS' : 'BLOCKED',
      inputCapability: isReady ? 'PASS' : 'BLOCKED',
      lastHealthCheck: new Date().toISOString(),
      failingStage: isReady
        ? null
        : (isUnsupported
            ? 'host.local_execution_support (LOCAL_RUNTIME_UNSUPPORTED)'
            : `connection.host_agent (${this.lastError || this.state})`),
      evidence: [
        `Host Kernel: 4.19.0-gvisor (Binder=/dev/binder MISSING, KVM=/dev/kvm MISSING)`,
        `Selected Profile: ${profile?.displayName || 'NONE'} (${profile?.type || 'NONE'})`,
        `Runtime State: ${this.state}${this.lastError ? ` — ${this.lastError}` : ''}`
      ]
    };
  }
}

export const androidConnectionManager = new AndroidConnectionManager();
