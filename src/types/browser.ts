export interface ChromeExtensionManifest {
  manifest_version: 2 | 3;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  action?: {
    default_popup?: string;
    default_title?: string;
    default_icon?: string | Record<string, string>;
  };
  browser_action?: {
    default_popup?: string;
    default_title?: string;
    default_icon?: string | Record<string, string>;
  };
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
  content_scripts?: Array<{
    matches: string[];
    js?: string[];
    css?: string[];
    run_at?: 'document_start' | 'document_end' | 'document_idle';
  }>;
  options_page?: string;
  options_ui?: {
    page: string;
    open_in_tab?: boolean;
  };
  declarative_net_request?: {
    rule_resources?: Array<{
      id: string;
      enabled: boolean;
      path: string;
    }>;
  };
}

export interface ArclightExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  dirPath: string;
  manifest: ChromeExtensionManifest;
  icons: Record<string, string>;
  hasPopup: boolean;
  popupHtml?: string;
  permissions: string[];
  serviceWorkerActive: boolean;
  runtimeType: 'MANIFEST_V3' | 'MANIFEST_V2';
  source: 'BUILT_IN' | 'UNPACKED' | 'ARCHIVE';
  extensionIdHex?: string;
  installDate: string;
}

export interface ChromiumTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  viewport: { width: number; height: number };
  webSocketDebuggerUrl?: string;
  lastFrameTimestamp?: number;
}

export interface ChromiumEngineStatus {
  installed: boolean;
  executablePath: string;
  version: string;
  running: boolean;
  pid: number | null;
  cdpPort: number;
  cdpUrl: string;
  profileDir: string;
  extensionsCount: number;
  activeExtensionsCount: number;
  tabsCount: number;
  memoryUsageMb: number;
  commandLineFlags: string[];
  architecture: string;
  engineVerdict: 'REAL_CHROMIUM_ACTIVE' | 'ENGINE_STOPPED' | 'ENGINE_MISSING';
}

export type BrowserVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface BrowserDoctorCheck {
  item?: string;
  domain?: string;
  status?: 'PASS' | 'WARN' | 'FAIL' | 'UNSUPPORTED';
  verdict?: BrowserVerdict;
  evidence: string;
  latencyMs?: number;
  remediation?: string;
}

export interface BrowserDoctorReport {
  timestamp: string;
  overallStatus?: 'CHROMIUM_READY' | 'DEGRADED' | 'OFFLINE';
  overallVerdict?: BrowserVerdict;
  chromiumVersion?: string;
  pid?: number | null;
  cdpPort?: number;
  profileDir?: string;
  activeExtensions?: ArclightExtension[];
  checks: BrowserDoctorCheck[];
  summary?: string;
  runtime?: BrowserRuntimeStatus;
}

export interface BrowserInputEvent {
  type: 'mouse' | 'keyboard' | 'wheel';
  action: 'click' | 'mousedown' | 'mouseup' | 'mousemove' | 'wheel' | 'keydown' | 'keyup' | 'char';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

// Extended types for BrowserEndgameEngine compatibility
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading?: boolean;
  status?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  viewport?: { width: number; height: number };
  webSocketDebuggerUrl?: string;
  lastFrameTimestamp?: number;
  securityState?: string;
  tlsDetails?: any;
  lastError?: string | null;
  backStack: string[];
  forwardStack: string[];
  activeExtensionIds?: string[];
  lastUpdated?: string;
  executedContentScripts?: Array<{
    extensionId: string;
    extensionName: string;
    scriptPath: string;
    executedAt: string;
    domMutationVerified: boolean;
  }>;
}

export interface BrowserExtension {
  id: string;
  name: string;
  version: string;
  manifestVersion?: number;
  description?: string;
  enabled: boolean;
  installSource?: string;
  installPath: string;
  installedAt?: string;
  requestedPermissions?: string[];
  hostPermissions?: string[];
  grantedPermissions?: string[];
  contentScripts?: Array<{ matches?: string[]; js?: string[]; css?: string[] }>;
  popupHtml?: string;
  optionsHtml?: string;
  unsupportedApis?: string[];
  errorStatus?: string | null;
  storage?: any;
}

export interface BrowserDownloadItem {
  id: string;
  url: string;
  filename: string;
  path?: string;
  savePath?: string;
  bytesReceived?: number;
  receivedBytes?: number;
  totalBytes: number;
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  state?: string;
  error?: string | null;
  mimeType?: string;
  completedAt?: string;
  sha256?: string;
  startedAt: string;
}

export interface BrowserBookmark {
  id: string;
  title: string;
  url: string;
  category?: string;
  createdAt?: string;
  icon?: string;
}

export interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  securityState?: string;
}

export interface BrowserProfileState {
  profilePath: string;
  chromiumUserDataDir: string;
  createdAt: string;
  lastActiveAt: string;
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
  downloads: BrowserDownloadItem[];
  extensions: BrowserExtension[];
  preferences: Record<string, any>;
  savedSessionTabs: Array<{ title: string; url: string }>;
}

export interface BrowserRuntimeStatus {
  engine: string;
  executablePath?: string | null;
  browserVersion?: string | null;
  userAgent?: string;
  v8Version?: string;
  cdpEndpoint?: string;
  cdpWebSocketUrl?: string;
  processState?: string;
  pid?: number | null;
  uptimeMs?: number;
  profileDir?: string;
  downloadsDir?: string;
  extensionsLoadedCount?: number;
  displayMode?: string;
  windowIntegrationNote?: string;
  hostLimitations?: string[];
}

export type BrowserProcessState = 'INITIALIZING' | 'STARTING' | 'RUNNING' | 'STOPPED' | 'CRASHED' | 'UNAVAILABLE';

export interface ExtensionAcceptanceStepResult {
  step: number;
  name?: string;
  description?: string;
  passed?: boolean;
  status?: 'PASS' | 'FAIL';
  durationMs: number;
  evidence: string;
  error?: string;
}

export interface ExtensionAcceptanceReport {
  timestamp: string;
  extensionId: string;
  extensionName: string;
  steps: ExtensionAcceptanceStepResult[];
  allPassed?: boolean;
  overallStatus?: 'PASS' | 'FAIL';
  verdict?: BrowserVerdict;
  totalDurationMs?: number;
  cwsCompatibilityProbe?: any;
}

export interface BrowserStabilityTestResult {
  name?: string;
  scenario?: string;
  passed?: boolean;
  status?: 'PASS' | 'FAIL';
  iterations?: number;
  failures?: number;
  durationMs?: number;
  details?: string;
  evidence?: string;
}
