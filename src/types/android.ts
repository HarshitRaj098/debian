export type AndroidAppLifecycleState =
  | 'INSTALLED'
  | 'STARTING'
  | 'RUNNING'
  | 'FOCUSED'
  | 'BACKGROUND'
  | 'PAUSED'
  | 'STOPPING'
  | 'STOPPED'
  | 'CRASHED'
  | 'UNINSTALLED';

export interface AndroidApp {
  packageName: string;
  applicationName: string;
  versionName: string;
  versionCode: number;
  icon?: string;
  installSource: 'user_apk' | 'system';
  installTime: string;
  permissions: AndroidPermissionItem[];
  runtimeState: AndroidAppLifecycleState;
  launchable: boolean;
  launchableActivity?: string;
  supportedAbis?: string[];
  minSdkVersion?: number;
  targetSdkVersion?: number;
  processState?: any;
}

export type AndroidPermissionState = 
  | 'DECLARED'
  | 'REQUESTED'
  | 'GRANTED' 
  | 'DENIED' 
  | 'POLICY_BLOCKED'
  | 'HOST_UNAVAILABLE'
  | 'NOT_REQUESTED' 
  | 'NOT_APPLICABLE' 
  | 'RESTRICTED' 
  | 'SYSTEM_CONTROLLED' 
  | 'UNSUPPORTED';

export interface AndroidPermissionItem {
  permission: string; // e.g. 'android.permission.ACCESS_FINE_LOCATION'
  displayName: string;
  state: AndroidPermissionState;
  isToggleable: boolean;
  category: string;
  description: string;
}

export type AndroidRuntimeState = 
  | 'LOCAL_UNSUPPORTED'
  | 'LOCAL_RUNTIME_UNSUPPORTED'
  | 'LOCAL_RUNTIME_MISSING'
  | 'REMOTE_HOST_NOT_CONFIGURED'
  | 'REMOTE_HOST_DISCONNECTED'
  | 'REMOTE_DISCONNECTED'
  | 'AUTHENTICATION_FAILED'
  | 'HOST_RUNTIME_UNAVAILABLE'
  | 'ANDROID_NOT_READY'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ANDROID_READY'
  | 'DEGRADED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'HOST_UNSUPPORTED'
  | 'RUNTIME_NOT_INSTALLED'
  | 'RUNTIME_NOT_INITIALIZED'
  | 'RUNTIME_STOPPED'
  | 'RUNTIME_STARTING'
  | 'CONTAINER_STARTING'
  | 'CONTAINER_READY'
  | 'SESSION_STARTING'
  | 'SESSION_READY'
  | 'DEVICE_CONNECTED'
  | 'BROKEN'
  | 'CHECKING'
  | 'READY'
  | 'INSTALLED_NOT_READY'
  | 'NOT_INSTALLED'
  | 'RUNTIME_READY'
  | 'RUNTIME_DEGRADED'
  | 'RUNTIME_UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'RUNTIME_ENVIRONMENT_MISMATCH';

export type EvidenceClassification =
  | 'FACT'
  | 'ASSUMPTION'
  | 'UNKNOWN'
  | 'STALE'
  | 'CONTRADICTED'
  | 'VERIFIED'
  | 'FAILED'
  | 'PARTIALLY_VERIFIED';

export interface EvidenceLedgerEntry {
  key: string;
  claim: string;
  classification: EvidenceClassification;
  source: string;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timestamp: string;
}

export type AndroidIpcEventType =
  | 'ANDROID_RUNTIME_DETECTED'
  | 'ANDROID_RUNTIME_READY'
  | 'ANDROID_RUNTIME_FAILED'
  | 'APK_INSTALL_STARTED'
  | 'APK_INSTALL_FINISHED'
  | 'APK_INSTALL_FAILED'
  | 'ANDROID_APP_STARTED'
  | 'ANDROID_APP_STOPPED'
  | 'ANDROID_APP_CRASHED'
  | 'ANDROID_APP_UNINSTALLED'
  | 'ANDROID_SURFACE_READY'
  | 'ANDROID_SURFACE_LOST';

export interface AndroidIpcEvent {
  id: string;
  type: AndroidIpcEventType;
  timestamp: string;
  payload: Record<string, any>;
}

export interface AndroidRuntimeStatus {
  status: 'AVAILABLE' | 'MISSING' | 'BROKEN' | 'CHECKING' | 'UNSUPPORTED';
  runtime: AndroidRuntimeState;
  authoritativeState?: AndroidRuntimeState;
  execution: 'REAL' | 'UNSUPPORTED' | 'SIMULATED';
  runtimeType: string; // 'Waydroid' | 'ADB' | 'Emulator' | 'None'
  installed: boolean;
  executable: string | null;
  version: string | null;
  androidVersion?: string | null;
  container: 'RUNNING' | 'STOPPED' | 'UNINITIALIZED' | 'UNAVAILABLE' | 'UNKNOWN';
  session: 'RUNNING' | 'STOPPED' | 'UNAVAILABLE' | 'UNKNOWN';
  ready: boolean;
  reason: string;
  hostOs: string;
  kernel: string;
  architecture: string;
  backendUser: string;
  backendPath: string;
  lastDetected: string;
  lastError: string | null;
  capabilities: {
    isLinux: boolean;
    isGvisor: boolean;
    hasBinder: boolean;
    hasWayland: boolean;
    hasSystemd: boolean;
  };
  uptime?: string;
  supportedAbis: string[];
  evidenceLedger?: EvidenceLedgerEntry[];
}

export type InstallStage = 'VALIDATION' | 'RUNTIME_CHECK' | 'INSTALL' | 'VERIFY' | 'LAUNCH' | 'SURFACE';

export type InstallErrorCode =
  | 'RUNTIME_MISSING'
  | 'HOST_UNSUPPORTED'
  | 'RUNTIME_NOT_INITIALIZED'
  | 'CONTAINER_FAILED'
  | 'SESSION_FAILED'
  | 'ADB_TARGET_MISSING'
  | 'APK_INVALID'
  | 'APK_INCOMPATIBLE'
  | 'PERMISSION_DENIED'
  | 'STORAGE_INSUFFICIENT'
  | 'PACKAGE_MANAGER_FAILED'
  | 'INSTALL_FAILED'
  | 'INSTALL_NOT_VERIFIED'
  | 'LAUNCH_FAILED'
  | 'PROCESS_NOT_FOUND'
  | 'ACTIVITY_NOT_FOUND'
  | 'SURFACE_FAILED'
  | 'RESOURCE_UNAVAILABLE'
  | 'UNKNOWN'
  | 'ANDROID_RUNTIME_UNAVAILABLE'
  | 'APK_NOT_FOUND'
  | 'APK_NOT_READABLE'
  | 'INVALID_APK'
  | 'PARSE_ERROR'
  | 'INCOMPATIBLE_ABI'
  | 'VERSION_CONFLICT'
  | 'VERSION_DOWNGRADE'
  | 'SIGNATURE_MISMATCH'
  | 'INSUFFICIENT_STORAGE'
  | 'PACKAGE_CONFLICT'
  | 'INSTALL_TIMEOUT'
  | 'VERIFY_FAILED'
  | 'RUNTIME_ERROR'
  | 'UNKNOWN_INSTALL_ERROR';

export interface InstallResult {
  success: boolean;
  stage: InstallStage;
  packageName?: string;
  applicationName?: string;
  version?: string;
  filePath?: string;
  sizeBytes?: number;
  sizeFormatted?: string;
  waydroidAvailable?: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  runtimeError?: string;
  errorCode?: InstallErrorCode;
  runtimeState?: AndroidRuntimeState;
  recoveryAction?: string;
  verification?: 'PASS' | 'FAIL';
  policy?: 'ALLOWED' | 'DENIED' | 'NOT_APPLICABLE';
  rootCause?: string;
  message: string;
}

export type AndroidResourceCategory =
  | 'NETWORK'
  | 'WIFI'
  | 'BLUETOOTH'
  | 'LOCATION'
  | 'CAMERA'
  | 'MICROPHONE'
  | 'STORAGE'
  | 'NOTIFICATIONS'
  | 'CLIPBOARD'
  | 'AUDIO'
  | 'DISPLAY'
  | 'SENSORS'
  | 'BATTERY'
  | 'VIBRATION';

export type AuthoritativeResourceStatus =
  | 'DECLARED'
  | 'REQUESTED'
  | 'GRANTED'
  | 'DENIED'
  | 'POLICY_BLOCKED'
  | 'HARDWARE_UNAVAILABLE'
  | 'RUNTIME_UNAVAILABLE'
  | 'UNKNOWN';

export type ResourceErrorClassification =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'HARDWARE_UNAVAILABLE'
  | 'RESOURCE_UNSUPPORTED'
  | 'RESOURCE_DISABLED'
  | 'RUNTIME_DISCONNECTED'
  | 'ANDROID_SERVICE_UNAVAILABLE'
  | 'NETWORK_UNAVAILABLE'
  | 'PATH_ACCESS_DENIED'
  | 'SUCCESS';

export interface AndroidResourceItemState {
  category: AndroidResourceCategory;
  declared: boolean;
  requested: boolean;
  granted: boolean;
  hardwareAvailable: boolean;
  status: AuthoritativeResourceStatus;
  details?: string;
}

export interface AndroidHardwareCapabilityItem {
  name: string;
  category: AndroidResourceCategory;
  supported: boolean;
  available: boolean;
  permissionRequired: boolean;
  permissionGranted: boolean;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PERMISSION_BLOCKED' | 'UNKNOWN';
  rawDevice?: string;
  details?: string;
}

export interface AndroidHardwareCapabilities {
  camera: AndroidHardwareCapabilityItem;
  microphone: AndroidHardwareCapabilityItem;
  location: AndroidHardwareCapabilityItem;
  bluetooth: AndroidHardwareCapabilityItem;
  wifi: AndroidHardwareCapabilityItem;
  network: AndroidHardwareCapabilityItem;
  sensors: AndroidHardwareCapabilityItem;
  audio: AndroidHardwareCapabilityItem;
  notifications: AndroidHardwareCapabilityItem;
  storage: AndroidHardwareCapabilityItem;
  battery: AndroidHardwareCapabilityItem;
  vibration: AndroidHardwareCapabilityItem;
  clipboard: AndroidHardwareCapabilityItem;
}

export interface AndroidNotificationItem {
  id: string;
  packageName: string;
  title: string;
  body: string;
  channel?: string;
  timestamp: string;
  actions?: string[];
}

export interface AndroidFileBridgeResult {
  success: boolean;
  sourcePath: string;
  destinationPath: string;
  sourceHash: string;
  destinationHash?: string;
  sizeBytes: number;
  readable: boolean;
  error?: string;
}

export interface RemoteRuntimeConfig {
  mode: 'REST_TLS' | 'ADB_TCP' | 'COMPANION';
  host: string;
  port: number;
  token?: string;
  tlsEnabled?: boolean;
  adbTarget?: string;
  endpointUrl?: string;
  connectedAt?: string;
}

export interface RemoteRuntimeStatus {
  state: AndroidRuntimeState;
  connected: boolean;
  configured?: boolean;
  mode: 'REST_TLS' | 'ADB_TCP' | 'COMPANION' | 'NONE';
  endpoint: string;
  androidVersion: string | null;
  architecture: string | null;
  deviceModel?: string | null;
  packageManagerReady: boolean;
  lastError: string | null;
  lastChecked: string;
  latencyMs?: number;
  packagesCount?: number;
  activeApp?: string | null;
  localSupport: {
    supported: boolean;
    reason: string;
    kernel: string;
    hasBinder: boolean;
    hasKvm: boolean;
    isGvisor: boolean;
  };
}

export interface TestApkStepResult {
  step: number;
  name: string;
  passed: boolean;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNSUPPORTED';
  details: string;
  durationMs: number;
  error?: string;
}

export interface TestApkAcceptanceReport {
  timestamp: string;
  apkPath: string;
  sha256: string;
  fileSize: number;
  packageName: string;
  steps: TestApkStepResult[];
  allPassed: boolean;
  verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNSUPPORTED';
  reason: string;
  rawEvidence: string;
}

export interface RemoteAndroidDisplayFrame {
  timestamp: number;
  format: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
  dataBase64: string;
  latencyMs: number;
}

export type AndroidDoctorDiagnosticState =
  | 'LOCAL_RUNTIME_READY'
  | 'REMOTE_RUNTIME_READY'
  | 'DEVICE_CONNECTED'
  | 'RUNTIME_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'INSTALL_FAILED'
  | 'DISPLAY_STREAM_FAILED'
  | 'UNKNOWN';

export type DisplayStreamState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'STREAMING'
  | 'STALLED'
  | 'RECONNECTING'
  | 'FAILED';

export interface DisplayStreamMetrics {
  fps: number;
  targetFps: number;
  latencyMs: number;
  framesDelivered: number;
  framesDropped: number;
  resolution: { width: number; height: number };
  bandwidthKbps?: number;
  lastFrameTime?: number;
}

export interface RemoteAndroidInputEvent {
  type: 'tap' | 'swipe' | 'key' | 'text' | 'back' | 'home' | 'recents' | 'power' | 'volume_up' | 'volume_down';
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  durationMs?: number;
  keyCode?: number;
  key?: string;
  text?: string;
  pressure?: number;
}

export interface AndroidBridgeAuthoritativeStatus {
  state: AndroidRuntimeState;
  doctorState: AndroidDoctorDiagnosticState;
  connected: boolean;
  activeAdapter: 'REMOTE' | 'ADB' | 'WAYDROID' | 'NONE';
  androidVersion: string | null;
  architecture: string | null;
  deviceModel: string | null;
  packageManagerReady: boolean;
  installedPackagesCount: number;
  displayStreamState: DisplayStreamState;
  streamMetrics: DisplayStreamMetrics;
  lastError: string | null;
  lastVerifiedAt: string;
  localSupport: RemoteRuntimeStatus['localSupport'];
  executionLocation: 'REMOTE_DEVICE' | 'REMOTE_HOST' | 'UNSUPPORTED_GVISOR';
}

export type VerificationStepStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNSUPPORTED' | 'UNKNOWN';

export type VerificationBlockerCode =
  | 'NONE'
  | 'LOCAL_RUNTIME_UNSUPPORTED'
  | 'REMOTE_HOST_NOT_CONFIGURED'
  | 'REMOTE_HOST_DISCONNECTED'
  | 'AUTHENTICATION_FAILED'
  | 'HOST_RUNTIME_UNAVAILABLE'
  | 'ANDROID_NOT_READY'
  | 'APK_INVALID'
  | 'TRANSFER_INTERRUPTED'
  | 'HASH_MISMATCH'
  | 'INSTALL_FAILED'
  | 'PACKAGE_VERIFICATION_FAILED'
  | 'APP_LAUNCH_FAILED'
  | 'DISPLAY_STREAM_UNAVAILABLE'
  | 'INPUT_FORWARDING_FAILED';

export interface VerificationStageCheck {
  id: string;
  category: 'HOST' | 'CONNECTION' | 'INSTALLATION' | 'LAUNCH';
  name: string;
  status: VerificationStepStatus;
  code: VerificationBlockerCode;
  evidence: string;
  durationMs: number;
}

export interface AndroidEndToEndVerificationReport {
  timestamp: string;
  command: string;
  overallStatus: VerificationStepStatus;
  exitCode: 0 | 1 | 2;
  firstFailingStage: string | null;
  firstBlockerCode: VerificationBlockerCode;
  rootCause: string;
  evidence: string;
  remainingExternalRequirement: string | null;
  hostChecks: {
    executionEnvironment: VerificationStageCheck;
    localExecutionSupport: VerificationStageCheck;
    localExecutablesAndDevices: VerificationStageCheck;
  };
  connectionChecks: {
    runtimeProfile: VerificationStageCheck;
    hostAgentConnection: VerificationStageCheck;
    authenticationAndIdentity: VerificationStageCheck;
    androidVersionAndAbi: VerificationStageCheck;
    userspaceAndPackageManager: VerificationStageCheck;
  };
  installationChecks: {
    apkIntegrityAndMetadata: VerificationStageCheck;
    secureTransferAndHash: VerificationStageCheck;
    packageManagerInstall: VerificationStageCheck;
    independentPackageQuery: VerificationStageCheck;
  };
  launchChecks: {
    appLaunch: VerificationStageCheck;
    processAndActivityState: VerificationStageCheck;
    displayStream: VerificationStageCheck;
    inputForwarding: VerificationStageCheck;
  };
  summary: {
    runtimeConnectionStatus: VerificationStepStatus;
    apkInstallationStatus: VerificationStepStatus;
    applicationLaunchStatus: VerificationStepStatus;
    displayStatus: VerificationStepStatus;
    inputStatus: VerificationStepStatus;
    reconciledRegistryCount: number;
  };
}

// ============================================================
// ARCLIGHT SPEEDMAX 02: QUICK-INSTALL TYPES
// ============================================================

export type QuickInstallStageName =
  | 'APK_VALIDATED'
  | 'TARGET_FOUND'
  | 'ANDROID_READY'
  | 'INSTALL_VERIFIED'
  | 'APP_LAUNCH_REQUESTED'
  | 'APP_RUNNING'
  | 'DISPLAY_AVAILABLE';

export type QuickInstallStageResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';

export type QuickInstallBlockerCode =
  | 'NONE'
  | 'APK_NOT_FOUND'
  | 'APK_INVALID'
  | 'NO_ANDROID_TARGET'
  | 'MULTIPLE_ANDROID_TARGETS'
  | 'LOCAL_RUNTIME_UNSUPPORTED'
  | 'REMOTE_HOST_DISCONNECTED'
  | 'AUTHENTICATION_FAILED'
  | 'HOST_RUNTIME_UNAVAILABLE'
  | 'ANDROID_NOT_READY'
  | 'INSTALL_FAILED'
  | 'PACKAGE_VERIFICATION_FAILED'
  | 'APP_LAUNCH_FAILED'
  | 'DISPLAY_STREAM_UNAVAILABLE';

export interface QuickInstallStageDetail {
  status: QuickInstallStageResult;
  code: QuickInstallBlockerCode;
  evidence: string;
  durationMs: number;
}

export interface QuickInstallPackageInfo {
  packageName: string;
  applicationName: string;
  versionName: string;
  versionCode: number;
  launchableActivity?: string;
  sha256: string;
  sizeBytes: number;
  supportedAbis: string[];
}

export interface QuickInstallTargetInfo {
  targetId: string;
  mode: 'ADB_TCP' | 'REST_TLS' | 'LOCAL';
  androidVersion?: string;
  architecture?: string;
  deviceModel?: string;
}

export interface QuickInstallReport {
  timestamp: string;
  command: string;
  apkPath: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED';
  exitCode: 0 | 1 | 2;
  blockerCode: QuickInstallBlockerCode;
  failingStage: QuickInstallStageName | null;
  rootCause: string;
  recoveryAction: string | null;
  stages: Record<QuickInstallStageName, QuickInstallStageDetail>;
  packageInfo?: QuickInstallPackageInfo;
  targetInfo?: QuickInstallTargetInfo;
  reconciledRegistryCount?: number;
}
