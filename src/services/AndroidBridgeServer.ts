import http from 'http';
import crypto from 'crypto';

export interface BridgeServerOptions {
  port: number;
  authToken: string;
  simulatedVersion?: string;
  simulatedArch?: string;
  runtimeReady?: boolean;
  packageManagerReady?: boolean;
  failTransfer?: boolean;
  corruptTransferHash?: boolean;
  failInstall?: boolean;
  skipPackageRegistration?: boolean;
  failLaunch?: boolean;
  failProcessStart?: boolean;
  failDisplayStream?: boolean;
  failInput?: boolean;
}

export class AndroidBridgeServer {
  private server: http.Server | null = null;
  private installedPackages: Set<string> = new Set(['com.android.shell', 'com.android.settings', 'com.android.vending']);
  private runningApps: Map<string, { pid: number; startedAt: string }> = new Map();
  private logs: string[] = [
    '[init] Android userspace bridge initialized',
    '[boot] Package manager service ready',
    '[surface] Multi-window compositor active'
  ];
  private nextPid = 10420;

  constructor(private options: BridgeServerOptions) {}

  public setOptions(patch: Partial<BridgeServerOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.options.port, '127.0.0.1', () => {
        const addr = this.server?.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : this.options.port;
        this.options.port = boundPort;
        resolve(boundPort);
      });

      this.server.on('error', (err) => reject(err));
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method?.toUpperCase() || 'GET';

    if (this.options.authToken) {
      const authHeader = req.headers['authorization'];
      const expected = `Bearer ${this.options.authToken}`;
      if (authHeader !== expected) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing Bearer token' }));
        return;
      }
    }

    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      let parsedBody: any = {};
      try {
        if (bodyData) parsedBody = JSON.parse(bodyData);
      } catch {}

      this.route(method, url.pathname, parsedBody, res);
    });
  }

  private async route(method: string, pathname: string, body: any, res: http.ServerResponse): Promise<void> {
    const json = (statusCode: number, data: any) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const isReady = this.options.runtimeReady !== false;
    const pmReady = this.options.packageManagerReady !== false && isReady;

    if (method === 'GET' && pathname === '/api/android/remote/status') {
      return json(200, {
        ready: isReady,
        state: isReady ? (pmReady ? 'ANDROID_READY' : 'ANDROID_NOT_READY') : 'HOST_RUNTIME_UNAVAILABLE',
        reason: isReady ? undefined : 'Host Android runtime is stopped or unsupported on target machine',
        androidVersion: isReady ? (this.options.simulatedVersion || '13.0') : null,
        architecture: isReady ? (this.options.simulatedArch || 'x86_64') : null,
        deviceModel: 'Real Android Host',
        uptimeSeconds: process.uptime(),
        packagesCount: this.installedPackages.size,
        packageManagerReady: pmReady
      });
    }

    if (method === 'GET' && pathname === '/api/android/remote/version') {
      if (!isReady) {
        return json(503, { error: 'Runtime not ready' });
      }
      return json(200, {
        androidVersion: this.options.simulatedVersion || '13.0',
        buildId: 'TP1A.220624.014',
        release: this.options.simulatedVersion || '13.0'
      });
    }

    if (method === 'GET' && pathname === '/api/android/remote/arch') {
      if (!isReady) {
        return json(503, { error: 'Runtime not ready' });
      }
      return json(200, {
        architecture: this.options.simulatedArch || 'x86_64',
        abi: this.options.simulatedArch || 'x86_64'
      });
    }

    if (method === 'GET' && pathname === '/api/android/remote/packages') {
      if (!pmReady) {
        return json(503, { error: 'Package manager unavailable', packageManagerReady: false });
      }
      return json(200, {
        packageManagerReady: true,
        packages: Array.from(this.installedPackages)
      });
    }

    if (method === 'POST' && pathname === '/api/android/remote/transfer') {
      if (this.options.failTransfer) {
        return json(500, { success: false, error: 'TRANSFER_INTERRUPTED: Stream aborted during artifact upload' });
      }
      const { filename, sha256, dataBase64 } = body;
      if (!dataBase64) {
        return json(400, { success: false, error: 'Missing dataBase64 payload' });
      }
      const buf = Buffer.from(dataBase64, 'base64');
      let calcHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (this.options.corruptTransferHash) {
        calcHash = '0000000000000000000000000000000000000000000000000000000000000000';
      }
      this.logs.push(`[transfer] Received ${filename} (${buf.length} bytes, hash=${calcHash})`);
      return json(200, {
        success: true,
        filename,
        sha256: calcHash,
        verified: calcHash === sha256,
        sizeBytes: buf.length
      });
    }

    if (method === 'POST' && pathname === '/api/android/remote/packages/install') {
      if (this.options.failInstall) {
        return json(200, {
          success: false,
          errorCode: 'INSTALL_FAILED',
          message: 'INSTALL_FAILED: Package manager rejected installation [INSTALL_FAILED_INTERNAL_ERROR]'
        });
      }
      const { filename, sha256, dataBase64 } = body;
      if (!dataBase64) {
        return json(400, { success: false, error: 'Missing dataBase64' });
      }
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        return json(200, {
          success: false,
          errorCode: 'APK_INVALID',
          message: 'APK_INVALID: Invalid APK archive header'
        });
      }
      const calcHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha256 && calcHash !== sha256) {
        return json(200, {
          success: false,
          errorCode: 'INSTALL_FAILED',
          message: `HASH_MISMATCH: Expected ${sha256}, got ${calcHash}`
        });
      }

      let pkgName = 'com.example.testapk';
      if (filename && filename.toLowerCase().includes('cinema')) {
        pkgName = 'com.user.cinema';
      }

      if (!this.options.skipPackageRegistration) {
        this.installedPackages.add(pkgName);
      }
      this.logs.push(`[pm] Installed package ${pkgName} (sha256=${calcHash})`);
      return json(200, {
        success: true,
        packageName: pkgName,
        message: `Package ${pkgName} successfully installed into Android userspace`
      });
    }

    const verifyMatch = pathname.match(/^\/api\/android\/remote\/packages\/verify\/(.+)$/);
    if (method === 'GET' && verifyMatch) {
      const pkg = decodeURIComponent(verifyMatch[1]);
      const isInstalled = this.installedPackages.has(pkg);
      return json(200, {
        verified: isInstalled,
        installed: isInstalled,
        packageName: pkg,
        path: isInstalled ? `/data/app/${pkg}-1/base.apk` : null
      });
    }

    if (method === 'POST' && pathname === '/api/android/remote/packages/launch') {
      const { packageName } = body;
      if (this.options.failLaunch) {
        return json(200, {
          success: false,
          message: `APP_LAUNCH_FAILED: ActivityManager failed to start ${packageName}`
        });
      }
      if (!packageName || !this.installedPackages.has(packageName)) {
        return json(404, { success: false, message: `Package ${packageName} not installed` });
      }
      const pid = this.nextPid++;
      if (!this.options.failProcessStart) {
        this.runningApps.set(packageName, { pid, startedAt: new Date().toISOString() });
      }
      this.logs.push(`[am] START u0 {act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=${packageName}/.MainActivity} PID=${pid}`);
      return json(200, {
        success: true,
        packageName,
        pid: this.options.failProcessStart ? undefined : pid,
        message: `Launched ${packageName}/.MainActivity`
      });
    }

    if (method === 'POST' && pathname === '/api/android/remote/packages/stop') {
      const { packageName } = body;
      this.runningApps.delete(packageName);
      this.logs.push(`[am] Force-stopped package ${packageName}`);
      return json(200, { success: true, message: `Stopped ${packageName}` });
    }

    if (method === 'POST' && pathname === '/api/android/remote/packages/uninstall') {
      const { packageName } = body;
      this.installedPackages.delete(packageName);
      this.runningApps.delete(packageName);
      this.logs.push(`[pm] Uninstalled package ${packageName}`);
      return json(200, { success: true, message: `Uninstalled ${packageName}` });
    }

    const procMatch = pathname.match(/^\/api\/android\/remote\/process\/(.+)$/);
    if (method === 'GET' && procMatch) {
      const pkg = decodeURIComponent(procMatch[1]);
      const app = this.runningApps.get(pkg);
      return json(200, {
        packageName: pkg,
        running: !!app,
        pid: app?.pid || null
      });
    }

    if (method === 'GET' && pathname === '/api/android/remote/logs') {
      return json(200, { logs: this.logs.slice(-50) });
    }

    if (method === 'GET' && (pathname === '/api/android/remote/frame' || pathname === '/api/android/display/frame')) {
      if (this.options.failDisplayStream) {
        return json(503, { error: 'DISPLAY_STREAM_UNAVAILABLE: SurfaceFlinger frame capture unavailable' });
      }
      return json(200, {
        format: 'png',
        width: 360,
        height: 640,
        dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      });
    }

    if (method === 'POST' && pathname === '/api/android/remote/input') {
      if (this.options.failInput) {
        return json(500, { success: false, error: 'INPUT_FORWARDING_FAILED: InputDispatcher rejected event' });
      }
      this.logs.push(`[input] Dispatched event: ${JSON.stringify(body)}`);
      return json(200, { success: true });
    }

    json(404, { error: `Not found: ${method} ${pathname}` });
  }
}
