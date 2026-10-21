import React, { useState, useEffect } from 'react';
import { androidConnectionManager, ConnectionState, RuntimeProfile, RuntimeDiagnostics } from '../../services/AndroidConnectionManager';

export const AndroidSetupWizard: React.FC = () => {
  const [step, setStep] = useState<number>(1);
  const [connectionState, setConnectionState] = useState<ConnectionState>(androidConnectionManager.getState());
  const [profiles, setProfiles] = useState<RuntimeProfile[]>(androidConnectionManager.getProfiles());
  const [activeProfile, setActiveProfile] = useState<RuntimeProfile | null>(androidConnectionManager.getActiveProfile());
  
  // Form inputs
  const [runtimeType, setRuntimeType] = useState<'LOCAL' | 'REMOTE_LINUX' | 'ADB_DEVICE'>('REMOTE_LINUX');
  const [displayName, setDisplayName] = useState('Remote Linux Host Agent');
  const [endpoint, setEndpoint] = useState('127.0.0.1');
  const [port, setPort] = useState<number>(8555);
  const [tlsVerify, setTlsVerify] = useState<boolean>(false);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; version?: string; abi?: string; error?: string } | null>(null);
  const [installTestResult, setInstallTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);

  useEffect(() => {
    const unsubscribe = androidConnectionManager.subscribe((state, profs) => {
      setConnectionState(state);
      setProfiles(profs);
      setActiveProfile(androidConnectionManager.getActiveProfile());
    });
    return () => unsubscribe();
  }, []);

  const handleCreateProfileAndPair = async () => {
    setPairingError(null);
    const id = androidConnectionManager.addProfile({
      displayName,
      type: runtimeType,
      endpoint,
      port,
      tlsVerify,
      timeoutMs: 5000
    });
    androidConnectionManager.setActiveProfile(id);

    if (runtimeType === 'LOCAL') {
      const res = await androidConnectionManager.connectLocal();
      setVerificationResult(res.success ? { success: true } : { success: false, error: res.reason });
      setStep(4);
    } else {
      await androidConnectionManager.initiatePairing(endpoint, port, tlsVerify);
      setStep(3);
    }
  };

  const handleVerifyPairingCode = async () => {
    setPairingError(null);
    const res = await androidConnectionManager.pairWithHost(pairingCodeInput);
    const vRes = await androidConnectionManager.verifyRuntime();
    setVerificationResult(vRes);
    if (res.success && vRes.success) {
      setStep(4);
    } else {
      setPairingError(res.error || vRes.error || 'Connection or pairing failed.');
      setStep(4);
    }
  };

  const handleRunInstallTest = async () => {
    const res = await androidConnectionManager.testInstallationCapability();
    setInstallTestResult(res);
  };

  const handleFinish = () => {
    setDiagnostics(androidConnectionManager.getDiagnostics());
    setStep(6);
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100 p-6 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-800">
          <div>
            <h1 className="text-2xl font-bold">Android Runtime Setup Wizard</h1>
            <p className="text-sm text-gray-400">Connect and verify a real external Android runtime, Linux host agent, or ADB device.</p>
          </div>
          <div className="px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-gray-800 border border-gray-700">
            State: <span className={connectionState === 'ANDROID_READY' ? 'text-green-400' : connectionState === 'UNSUPPORTED' || connectionState === 'DISCONNECTED' || connectionState === 'AUTHENTICATION_FAILED' ? 'text-red-400' : 'text-yellow-400'}>{connectionState}</span>
          </div>
        </div>

        {/* Wizard Steps indicator */}
        <div className="grid grid-cols-6 gap-2 mb-8 text-center text-xs">
          {['Source', 'Endpoint', 'Auth / Pair', 'Verify', 'E2E Test', 'Report'].map((label, idx) => (
            <div key={label} className={`py-2 rounded border ${step === idx + 1 ? 'bg-blue-600 border-blue-500 font-bold' : step > idx + 1 ? 'bg-gray-800 border-gray-700 text-blue-300' : 'bg-gray-900 border-gray-800 text-gray-500'}`}>
              {idx + 1}. {label}
            </div>
          ))}
        </div>

        {/* Step 1: Choose Runtime Source */}
        {step === 1 && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">1. Choose Android Runtime Source</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button 
                onClick={() => { setRuntimeType('LOCAL'); setDisplayName('Local Runtime (gVisor)'); }}
                className={`p-4 rounded-lg border text-left transition-all ${runtimeType === 'LOCAL' ? 'border-blue-500 bg-blue-950/40' : 'border-gray-800 bg-gray-950 hover:border-gray-700'}`}
              >
                <div className="font-semibold mb-1">Local Android Runtime</div>
                <div className="text-xs text-gray-400">Waydroid or local container (Unsupported in gVisor sandbox).</div>
              </button>

              <button 
                onClick={() => { setRuntimeType('REMOTE_LINUX'); setDisplayName('Remote Linux Host Agent'); setPort(8555); }}
                className={`p-4 rounded-lg border text-left transition-all ${runtimeType === 'REMOTE_LINUX' ? 'border-blue-500 bg-blue-950/40' : 'border-gray-800 bg-gray-950 hover:border-gray-700'}`}
              >
                <div className="font-semibold mb-1">Remote Linux Host</div>
                <div className="text-xs text-gray-400">Arclight Host Agent running on a Linux host with Waydroid / KVM.</div>
              </button>

              <button 
                onClick={() => { setRuntimeType('ADB_DEVICE'); setDisplayName('Connected ADB Device'); setPort(5555); }}
                className={`p-4 rounded-lg border text-left transition-all ${runtimeType === 'ADB_DEVICE' ? 'border-blue-500 bg-blue-950/40' : 'border-gray-800 bg-gray-950 hover:border-gray-700'}`}
              >
                <div className="font-semibold mb-1">Connected ADB Device</div>
                <div className="text-xs text-gray-400">Authorized Android phone or emulator over ADB TCP.</div>
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-end">
              <button 
                onClick={() => {
                  if (runtimeType === 'LOCAL') {
                    handleCreateProfileAndPair();
                  } else {
                    setStep(2);
                  }
                }}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
              >
                Next: Configure Connection &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Configure Connection */}
        {step === 2 && runtimeType !== 'LOCAL' && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">2. Configure Connection Endpoint</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Display Name</label>
                <input 
                  type="text" 
                  value={displayName} 
                  onChange={e => setDisplayName(e.target.value)} 
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-white focus:border-blue-500 outline-none" 
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Host Address / IP</label>
                  <input 
                    type="text" 
                    value={endpoint} 
                    onChange={e => setEndpoint(e.target.value)} 
                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-white focus:border-blue-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                  <input 
                    type="number" 
                    value={port} 
                    onChange={e => setPort(Number(e.target.value))} 
                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-white focus:border-blue-500 outline-none" 
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input 
                  type="checkbox" 
                  id="tlsVerify" 
                  checked={tlsVerify} 
                  onChange={e => setTlsVerify(e.target.checked)} 
                  className="rounded bg-gray-950 border-gray-800 text-blue-600 focus:ring-0"
                />
                <label htmlFor="tlsVerify" className="text-sm text-gray-300">Use HTTPS / TLS Verification</label>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-between">
              <button onClick={() => setStep(1)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm">&larr; Back</button>
              <button onClick={handleCreateProfileAndPair} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">Next: Authenticate & Connect &rarr;</button>
            </div>
          </div>
        )}

        {/* Step 3: Secure Pairing */}
        {step === 3 && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">3. Host Authentication & Pairing</h2>
            <p className="text-sm text-gray-400">
              Enter the Bearer Authentication Token or 6-digit Pairing PIN generated by <code>arclight-android-host-agent</code> on {endpoint}:{port}.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Host Bearer Token / Pairing PIN (Optional for ADB TCP)</label>
              <input 
                type="password" 
                value={pairingCodeInput}
                onChange={e => setPairingCodeInput(e.target.value)}
                placeholder="Enter host token or pairing code" 
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-3 text-center text-base font-mono text-white focus:border-blue-500 outline-none" 
              />
            </div>

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-between">
              <button onClick={() => setStep(2)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm">&larr; Back</button>
              <button onClick={handleVerifyPairingCode} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">Connect & Verify Runtime &rarr;</button>
            </div>
          </div>
        )}

        {/* Step 4: Verify Runtime */}
        {step === 4 && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">4. Runtime Capability & Version Verification</h2>
            
            {connectionState !== 'ANDROID_READY' || !verificationResult?.success ? (
              <div className="p-4 bg-red-950/50 border border-red-800 rounded-lg text-red-200 space-y-2">
                <div className="font-bold flex items-center space-x-2">
                  <span>{connectionState === 'UNSUPPORTED' ? 'LOCAL_RUNTIME_UNSUPPORTED' : connectionState}</span>
                </div>
                <p className="text-sm font-mono">
                  {pairingError || verificationResult?.error || 'Android runtime is not connected or did not pass independent version/ABI/package-manager verification.'}
                </p>
                <p className="text-xs text-red-300/80">
                  Start <code>arclight-android-host-agent</code> on a Linux host with Waydroid/ADB and ensure {endpoint}:{port} is reachable.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-4 bg-green-950/40 border border-green-800/60 rounded-lg text-green-200">
                  <div className="font-semibold mb-1">ANDROID_READY — Verified Real Runtime</div>
                  <div className="text-xs text-green-300">Connected to {endpoint}:{port}</div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-950 p-3 rounded border border-gray-800">
                    <div className="text-gray-500 text-xs">Android Version</div>
                    <div className="font-semibold text-white">{verificationResult.version}</div>
                  </div>
                  <div className="bg-gray-950 p-3 rounded border border-gray-800">
                    <div className="text-gray-500 text-xs">CPU Architecture / ABI</div>
                    <div className="font-semibold text-white">{verificationResult.abi}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-between">
              <button onClick={() => setStep(1)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm">&larr; Change Source</button>
              <button onClick={() => setStep(5)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">Proceed to E2E Verification &rarr;</button>
            </div>
          </div>
        )}

        {/* Step 5: Test Installation Capability */}
        {step === 5 && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">5. End-to-End Verification (android verify --full)</h2>
            <p className="text-sm text-gray-400">
              Runs independent Host, Connection, TestAPK.apk Installation, and Launch checks against the active runtime.
            </p>

            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Package Manager Daemon</span>
                <span className={`px-2 py-0.5 rounded text-xs font-mono ${connectionState === 'ANDROID_READY' ? 'bg-green-900 text-green-300' : 'bg-red-900/60 text-red-300'}`}>
                  {connectionState === 'ANDROID_READY' ? 'READY' : 'BLOCKED (DISCONNECTED)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">APK Transfer & Install Pipeline</span>
                <span className={`px-2 py-0.5 rounded text-xs font-mono ${connectionState === 'ANDROID_READY' ? 'bg-green-900 text-green-300' : 'bg-red-900/60 text-red-300'}`}>
                  {connectionState === 'ANDROID_READY' ? 'READY' : 'BLOCKED (NO_RUNTIME)'}
                </span>
              </div>
              {installTestResult && (
                <div className={`p-3 rounded text-xs font-mono ${installTestResult.success ? 'bg-green-950/60 text-green-200 border border-green-800' : 'bg-red-950/60 text-red-200 border border-red-800'}`}>
                  {installTestResult.message}
                </div>
              )}
            </div>

            <div className="flex space-x-3">
              <button onClick={handleRunInstallTest} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium">Run android verify --full</button>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-between">
              <button onClick={() => setStep(4)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm">&larr; Back</button>
              <button onClick={handleFinish} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded font-medium">View Diagnostic Summary &rarr;</button>
            </div>
          </div>
        )}

        {/* Step 6: Finish & Diagnostics */}
        {step === 6 && diagnostics && (
          <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-2">6. Runtime Diagnostics Report</h2>
            <p className="text-sm text-gray-400">Authoritative state reported by AndroidConnectionManager and AndroidRuntimeManager.</p>

            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 space-y-2 text-sm font-mono">
              <div className="flex justify-between border-b border-gray-900 pb-1">
                <span className="text-gray-400">Selected Runtime:</span>
                <span className="text-white">{diagnostics.selectedRuntime}</span>
              </div>
              <div className="flex justify-between border-b border-gray-900 pb-1">
                <span className="text-gray-400">Connection Status:</span>
                <span className={diagnostics.connectionStatus === 'ANDROID_READY' ? 'text-green-400' : 'text-red-400'}>{diagnostics.connectionStatus}</span>
              </div>
              <div className="flex justify-between border-b border-gray-900 pb-1">
                <span className="text-gray-400">Auth Status:</span>
                <span className={diagnostics.authStatus === 'PASS' ? 'text-green-400' : 'text-yellow-400'}>{diagnostics.authStatus}</span>
              </div>
              <div className="flex justify-between border-b border-gray-900 pb-1">
                <span className="text-gray-400">Android Version:</span>
                <span className="text-white">{diagnostics.androidVersion || 'UNREACHABLE'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-900 pb-1">
                <span className="text-gray-400">Package Manager:</span>
                <span className={diagnostics.packageManagerStatus === 'PASS' ? 'text-green-400' : 'text-yellow-400'}>{diagnostics.packageManagerStatus}</span>
              </div>
              {diagnostics.failingStage && (
                <div className="flex justify-between border-b border-gray-900 pb-1">
                  <span className="text-gray-400">First Blocker:</span>
                  <span className="text-red-400">{diagnostics.failingStage}</span>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-gray-800 flex justify-end">
              <button onClick={() => setStep(1)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">Configure Runtime</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
