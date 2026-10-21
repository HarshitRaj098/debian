import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ProcessExecutor } from '../../src/services/ProcessExecutor';

export const apiRouter = Router();

let activePairingCode: string | null = null;
let pairingCodeExpiresAt = 0;

async function inspectHostAndroidRuntime() {
  const kernel = os.release() || '';
  const isGvisor = kernel.toLowerCase().includes('gvisor');
  const hasBinder = fs.existsSync('/dev/binder') || fs.existsSync('/dev/anbox-binder') || fs.existsSync('/dev/binderfs');
  const hasKvm = fs.existsSync('/dev/kvm');
  const whichWaydroid = await ProcessExecutor.resolveExecutable('waydroid');
  const whichAdb = await ProcessExecutor.resolveExecutable('adb');

  let adbConnectedDevices: string[] = [];
  let androidVersion: string | null = null;
  let abi: string | null = null;
  let packageManagerReady = false;
  let packages: string[] = [];

  if (whichAdb) {
    const devRes = await ProcessExecutor.execute({ executable: whichAdb, args: ['devices'], timeoutMs: 3000 });
    if (devRes.exitCode === 0) {
      const lines = devRes.stdout.split('\n').map(l => l.trim()).filter(Boolean);
      adbConnectedDevices = lines.slice(1).filter(l => /\bdevice\b/.test(l) && !l.startsWith('*'));
    }

    if (adbConnectedDevices.length > 0) {
      const [verRes, abiRes, pmRes] = await Promise.all([
        ProcessExecutor.execute({ executable: whichAdb, args: ['shell', 'getprop', 'ro.build.version.release'], timeoutMs: 3000 }),
        ProcessExecutor.execute({ executable: whichAdb, args: ['shell', 'getprop', 'ro.product.cpu.abi'], timeoutMs: 3000 }),
        ProcessExecutor.execute({ executable: whichAdb, args: ['shell', 'pm', 'list', 'packages'], timeoutMs: 4000 })
      ]);
      if (verRes.exitCode === 0 && verRes.stdout.trim()) androidVersion = verRes.stdout.trim();
      if (abiRes.exitCode === 0 && abiRes.stdout.trim()) abi = abiRes.stdout.trim();
      if (pmRes.exitCode === 0 && pmRes.stdout.includes('package:')) {
        packageManagerReady = true;
        packages = pmRes.stdout.split('\n').map(l => l.replace(/^package:/i, '').trim()).filter(Boolean);
      }
    }
  }

  if (!packageManagerReady && whichWaydroid && !isGvisor && hasBinder) {
    const stRes = await ProcessExecutor.execute({ executable: whichWaydroid, args: ['status'], timeoutMs: 3000 });
    const lower = stRes.stdout.toLowerCase();
    if (stRes.exitCode === 0 && lower.includes('container: running') && lower.includes('session: running')) {
      const [verRes, abiRes, pmRes] = await Promise.all([
        ProcessExecutor.execute({ executable: whichWaydroid, args: ['shell', 'getprop', 'ro.build.version.release'], timeoutMs: 3000 }),
        ProcessExecutor.execute({ executable: whichWaydroid, args: ['shell', 'getprop', 'ro.product.cpu.abi'], timeoutMs: 3000 }),
        ProcessExecutor.execute({ executable: whichWaydroid, args: ['shell', 'pm', 'list', 'packages'], timeoutMs: 4000 })
      ]);
      if (verRes.exitCode === 0 && verRes.stdout.trim()) androidVersion = verRes.stdout.trim();
      if (abiRes.exitCode === 0 && abiRes.stdout.trim()) abi = abiRes.stdout.trim();
      if (pmRes.exitCode === 0 && pmRes.stdout.includes('package:')) {
        packageManagerReady = true;
        packages = pmRes.stdout.split('\n').map(l => l.replace(/^package:/i, '').trim()).filter(Boolean);
      }
    }
  }

  const ready = !!(androidVersion && abi && packageManagerReady);
  const firstFailure = ready
    ? null
    : (isGvisor
        ? 'LOCAL_RUNTIME_UNSUPPORTED: Host kernel is gVisor sandbox without /dev/binder or /dev/kvm'
        : (!hasBinder && adbConnectedDevices.length === 0
            ? 'HOST_RUNTIME_UNAVAILABLE: Missing /dev/binder and 0 ADB devices connected'
            : 'ANDROID_NOT_READY: No active Waydroid session or authorized ADB device responding'));

  return {
    hostOs: os.type(),
    architecture: process.arch,
    kernel,
    isGvisor,
    hasBinder,
    hasKvm,
    executables: { waydroid: whichWaydroid, adb: whichAdb },
    adbConnectedDevices,
    ready,
    state: ready ? 'ANDROID_READY' : 'HOST_RUNTIME_UNAVAILABLE',
    androidVersion,
    abi,
    packageManagerReady,
    packages,
    firstFailure
  };
}

// --- Health & Preflight ---
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

apiRouter.get('/preflight', async (req: Request, res: Response) => {
  const info = await inspectHostAndroidRuntime();
  res.json({
    ...info,
    timestamp: new Date().toISOString()
  });
});

// --- Pairing ---
apiRouter.post('/pairing/request', (req: Request, res: Response) => {
  activePairingCode = Math.floor(100000 + Math.random() * 900000).toString();
  pairingCodeExpiresAt = Date.now() + 5 * 60 * 1000;
  console.log('[PAIRING REQUEST] Challenge generated (PIN redacted from public logs)');
  res.json({ success: true, expiresInSeconds: 300 });
});

apiRouter.post('/pairing/verify', (req: Request, res: Response) => {
  const { code } = req.body;
  if (!activePairingCode || Date.now() > pairingCodeExpiresAt) {
    return res.status(400).json({ success: false, error: 'Pairing code expired or not requested.' });
  }
  if (code === activePairingCode) {
    activePairingCode = null;
    const accessToken = process.env.AUTH_TOKEN || crypto.randomBytes(32).toString('hex');
    return res.json({ success: true, accessToken });
  }
  return res.status(401).json({ success: false, error: 'AUTHENTICATION_FAILED: Invalid pairing code.' });
});

// --- Canonical RemoteAndroidAdapter Endpoints (/api/android/remote/*) ---
apiRouter.get(['/runtime/status', '/android/remote/status'], async (req: Request, res: Response) => {
  const info = await inspectHostAndroidRuntime();
  res.json({
    ready: info.ready,
    state: info.state,
    reason: info.firstFailure,
    androidVersion: info.androidVersion,
    architecture: info.abi || info.architecture,
    deviceModel: info.adbConnectedDevices[0] || 'Linux Android Host',
    uptimeSeconds: process.uptime(),
    packagesCount: info.packages.length,
    packageManagerReady: info.packageManagerReady
  });
});

apiRouter.get(['/android/version', '/android/remote/version'], async (req: Request, res: Response) => {
  const info = await inspectHostAndroidRuntime();
  if (!info.ready) {
    return res.status(503).json({ error: info.firstFailure || 'HOST_RUNTIME_UNAVAILABLE' });
  }
  res.json({ version: info.androidVersion, androidVersion: info.androidVersion });
});

apiRouter.get(['/android/abi', '/android/remote/arch'], async (req: Request, res: Response) => {
  const info = await inspectHostAndroidRuntime();
  if (!info.ready) {
    return res.status(503).json({ error: info.firstFailure || 'HOST_RUNTIME_UNAVAILABLE' });
  }
  res.json({ abi: info.abi, architecture: info.abi });
});

apiRouter.get(['/android/packages', '/android/remote/packages'], async (req: Request, res: Response) => {
  const info = await inspectHostAndroidRuntime();
  if (!info.packageManagerReady) {
    return res.status(503).json({ error: info.firstFailure || 'PACKAGE_MANAGER_UNAVAILABLE', packageManagerReady: false, packages: [] });
  }
  res.json({ packageManagerReady: true, packages: info.packages });
});

apiRouter.post('/android/remote/transfer', async (req: Request, res: Response) => {
  const { filename, sha256, dataBase64 } = req.body;
  if (!dataBase64) {
    return res.status(400).json({ success: false, error: 'Missing dataBase64' });
  }
  const buf = Buffer.from(dataBase64, 'base64');
  const calcHash = crypto.createHash('sha256').update(buf).digest('hex');
  const tmpPath = path.join(os.tmpdir(), `arclight-transfer-${path.basename(filename || 'app.apk')}`);
  await fs.promises.writeFile(tmpPath, buf);
  res.json({
    success: calcHash === sha256,
    filename,
    sha256: calcHash,
    verified: calcHash === sha256,
    sizeBytes: buf.length,
    error: calcHash === sha256 ? undefined : `HASH_MISMATCH: expected ${sha256}, got ${calcHash}`
  });
});

apiRouter.get(['/android/packages/verify/:packageName', '/android/remote/packages/verify/:packageName'], async (req: Request, res: Response) => {
  const pkgName = req.params.packageName;
  const resCmd = await ProcessExecutor.execute({ executable: 'adb', args: ['shell', 'pm', 'path', pkgName], timeoutMs: 3000 });
  const installed = resCmd.exitCode === 0 && resCmd.stdout.includes('package:');
  res.json({ packageName: pkgName, installed, verified: installed, path: installed ? resCmd.stdout.trim() : null });
});

apiRouter.post(['/android/packages/install', '/android/remote/packages/install'], async (req: Request, res: Response) => {
  const dataBase64 = req.body.dataBase64 || req.body.apkBase64;
  const expectedSha256 = req.body.sha256 || req.body.expectedSha256;
  const packageName = req.body.packageName || 'com.example.testapk';

  if (!dataBase64) {
    return res.status(400).json({ success: false, error: 'Missing APK base64 payload' });
  }

  try {
    const apkBuffer = Buffer.from(dataBase64, 'base64');
    const actualSha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');

    if (expectedSha256 && actualSha256 !== expectedSha256) {
      return res.status(400).json({ success: false, error: `HASH_MISMATCH: Expected ${expectedSha256}, got ${actualSha256}` });
    }

    const tmpApkPath = path.join(os.tmpdir(), `install-${Date.now()}.apk`);
    await fs.promises.writeFile(tmpApkPath, apkBuffer);

    const installRes = await ProcessExecutor.execute({ executable: 'adb', args: ['install', '-r', tmpApkPath], timeoutMs: 20000 });
    try { await fs.promises.unlink(tmpApkPath); } catch {}

    if (installRes.exitCode !== 0 || !installRes.stdout.toLowerCase().includes('success')) {
      return res.json({ success: false, errorCode: 'INSTALL_FAILED', message: installRes.stderr || installRes.stdout || 'ADB install failed' });
    }

    const verifyRes = await ProcessExecutor.execute({ executable: 'adb', args: ['shell', 'pm', 'path', packageName], timeoutMs: 4000 });
    const verified = verifyRes.exitCode === 0 && verifyRes.stdout.includes('package:');

    res.json({
      success: verified,
      packageName,
      sha256: actualSha256,
      message: verified ? `Successfully installed and verified package ${packageName}` : 'PACKAGE_VERIFICATION_FAILED'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Internal error during APK installation' });
  }
});

apiRouter.post(['/android/packages/launch', '/android/remote/packages/launch'], async (req: Request, res: Response) => {
  const { packageName } = req.body;
  if (!packageName) {
    return res.status(400).json({ success: false, error: 'Missing packageName' });
  }

  const monkeyRes = await ProcessExecutor.execute({
    executable: 'adb',
    args: ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
    timeoutMs: 5000
  });
  const ok = monkeyRes.exitCode === 0 && !monkeyRes.stdout.includes('No activities found');
  res.json({ success: ok, message: ok ? `Launched ${packageName}` : (monkeyRes.stderr || monkeyRes.stdout || 'APP_LAUNCH_FAILED') });
});

apiRouter.post('/android/remote/packages/stop', async (req: Request, res: Response) => {
  const { packageName } = req.body;
  const stopRes = await ProcessExecutor.execute({ executable: 'adb', args: ['shell', 'am', 'force-stop', packageName], timeoutMs: 4000 });
  res.json({ success: stopRes.exitCode === 0, message: stopRes.exitCode === 0 ? `Stopped ${packageName}` : stopRes.stderr });
});

apiRouter.post('/android/remote/packages/uninstall', async (req: Request, res: Response) => {
  const { packageName } = req.body;
  const unRes = await ProcessExecutor.execute({ executable: 'adb', args: ['uninstall', packageName], timeoutMs: 10000 });
  const ok = unRes.exitCode === 0 && unRes.stdout.toLowerCase().includes('success');
  res.json({ success: ok, message: ok ? `Uninstalled ${packageName}` : (unRes.stderr || unRes.stdout) });
});

apiRouter.get('/android/remote/process/:packageName', async (req: Request, res: Response) => {
  const pkg = req.params.packageName;
  const pidRes = await ProcessExecutor.execute({ executable: 'adb', args: ['shell', 'pidof', pkg], timeoutMs: 3000 });
  const pidStr = pidRes.stdout.trim().split(/\s+/)[0];
  const pid = pidStr ? parseInt(pidStr, 10) : NaN;
  const running = pidRes.exitCode === 0 && !isNaN(pid) && pid > 0;
  res.json({ packageName: pkg, running, pid: running ? pid : null });
});

apiRouter.get('/android/remote/frame', async (req: Request, res: Response) => {
  const capRes = await ProcessExecutor.execute({ executable: 'adb', args: ['exec-out', 'screencap', '-p'], encoding: 'buffer', timeoutMs: 4000 });
  if (capRes.exitCode === 0 && capRes.stdout) {
    const b64 = Buffer.from(capRes.stdout, 'latin1').toString('base64');
    return res.json({ format: 'png', width: 720, height: 1280, dataBase64: b64 });
  }
  res.status(503).json({ error: 'DISPLAY_STREAM_UNAVAILABLE' });
});

apiRouter.post('/android/remote/input', async (req: Request, res: Response) => {
  const { event } = req.body;
  if (!event) return res.status(400).json({ success: false, error: 'Missing event' });
  let args: string[] = [];
  if (event.type === 'tap') args = ['shell', 'input', 'tap', String(Math.round(event.x || 0)), String(Math.round(event.y || 0))];
  else if (event.type === 'back') args = ['shell', 'input', 'keyevent', '4'];
  else if (event.type === 'home') args = ['shell', 'input', 'keyevent', '3'];
  if (args.length === 0) return res.status(400).json({ success: false, error: 'Unsupported input type' });
  const r = await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 3000 });
  res.json({ success: r.exitCode === 0 });
});
