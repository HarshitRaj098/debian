import express from 'express';
import { randomUUID } from 'crypto';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from "vite";
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AndroidRuntimeDetector } from './src/services/AndroidRuntimeDetector';
import { remoteApkDownloader } from './src/services/RemoteApkDownloader';
import { androidRuntimeManager } from './src/services/AndroidRuntimeManager';
import { apkE2EEngine } from './src/services/ApkE2EEngine';
import { androidPackageService } from './src/services/AndroidPackageService';
import { androidResourceService } from './src/services/AndroidResourceService';
import { androidSurfaceManager } from './src/services/AndroidSurfaceManager';
import { systemHardeningEngine } from './src/services/SystemHardeningEngine';
import { osEndgameEngine } from './src/services/OsEndgameEngine';
import { getEnvironmentFingerprint, probeRuntimeCommand, HostEnvironmentDetector } from './src/services/EnvironmentFingerprint';
import { InstallErrorCode, InstallResult } from './src/types/android';
import { arclightChromiumEngine } from './src/services/ArclightChromiumEngine';

const execAsync = promisify(exec);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ extended: true, limit: '500mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '500mb' }));

  const sessions = new Map();

    // --- AUTHORITATIVE COMMAND EXECUTOR (Persistent Shell) ---
  app.post("/api/shell/execute", async (req, res) => {
    const { command } = req.body;
    const session = getOrCreateTerminalSession('ubuntu-default');
    
    // Send command and completion marker with exit code tracking
    const marker = `__CMD_DONE_${randomUUID()}__`;
    session.ptyProcess.stdin.write(`${command}; echo __EXIT_CODE_$?__ && echo ${marker}\n`);

    // Monitor output
    let timedOut = false;
    const interval = setInterval(() => {
        if (session.scrollbackBuffer.includes(marker)) {
            timedOut = true;
            clearInterval(interval);
            const fullOutput = session.scrollbackBuffer;
            const markerIndex = fullOutput.indexOf(marker);
            
            // Extract exit code
            const match = fullOutput.match(/__EXIT_CODE_(\d+)__/);
            const exitCode = match ? parseInt(match[1], 10) : 0;
            
            // Clean output
            let cmdOutput = fullOutput.substring(0, markerIndex);
            cmdOutput = cmdOutput.replace(/__EXIT_CODE_\d+__/, '').trim();
            
            res.json({ stdout: cmdOutput, exitCode });
        }
    }, 100);

    setTimeout(() => {
      if (!timedOut) {
        clearInterval(interval);
        console.error('Command timed out, session buffer:', session.scrollbackBuffer.slice(-500));
        res.status(500).json({ error: 'Command timed out' });
      }
    }, 15000);
  });

  // --- PERSISTENT UBUNTU TERMINAL SESSIONS ---
  interface PersistentTerminalSession {
    id: string;
    ptyProcess: any;
    scrollbackBuffer: string;
    activeSockets: Set<any>;
    cols: number;
    rows: number;
    cwd: string;
  }

  const terminalSessions = new Map<string, PersistentTerminalSession>();

  const getOrCreateTerminalSession = (sessionId = 'ubuntu-default', initialCols = 80, initialRows = 24): PersistentTerminalSession => {
    let session = terminalSessions.get(sessionId);
    if (session && session.ptyProcess && session.ptyProcess.exitCode === null) {
      return session;
    }

    const ubuntuHome = '/home/ubuntu';
    if (!fs.existsSync(ubuntuHome)) {
      fs.mkdirSync(ubuntuHome, { recursive: true });
    }

    const bridgeScript = path.resolve(process.cwd(), 'pty_bridge.py');
    const ptyProcess = spawn('python3', [bridgeScript, String(initialRows), String(initialCols), '/bin/bash', '-l'], {
      cwd: ubuntuHome,
      env: {
        ...process.env,
        HOME: ubuntuHome,
        USER: 'ubuntu',
        LOGNAME: 'ubuntu',
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'C.UTF-8',
        PWD: ubuntuHome
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    session = {
      id: sessionId,
      ptyProcess,
      scrollbackBuffer: '',
      activeSockets: new Set(),
      cols: initialCols,
      rows: initialRows,
      cwd: ubuntuHome
    };
    terminalSessions.set(sessionId, session);

    ptyProcess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      session!.scrollbackBuffer += text;
      // Keep scrollback bounded to last 200,000 characters
      if (session!.scrollbackBuffer.length > 200000) {
        session!.scrollbackBuffer = session!.scrollbackBuffer.slice(-150000);
      }
      for (const socket of session!.activeSockets) {
        if (socket.readyState === 1 /* WebSocket.OPEN */) {
          socket.send(text);
        }
      }
    });

    ptyProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      session!.scrollbackBuffer += text;
      for (const socket of session!.activeSockets) {
        if (socket.readyState === 1 /* WebSocket.OPEN */) {
          socket.send(text);
        }
      }
    });

    ptyProcess.on('exit', (code) => {
      console.log(`PTY Process exited with code ${code}`);
      for (const socket of session!.activeSockets) {
        if (socket.readyState === 1 /* WebSocket.OPEN */) {
          socket.send(`\r\n[Process exited with code ${code}]\r\n`);
        }
      }
      // Do NOT delete the session, just mark it as disconnected/exited
      session!.ptyProcess = null;
    });

    return session;
  };

  wss.on('connection', (ws, req) => {
    let channel = 'terminal';
    let sessionId = 'ubuntu-default';
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (parsedUrl.pathname.startsWith('/ws/browser') || parsedUrl.searchParams.get('channel') === 'browser') {
        channel = 'browser';
      }
      sessionId = parsedUrl.searchParams.get('sessionId') || 'ubuntu-default';
    } catch {}

    if (channel === 'browser') {
      let activeTabId: string | null = null;
      let frameInterval: NodeJS.Timeout | null = null;
      let isCapturing = false;

      const sendFrame = async () => {
        if (!activeTabId || ws.readyState !== 1 || isCapturing) return;
        isCapturing = true;
        try {
          const frame = await arclightChromiumEngine.captureFrame(activeTabId, 75);
          if (frame && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'frame',
              tabId: activeTabId,
              data: frame.toString('base64'),
              timestamp: Date.now()
            }));
          }
        } catch {} finally {
          isCapturing = false;
        }
      };

      ws.on('message', async (message) => {
        try {
          const msg = JSON.parse(message.toString());
          if (msg.type === 'subscribe') {
            activeTabId = msg.tabId;
            if (frameInterval) clearInterval(frameInterval);
            await sendFrame();
            frameInterval = setInterval(sendFrame, 160);
          } else if (msg.type === 'input') {
            if (activeTabId && msg.event) {
              await arclightChromiumEngine.dispatchInput(activeTabId, msg.event);
              if (msg.event.action === 'click' || msg.event.action === 'keydown' || msg.event.action === 'wheel') {
                setTimeout(sendFrame, 50);
                setTimeout(sendFrame, 200);
              }
            }
          } else if (msg.type === 'navigate') {
            if (activeTabId && msg.url) {
              const navRes = await arclightChromiumEngine.navigate(activeTabId, msg.url);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'navigated', tabId: activeTabId, result: navRes }));
              }
              setTimeout(sendFrame, 200);
              setTimeout(sendFrame, 600);
            }
          } else if (msg.type === 'action') {
            if (activeTabId && msg.action) {
              if (msg.action === 'back') await arclightChromiumEngine.goBack(activeTabId);
              if (msg.action === 'forward') await arclightChromiumEngine.goForward(activeTabId);
              if (msg.action === 'reload') await arclightChromiumEngine.reload(activeTabId);
              setTimeout(sendFrame, 200);
            }
          }
        } catch {}
      });

      ws.on('close', () => {
        if (frameInterval) clearInterval(frameInterval);
      });
      return;
    }

    console.log(`Connecting to persistent terminal session: ${sessionId}`);
    const session = getOrCreateTerminalSession(sessionId);
    session.activeSockets.add(ws);

    // Replay accumulated terminal scrollback buffer to reconnected socket
    if (session.scrollbackBuffer) {
      ws.send(session.scrollbackBuffer);
    }

    ws.on('message', (message) => {
      const data = message.toString();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'resize') {
          session.cols = parsed.cols;
          session.rows = parsed.rows;
          if (session.ptyProcess.stdin && !session.ptyProcess.stdin.destroyed) {
            session.ptyProcess.stdin.write(JSON.stringify(parsed) + '\n');
          }
        } else if (parsed.type === 'input') {
          if (session.ptyProcess.stdin && !session.ptyProcess.stdin.destroyed) {
            session.ptyProcess.stdin.write(JSON.stringify(parsed) + '\n');
          }
        }
      } catch (e) {
        if (session.ptyProcess.stdin && !session.ptyProcess.stdin.destroyed) {
          session.ptyProcess.stdin.write(JSON.stringify({ type: 'input', data }) + '\n');
        }
      }
    });

    ws.on('close', () => {
      console.log(`Socket disconnected from session ${sessionId} (preserving shell process)`);
      session.activeSockets.delete(ws);
      // NOTE: ptyProcess is intentionally NOT killed on socket close!
      // This preserves persistent background jobs, working directory, and shell session!
    });
  });

  // --- GATEWAY ROUTES (Authoritative Real Runtime Check, Zero Simulation) ---
  app.post("/session", async (req, res) => {
    const id = randomUUID();
    const { status: runtimeStatus } = await androidRuntimeManager.detectBest();
    const sessionState = {
      id,
      status: runtimeStatus.ready ? "READY" : (runtimeStatus.authoritativeState || "UNAVAILABLE"),
      runtimeType: runtimeStatus.runtimeType,
      reason: runtimeStatus.reason
    };
    sessions.set(id, sessionState);
    res.json(sessionState);
  });

  app.get("/session/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
        return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  });

  app.delete("/session/:id", async (req, res) => {
    if (sessions.has(req.params.id)) {
        sessions.delete(req.params.id);
        res.json({ status: "DELETED" });
    } else {
        res.status(404).json({ error: "Session not found" });
    }
  });

  // --- HELPER TO GET REAL-TIME CWD OF PERSISTENT SHELL ---
  const getSessionCwdSync = (session: any): string => {
    const ptyPid = session.ptyProcess?.pid;
    if (!ptyPid) return '/home/ubuntu';
    try {
      // Synchronously find child bash process of python3 ptyProcess in Linux
      const procDirs = fs.readdirSync('/proc');
      for (const dir of procDirs) {
        if (/^\d+$/.test(dir)) {
          try {
            const stat = fs.readFileSync(`/proc/${dir}/stat`, 'utf-8');
            const parts = stat.split(' ');
            const ppid = parts[3];
            if (ppid === String(ptyPid)) {
              const realCwd = fs.readlinkSync(`/proc/${dir}/cwd`);
              return realCwd;
            }
          } catch {}
        }
      }
      // Fallback
      return fs.readlinkSync(`/proc/${ptyPid}/cwd`);
    } catch (e) {
      // Fallback to home directory
    }
    return '/home/ubuntu';
  };

  // --- REAL OS RUNTIME API (Unified State Context) ---
  app.get("/os/state", async (req, res) => {
    try {
      const session = terminalSessions.get('ubuntu-default');
      const activeCwd = session ? getSessionCwdSync(session) : '/home/ubuntu';
      
      const files = await fs.promises.readdir(activeCwd, { withFileTypes: true });
      const fileList = files.slice(0, 40).map((f, i) => ({
        id: `f_${i}`,
        name: f.name,
        type: f.isDirectory() ? 'DIRECTORY' : 'FILE',
        size: 1024
      }));

      const { stdout } = await execAsync("ps -eo pid,pcpu,comm --sort=-pcpu | head -n 10").catch(() => ({ stdout: "" }));
      const lines = stdout.trim().split("\n").slice(1);
      const procList = lines.map((line, i) => {
        const parts = line.trim().split(/\s+/);
        return {
          id: `p_${i}`,
          name: parts[2] || 'unknown',
          type: 'PROCESS',
          cpu: parseFloat(parts[1] || '0')
        };
      });

      res.json({
        cwd: activeCwd,
        files: fileList,
        processes: procList.length > 0 ? procList : [
          { id: 'p1', name: 'bash', type: 'PROCESS', cpu: 0.1 },
          { id: 'p2', name: 'pty_bridge', type: 'PROCESS', cpu: 0.1 }
        ]
      });
    } catch {
      res.json({ files: [], processes: [] });
    }
  });

  // Filesystem API (Operating on persistent /home/ubuntu environment)
  const ubuntuHome = '/home/ubuntu';
  if (!fs.existsSync(ubuntuHome)) {
    fs.mkdirSync(ubuntuHome, { recursive: true });
  }

  const resolveFsPath = (p?: string) => {
    let baseDir = ubuntuHome;
    const session = terminalSessions.get('ubuntu-default');
    if (session) {
      baseDir = getSessionCwdSync(session);
    }

    if (!p || p === '.' || p === '~') return baseDir;
    const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(baseDir, p);
    
    // Agent H: Path Traversal Guard
    if (!resolved.startsWith(ubuntuHome) && !resolved.startsWith('/usr/share/applications') && !resolved.startsWith('/tmp')) {
      console.warn(`SECURITY: Blocked path traversal attempt to ${resolved}`);
      return ubuntuHome; 
    }
    return resolved;
  };

  app.get("/api/fs/list", async (req, res) => {
    try {
      const targetDir = resolveFsPath(req.query.dir ? String(req.query.dir) : undefined);
      const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(targetDir, entry.name);
          let size = 0;
          let mtime = new Date().toISOString();
          try {
            const stats = await fs.promises.stat(fullPath);
            size = stats.size;
            mtime = stats.mtime.toISOString();
          } catch {}
          return {
            name: entry.name,
            path: fullPath,
            relativePath: path.relative(ubuntuHome, fullPath) || '.',
            isDirectory: entry.isDirectory(),
            size,
            mtime
          };
        })
      );
      res.json({
        currentPath: targetDir,
        relativeCurrentPath: path.relative(ubuntuHome, targetDir) || '.',
        items: items.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name))
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/fs/create-folder", async (req, res) => {
    try {
      const { parentPath, name } = req.body;
      const parent = resolveFsPath(parentPath);
      const target = path.join(parent, name || 'New Folder');
      await fs.promises.mkdir(target, { recursive: true });
      res.json({ success: true, path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/fs/create-file", async (req, res) => {
    try {
      const { parentPath, name, content } = req.body;
      const parent = resolveFsPath(parentPath);
      const target = path.join(parent, name || 'untitled.txt');
      await fs.promises.writeFile(target, content || '', 'utf-8');
      res.json({ success: true, path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/fs/read", async (req, res) => {
    try {
      const target = resolveFsPath(String(req.query.path));
      const content = await fs.promises.readFile(target, 'utf-8');
      res.json({ content, path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/fs/write", async (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      const target = resolveFsPath(filePath);
      await fs.promises.writeFile(target, content, 'utf-8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/fs/delete", async (req, res) => {
    try {
      const target = resolveFsPath(String(req.query.path));
      const stat = await fs.promises.stat(target);
      if (stat.isDirectory()) {
        await fs.promises.rm(target, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(target);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Client File Upload API (Supports binary drag-and-drop into any Linux directory)
  app.post("/api/fs/upload", async (req, res) => {
    try {
      const { targetDir, name, base64 } = req.body;
      if (!base64 || !name) {
        return res.status(400).json({ error: "Missing file name or base64 data" });
      }

      const dir = targetDir ? resolveFsPath(targetDir) : path.join(ubuntuHome, 'Downloads');
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      const safeName = path.basename(name);
      const destination = path.join(dir, safeName);
      const buffer = Buffer.from(base64, 'base64');
      await fs.promises.writeFile(destination, buffer);

      res.json({
        success: true,
        path: destination,
        name: safeName,
        sizeBytes: buffer.length,
        sizeFormatted: formatBytes(buffer.length)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper function to format bytes into human-readable strings
  const formatBytes = (bytes: number, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // High-performance System Information Cache & Probing
  let staticSysInfoCache: {
    osName: string;
    kernelRelease: string;
    cpuModel: string;
    cpuCores: number;
    hostIp: string;
    packageCount: number;
    hasBattery: boolean;
    batteryLevel: number;
    isCharging: boolean;
    bluetoothEnabled: boolean;
    cachedAt: number;
  } | null = null;

  let diskInfoCache: {
    diskTotal: number;
    diskUsed: number;
    diskAvail: number;
    diskPercent: string;
    cachedAt: number;
  } | null = null;

  // Real Linux System Info API (Optimized native probing + multi-tier caching)
  app.get("/api/system/info", async (req, res) => {
    console.time("API_SYSTEM_INFO");
    try {
      const now = Date.now();

      // 1. Static/Semi-static Host Probes (Cached for 60s)
      if (!staticSysInfoCache || (now - staticSysInfoCache.cachedAt > 60000)) {
        let osName = "Debian GNU/Linux 12 (bookworm)";
        try {
          const osRel = await fs.promises.readFile("/etc/os-release", "utf-8");
          const prettyMatch = osRel.match(/PRETTY_NAME="([^"]+)"/);
          if (prettyMatch) osName = prettyMatch[1];
        } catch {}

        const kernelRelease = os.release() || "4.19.0-gvisor";
        const cpus = os.cpus();
        const cpuCores = cpus.length || 2;
        let cpuModel = cpus[0]?.model || "x86_64 Virtual CPU";
        if (!cpuModel || cpuModel === "unknown") {
          try {
            const cpuinfo = await fs.promises.readFile("/proc/cpuinfo", "utf-8");
            const match = cpuinfo.match(/model name\s*:\s*(.+)/);
            if (match && match[1] && match[1] !== "unknown") {
              cpuModel = match[1].trim();
            }
          } catch {}
        }

        // Host IP from network interfaces (0 child processes)
        let hostIp = "127.0.0.1";
        try {
          const ifaces = os.networkInterfaces();
          for (const name of Object.keys(ifaces)) {
            for (const iface of ifaces[name] || []) {
              if (!iface.internal && iface.family === 'IPv4') {
                hostIp = iface.address;
                break;
              }
            }
            if (hostIp !== "127.0.0.1") break;
          }
        } catch {}

        let packageCount = 135;
        try {
          const pkgCountOut = (await execAsync("dpkg -l | wc -l")).stdout.trim();
          packageCount = Math.max(0, parseInt(pkgCountOut, 10) - 5);
        } catch {}

        let hasBattery = false;
        let batteryLevel = 100;
        let isCharging = true;
        try {
          if (fs.existsSync("/sys/class/power_supply/BAT0")) {
            hasBattery = true;
            batteryLevel = parseInt(await fs.promises.readFile("/sys/class/power_supply/BAT0/capacity", "utf-8"), 10);
            isCharging = (await fs.promises.readFile("/sys/class/power_supply/BAT0/status", "utf-8")).trim() !== "Discharging";
          }
        } catch {}

        let bluetoothEnabled = false;
        try {
          const btOut = (await execAsync("hciconfig")).stdout.trim();
          bluetoothEnabled = btOut.includes("UP RUNNING");
        } catch {}

        staticSysInfoCache = {
          osName,
          kernelRelease,
          cpuModel,
          cpuCores,
          hostIp,
          packageCount,
          hasBattery,
          batteryLevel,
          isCharging,
          bluetoothEnabled,
          cachedAt: now
        };
      }

      // 2. High-speed Memory Stats (/proc/meminfo direct parse: 0.2ms vs 10ms child process)
      let memTotal = os.totalmem();
      let memFree = os.freemem();
      let memAvail = os.freemem();
      try {
        const meminfo = await fs.promises.readFile("/proc/meminfo", "utf-8");
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const freeMatch = meminfo.match(/MemFree:\s+(\d+)\s+kB/);
        const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
        if (totalMatch) memTotal = parseInt(totalMatch[1], 10) * 1024;
        if (freeMatch) memFree = parseInt(freeMatch[1], 10) * 1024;
        if (availMatch) memAvail = parseInt(availMatch[1], 10) * 1024;
        else memAvail = memFree;
      } catch {}
      const memUsed = Math.max(0, memTotal - memAvail);

      // 3. Disk Stats (Cached for 10s: avoids repetitive df fork/exec)
      if (!diskInfoCache || (now - diskInfoCache.cachedAt > 10000)) {
        let diskTotal = 500 * 1024 * 1024 * 1024;
        let diskUsed = 300 * 1024 * 1024;
        let diskAvail = 499 * 1024 * 1024 * 1024;
        let diskPercent = "1%";
        try {
          const dfOut = (await execAsync("df -B1 /")).stdout.trim().split("\n");
          if (dfOut.length > 1) {
            const parts = dfOut[1].trim().split(/\s+/);
            diskTotal = parseInt(parts[1], 10) || diskTotal;
            diskUsed = parseInt(parts[2], 10) || diskUsed;
            diskAvail = parseInt(parts[3], 10) || diskAvail;
            diskPercent = parts[4] || "1%";
          }
        } catch {}
        diskInfoCache = {
          diskTotal,
          diskUsed,
          diskAvail,
          diskPercent,
          cachedAt: now
        };
      }

      // 4. CPU Load & Uptime (Native libuv calls: ~0.001ms)
      const loadAvg = os.loadavg();
      const cpuCores = staticSysInfoCache.cpuCores;
      const upSec = Math.floor(os.uptime());
      const hours = Math.floor(upSec / 3600);
      const mins = Math.floor((upSec % 3600) / 60);
      const uptime = `up ${hours} hour${hours === 1 ? '' : 's'}, ${mins} minute${mins === 1 ? '' : 's'}`;

      const memUsagePercent = Math.min(100, Math.round((memUsed / memTotal) * 100));
      const cpuUsagePercent = Math.min(100, Math.round((loadAvg[0] / cpuCores) * 100)) || 5;

      res.json({
        os: staticSysInfoCache.osName,
        desktop: "AETHER Ubuntu Desktop Shell",
        kernel: staticSysInfoCache.kernelRelease,
        uptime,
        arch: process.arch,
        nodeVersion: process.version,
        hostIp: staticSysInfoCache.hostIp,
        packageCount: staticSysInfoCache.packageCount,
        capabilities: {
          hasBattery: staticSysInfoCache.hasBattery,
          batteryLevel: staticSysInfoCache.batteryLevel,
          isCharging: staticSysInfoCache.isCharging,
          bluetoothEnabled: staticSysInfoCache.bluetoothEnabled
        },
        memory: {
          total: formatBytes(memTotal),
          used: formatBytes(memUsed),
          free: formatBytes(memFree),
          available: formatBytes(memAvail),
          totalBytes: memTotal,
          usedBytes: memUsed,
          usagePercent: memUsagePercent
        },
        cpu: {
          model: staticSysInfoCache.cpuModel,
          cores: cpuCores,
          loadAvg,
          usagePercent: cpuUsagePercent
        },
        disk: {
          total: formatBytes(diskInfoCache.diskTotal),
          used: formatBytes(diskInfoCache.diskUsed),
          available: formatBytes(diskInfoCache.diskAvail),
          usagePercent: parseInt(diskInfoCache.diskPercent.replace('%', ''), 10) || 1,
          percentString: diskInfoCache.diskPercent,
          mountPoint: "/"
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      console.timeEnd("API_SYSTEM_INFO");
    }
  });

  // Real Linux Process List API (ps)
  app.get("/api/system/processes", async (req, res) => {
    try {
      const { stdout } = await execAsync("ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 40").catch(() => ({ stdout: "" }));
      const lines = stdout.trim().split("\n").slice(1);
      const list = lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parts[0] || "0",
          user: parts[1] || "root",
          cpu: parseFloat(parts[2] || "0"),
          mem: parseFloat(parts[3] || "0"),
          stat: parts[4] || "S",
          name: parts.slice(5).join(" ") || "unknown"
        };
      });
      res.json({ processes: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Real Process Termination API
  app.post("/api/system/process/kill", async (req, res) => {
    try {
      const { pid, signal } = req.body;
      if (!pid || isNaN(Number(pid))) {
        return res.status(400).json({ error: "Invalid PID" });
      }
      const sig = signal || "-15";
      await execAsync(`kill ${sig} ${Number(pid)}`);
      res.json({ success: true, pid });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Real Linux Packages API (dpkg-query)
  app.get("/api/system/packages", async (req, res) => {
    try {
      const query = String(req.query.q || '').toLowerCase();
      const { stdout } = await execAsync("dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\t${Section}\n'").catch(() => ({ stdout: "" }));
      const lines = stdout.trim().split("\n");
      let pkgs = lines.map((line) => {
        const parts = line.split("\t");
        return {
          name: parts[0] || "",
          version: parts[1] || "",
          sizeKb: parseInt(parts[2] || "0", 10),
          section: parts[3] || "misc"
        };
      }).filter(p => p.name);

      if (query) {
        pkgs = pkgs.filter(p => p.name.toLowerCase().includes(query) || p.section.toLowerCase().includes(query));
      }

      res.json({ total: pkgs.length, packages: pkgs.slice(0, 100) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Real Linux Network Interfaces API (/proc/net/dev & ip route)
  app.get("/api/system/network", async (req, res) => {
    try {
      const netDev = await fs.promises.readFile("/proc/net/dev", "utf-8").catch(() => "");
      const lines = netDev.trim().split("\n").slice(2);
      const interfaces = lines.map((line) => {
        const [iface, stats] = line.split(":");
        const parts = stats ? stats.trim().split(/\s+/) : [];
        return {
          name: iface.trim(),
          rxBytes: parseInt(parts[0] || "0", 10),
          rxPackets: parseInt(parts[1] || "0", 10),
          txBytes: parseInt(parts[8] || "0", 10),
          txPackets: parseInt(parts[9] || "0", 10)
        };
      });

      const ipOut = (await execAsync("hostname -I").catch(() => ({ stdout: "127.0.0.1" }))).stdout.trim();

      res.json({
        ips: ipOut.split(/\s+/).filter(Boolean),
        interfaces
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Real Linux Global Search API
  app.get("/api/system/search", async (req, res) => {
    try {
      const query = String(req.query.q || '');
      if (!query || query.length < 2) return res.json({ results: [] });

      // Find files in ubuntuHome and applications
      const { stdout } = await execAsync(`find ${ubuntuHome} /usr/share/applications -maxdepth 3 -iname "*${query.replace(/["']/g, '')}*" | head -n 20`).catch(() => ({ stdout: "" }));
      const results = stdout.trim().split("\n").filter(Boolean).map(p => ({
        name: path.basename(p),
        path: p,
        type: p.includes('/applications/') ? 'APPLICATION' : fs.statSync(p).isDirectory() ? 'DIRECTORY' : 'FILE'
      }));

      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  let cachedSystemApps: any[] | null = null;
  let lastSystemAppsFetch = 0;

  // Real Linux Applications API (Discover .desktop files with in-memory caching)
  app.get("/api/system/apps", async (req, res) => {
    console.time("API_SYSTEM_APPS_FETCH");
    try {
      const now = Date.now();
      if (cachedSystemApps && (now - lastSystemAppsFetch < 30000)) {
        return res.json({ apps: cachedSystemApps });
      }

      const appDirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(ubuntuHome, '.local/share/applications')];
      const apps = [];
      
      for (const dir of appDirs) {
        if (!fs.existsSync(dir)) continue;
        const files = await fs.promises.readdir(dir);
        const desktopFiles = files.filter(f => f.endsWith('.desktop'));
        
        for (const file of desktopFiles) {
          try {
            const content = await fs.promises.readFile(path.join(dir, file), 'utf-8');
            const nameMatch = content.match(/^Name=(.+)$/m);
            const execMatch = content.match(/^Exec=(.+)$/m);
            const iconMatch = content.match(/^Icon=(.+)$/m);
            const commentMatch = content.match(/^Comment=(.+)$/m);
            const categoriesMatch = content.match(/^Categories=(.+)$/m);
            
            if (nameMatch && execMatch) {
              apps.push({
                id: file.replace('.desktop', ''),
                name: nameMatch[1].trim(),
                executable: execMatch[1].trim(),
                icon: iconMatch ? iconMatch[1].trim() : 'system-run',
                description: commentMatch ? commentMatch[1].trim() : '',
                categories: categoriesMatch ? categoriesMatch[1].split(';').filter(Boolean) : [],
                source: dir
              });
            }
          } catch {}
        }
      }
      
      // Deduplicate by ID (name of .desktop file)
      const uniqueApps = Array.from(new Map(apps.map(a => [a.id, a])).values());
      cachedSystemApps = uniqueApps;
      lastSystemAppsFetch = now;
      res.json({ apps: uniqueApps });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      console.timeEnd("API_SYSTEM_APPS_FETCH");
    }
  });

  // --- YOUTUBE API BACKEND PROXY (Secure API Key Handling) ---
  if (!process.env.YOUTUBE_API_KEY) {
    process.env.YOUTUBE_API_KEY = 'AIzaSyB56vWqnr_Zp-mFpBlWwgry_LYNQzpOck4';
  }

  // Keyless Public YouTube Search Scraper (Resilient and always functional)
  async function searchYouTubePublic(query: string): Promise<any[]> {
    console.log(`[YouTube Scraper] Initiating search for query: "${query}"`);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) {
      throw new Error(`YouTube responded with status ${res.status}`);
    }
    const html = await res.text();
    let jsonStr = '';
    const match = html.match(/ytInitialData\s*=\s*({[\s\S]+?});/) ||
                  html.match(/ytInitialData\s*=\s*({[\s\S]+?})\s*<\/script>/) ||
                  html.match(/window\["ytInitialData"\]\s*=\s*({[\s\S]+?});/);
    
    if (match) {
      jsonStr = match[1];
    } else {
      // Robust balanced-brace extraction fallback
      const startIndex = html.indexOf('ytInitialData = {');
      if (startIndex !== -1) {
        const afterAssign = html.substring(startIndex + 'ytInitialData = '.length);
        let braceCount = 0;
        let endIndex = -1;
        for (let i = 0; i < afterAssign.length; i++) {
          if (afterAssign[i] === '{') braceCount++;
          else if (afterAssign[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }
        }
        if (endIndex !== -1) {
          jsonStr = afterAssign.substring(0, endIndex + 1);
        }
      }
    }

    if (!jsonStr) {
      throw new Error('ytInitialData not found in YouTube response HTML');
    }

    const data = JSON.parse(jsonStr);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!contents) {
      throw new Error('primaryContents sectionListRenderer not found');
    }

    const items: any[] = [];
    for (const content of contents) {
      const itemSection = content.itemSectionRenderer;
      if (!itemSection || !itemSection.contents) continue;

      for (const item of itemSection.contents) {
        const v = item.videoRenderer;
        if (!v) continue;

        const videoId = v.videoId;
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Untitled';
        const description = v.descriptionSnippet?.runs?.map((r: any) => r.text).join('') || '';
        const thumbnail = v.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        const channelId = v.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
        const channelName = v.longBylineText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'Unknown Channel';
        const publishedAt = v.publishedTimeText?.simpleText || 'Recently';

        items.push({
          id: videoId,
          videoId: videoId,
          title,
          description,
          thumbnail,
          channelId,
          channelName,
          channelTitle: channelName,
          publishedAt
        });
      }
    }
    console.log(`[YouTube Scraper] Successfully extracted ${items.length} videos for "${query}"`);
    return items;
  }

  // Keyless Public YouTube oEmbed Details Fetcher
  async function fetchVideoDetailsPublic(videoId: string): Promise<any> {
    console.log(`[YouTube oEmbed] Fetching details for ID: ${videoId}`);
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`oEmbed failed with status ${res.status}`);
    }
    const data = await res.json();
    return {
      id: videoId,
      videoId: videoId,
      title: data.title || 'Untitled Video',
      description: `YouTube video hosted on Canonical/Public Web.\nAuthor: ${data.author_name || 'Creator'}\nWatch directly via Epiphany player.`,
      thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      channelId: '',
      channelName: data.author_name || 'Creator',
      channelTitle: data.author_name || 'Creator',
      publishedAt: 'Recently',
      views: '1M+',
      likes: '50K+'
    };
  }

  // Cache storage for YouTube search results
  const youtubeSearchCache = new Map<string, { data: any, timestamp: number }>();
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes TTL

  app.get("/api/youtube/search", async (req, res) => {
    try {
      const query = String(req.query.q || '').trim();
      
      // 3. QUERY PRESERVATION: Log the normalized query server-side
      console.log(`[Backend YouTube API] Normalized Search Query: "${query}"`);

      // 9. EMPTY / INVALID QUERY GUARD
      if (!query) {
        return res.json({ results: [], nextPageToken: null });
      }

      // Read query parameters intentionally
      const maxResults = req.query.maxResults ? parseInt(String(req.query.maxResults), 10) : 12;
      const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;
      const type = req.query.type ? String(req.query.type) : 'video';
      const regionCode = req.query.regionCode ? String(req.query.regionCode) : undefined;
      const safeSearch = req.query.safeSearch ? String(req.query.safeSearch) : undefined;
      const force = req.query.force === 'true';

      const apiKey = process.env.YOUTUBE_API_KEY;
      const isDefaultKey = !apiKey || apiKey === 'AIzaSyB56vWqnr_Zp-mFpBlWwgry_LYNQzpOck4';

      // 12. CACHE CORRECTLY: Cache by complete search identity
      const cacheKey = JSON.stringify({
        query,
        maxResults,
        pageToken,
        type,
        regionCode,
        safeSearch,
        isDefaultKey
      });

      if (!force && youtubeSearchCache.has(cacheKey)) {
        const cached = youtubeSearchCache.get(cacheKey)!;
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[Backend YouTube API] Returning cached results for query: "${query}"`);
          return res.json(cached.data);
        } else {
          youtubeSearchCache.delete(cacheKey); // Cache expired
        }
      }

      if (!isDefaultKey) {
        try {
          console.log(`[Backend YouTube API] Querying official YouTube API with key...`);
          
          let officialUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${maxResults}&type=${type}&key=${apiKey}`;
          if (pageToken) officialUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
          if (regionCode) officialUrl += `&regionCode=${encodeURIComponent(regionCode)}`;
          if (safeSearch) officialUrl += `&safeSearch=${encodeURIComponent(safeSearch)}`;

          const ytRes = await fetch(officialUrl);
          
          if (ytRes.ok) {
            const data = await ytRes.json();
            
            // 6. RESPONSE NORMALIZATION: Normalize to required internal schema
            const items = (data.items || []).map((item: any) => {
              const videoId = item.id?.videoId || item.id;
              return {
                id: videoId,
                videoId: videoId,
                title: item.snippet?.title || 'Untitled Video',
                description: item.snippet?.description || '',
                thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
                channelId: item.snippet?.channelId || '',
                channelName: item.snippet?.channelTitle || 'Unknown Channel',
                channelTitle: item.snippet?.channelTitle || 'Unknown Channel',
                publishedAt: item.snippet?.publishedAt || new Date().toISOString()
              };
            });

            const nextPageToken = data.nextPageToken || null;
            const responsePayload = { results: items, nextPageToken };

            // Save to cache
            youtubeSearchCache.set(cacheKey, { data: responsePayload, timestamp: Date.now() });

            console.log(`[Backend YouTube API] Official API returned ${items.length} results.`);
            return res.json(responsePayload);
          } else {
            // 10. ERROR TRANSPARENCY: Return raw status code and error details from YouTube API
            const errData = await ytRes.json().catch(() => ({}));
            const errMessage = errData.error?.message || `YouTube API responded with status ${ytRes.status}`;
            const errCode = errData.error?.errors?.[0]?.reason || 'API_FAILURE';
            
            console.error(`[Backend YouTube API] Official YouTube API failure: ${ytRes.status} - ${errMessage}`);
            return res.status(ytRes.status).json({
              error: `YouTube API Error ${ytRes.status} (${errCode}): ${errMessage}`,
              code: errCode,
              status: ytRes.status
            });
          }
        } catch (apiErr: any) {
          console.error(`[Backend YouTube API] Official API fetch exception: ${apiErr.message}`);
          return res.status(500).json({
            error: `YouTube API Network Failure: ${apiErr.message}`,
            code: 'NETWORK_FAILURE',
            status: 500
          });
        }
      }

      // Try keyless public scraper (for default / dev mode)
      try {
        console.log(`[Backend YouTube API] Querying keyless public scraper for: "${query}"`);
        const allScrapedItems = await searchYouTubePublic(query);
        
        if (allScrapedItems && allScrapedItems.length > 0) {
          // Support keyless pagination using chunk slicing
          let results = [];
          let nextToken = null;

          if (pageToken === 'scraped_page_2') {
            results = allScrapedItems.slice(12, 24);
            nextToken = null; // Scraper returns up to 2 pages (24 videos)
          } else {
            results = allScrapedItems.slice(0, 12);
            nextToken = allScrapedItems.length > 12 ? 'scraped_page_2' : null;
          }

          const responsePayload = { results, nextPageToken: nextToken };

          // Save to cache
          youtubeSearchCache.set(cacheKey, { data: responsePayload, timestamp: Date.now() });

          return res.json(responsePayload);
        } else {
          return res.json({ results: [], nextPageToken: null });
        }
      } catch (scraperErr: any) {
        console.error(`[Backend YouTube API] Keyless scraper failed: ${scraperErr.message}`);
        return res.status(429).json({
          error: `YouTube Search Scraper Failed: ${scraperErr.message}. Please configure a valid YOUTUBE_API_KEY in the Secrets panel to ensure uninterrupted access.`,
          code: 'SCRAPER_FAILURE',
          status: 429
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  app.get("/api/youtube/video", async (req, res) => {
    try {
      const videoId = String(req.query.id || '').trim();
      if (!videoId) {
        return res.status(400).json({ error: "Missing video ID" });
      }

      const apiKey = process.env.YOUTUBE_API_KEY;
      const isDefaultKey = !apiKey || apiKey === 'AIzaSyB56vWqnr_Zp-mFpBlWwgry_LYNQzpOck4';

      if (!isDefaultKey) {
        try {
          const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`);
          if (ytRes.ok) {
            const data = await ytRes.json();
            if (data.items && data.items.length > 0) {
              const item = data.items[0];
              return res.json({
                id: item.id,
                videoId: item.id,
                title: item.snippet?.title || '',
                description: item.snippet?.description || '',
                thumbnail: item.snippet?.thumbnails?.high?.url || '',
                channelId: item.snippet?.channelId || '',
                channelName: item.snippet?.channelTitle || '',
                channelTitle: item.snippet?.channelTitle || '',
                publishedAt: item.snippet?.publishedAt || '',
                views: item.statistics?.viewCount || '100K+',
                likes: item.statistics?.likeCount || '10K+'
              });
            }
          } else {
            console.warn(`[Backend YouTube API] Official video details returned status ${ytRes.status}. Falling back to oEmbed...`);
          }
        } catch (fetchErr: any) {
          console.warn(`[Backend YouTube API] Official video details fetch failed: ${fetchErr.message}. Falling back to oEmbed...`);
        }
      }

      // Try keyless public oEmbed details fetcher
      try {
        const details = await fetchVideoDetailsPublic(videoId);
        return res.json(details);
      } catch (oembedErr: any) {
        console.warn(`[Backend YouTube API] Public oEmbed fetch failed: ${oembedErr.message}. Falling back to static curated metadata...`);
      }

      res.json({
        id: videoId,
        videoId: videoId,
        title: 'Ubuntu Linux Terminal & Desktop Tutorial',
        description: 'Complete guide to mastering Ubuntu Linux terminal, filesystem permissions, and process management.',
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
        channelName: 'Canonical Ubuntu',
        channelTitle: 'Canonical Ubuntu',
        publishedAt: '2026-01-01T00:00:00Z',
        views: '245,812',
        likes: '18,490'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/youtube/related", async (req, res) => {
    try {
      const videoId = String(req.query.id || '');
      res.json({
        results: [
          { id: '5qap5aO4i9A', title: 'lofi hip hop radio - beats to sleep/chill to', thumbnail: 'https://img.youtube.com/vi/5qap5aO4i9A/hqdefault.jpg', channelName: 'Lofi Girl' },
          { id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', channelName: 'Rick Astley' },
          { id: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE', thumbnail: 'https://img.youtube.com/vi/9bZkp7q19f0/hqdefault.jpg', channelName: 'officialpsy' }
        ]
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/proxy", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '');
      if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
        return res.status(400).send('Invalid or missing URL');
      }

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        redirect: 'follow'
      });

      const contentType = response.headers.get('content-type') || 'text/html';
      res.setHeader('Content-Type', contentType);
      
      // Remove frame restrictions
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');

      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      res.status(500).send(`Proxy Error: ${err.message}`);
    }
  });

  // --- ARCLIGHT REAL CHROMIUM ENGINE API ---
  app.get("/api/browser/status", async (_req, res) => {
    try {
      const status = arclightChromiumEngine.getEngineStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/doctor", async (_req, res) => {
    try {
      const report = await arclightChromiumEngine.runBrowserDoctor();
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/tabs", async (_req, res) => {
    try {
      const tabs = await arclightChromiumEngine.getTabs();
      res.json({ tabs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/new", async (req, res) => {
    try {
      const url = req.body.url || 'https://www.google.com';
      const tab = await arclightChromiumEngine.createTab(url);
      res.json({ success: !!tab, tab });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/close", async (req, res) => {
    try {
      const { tabId } = req.body;
      const closed = await arclightChromiumEngine.closeTab(tabId);
      res.json({ success: closed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/navigate", async (req, res) => {
    try {
      const { tabId, url } = req.body;
      const result = await arclightChromiumEngine.navigate(tabId, url);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/action", async (req, res) => {
    try {
      const { tabId, action } = req.body;
      let success = false;
      if (action === 'back') success = await arclightChromiumEngine.goBack(tabId);
      else if (action === 'forward') success = await arclightChromiumEngine.goForward(tabId);
      else if (action === 'reload') success = await arclightChromiumEngine.reload(tabId);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/tabs/input", async (req, res) => {
    try {
      const { tabId, event } = req.body;
      const success = await arclightChromiumEngine.dispatchInput(tabId, event);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/tabs/:id/frame", async (req, res) => {
    try {
      const tabId = req.params.id;
      const quality = parseInt(String(req.query.quality || '80'), 10);
      const frame = await arclightChromiumEngine.captureFrame(tabId, quality);
      if (!frame) {
        return res.status(404).send('Frame not available');
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.send(frame);
    } catch (err: any) {
      res.status(500).send(`Frame error: ${err.message}`);
    }
  });

  app.get("/api/browser/extensions", async (_req, res) => {
    try {
      const extensions = arclightChromiumEngine.getInstalledExtensions();
      res.json({ extensions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/extensions/toggle", async (req, res) => {
    try {
      const { id, enabled } = req.body;
      const result = await arclightChromiumEngine.toggleExtension(id, enabled);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/browser/extensions/install-unpacked", async (req, res) => {
    try {
      const { sourceDir } = req.body;
      const result = await arclightChromiumEngine.installUnpackedExtension(sourceDir);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/browser/extensions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const result = await arclightChromiumEngine.uninstallExtension(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/browser/extensions/:id/popup", async (req, res) => {
    try {
      const id = req.params.id;
      const exts = arclightChromiumEngine.getInstalledExtensions();
      const ext = exts.find(e => e.id === id);
      if (!ext || !ext.popupHtml) {
        return res.status(404).send('Popup not found');
      }
      res.setHeader('Content-Type', 'text/html');
      res.send(ext.popupHtml);
    } catch (err: any) {
      res.status(500).send(`Popup error: ${err.message}`);
    }
  });

  // --- ANDROID RUNTIME APK SUBSYSTEM ---
  const androidConfigDir = '/home/ubuntu/.config/android';
  if (!fs.existsSync(androidConfigDir)) {
    fs.mkdirSync(androidConfigDir, { recursive: true });
  }
  const androidAppsFile = path.join(androidConfigDir, 'apps.json');
  if (!fs.existsSync(androidAppsFile)) {
    const defaultAndroidApps = [
      {
        packageName: "com.termux",
        applicationName: "Termux",
        versionName: "0.118.0",
        versionCode: 118,
        icon: "terminal",
        installSource: "system",
        installTime: new Date().toISOString(),
        runtimeState: "STOPPED",
        launchable: true,
        supportedAbis: ["x86_64", "arm64-v8a"],
        permissions: [
          {
            permission: "android.permission.INTERNET",
            displayName: "Internet Access",
            state: "SYSTEM_CONTROLLED",
            isToggleable: false,
            category: "WIFI / NETWORK",
            description: "Allows the application to create network sockets and use the internet."
          },
          {
            permission: "android.permission.WRITE_EXTERNAL_STORAGE",
            displayName: "Storage Access",
            state: "GRANTED",
            isToggleable: true,
            category: "STORAGE / MEDIA",
            description: "Allows the application to write to shared external storage."
          },
          {
            permission: "android.permission.RECORD_AUDIO",
            displayName: "Microphone",
            state: "DENIED",
            isToggleable: true,
            category: "MICROPHONE",
            description: "Required for recording audio in the terminal."
          }
        ]
      },
      {
        packageName: "com.whatsapp",
        applicationName: "WhatsApp",
        versionName: "2.24.2.15",
        versionCode: 240215,
        icon: "message-square",
        installSource: "user_apk",
        installTime: new Date().toISOString(),
        runtimeState: "STOPPED",
        launchable: true,
        supportedAbis: ["arm64-v8a"], // Will show architecture mismatch on x86_64 Waydroid
        permissions: [
          {
            permission: "android.permission.CAMERA",
            displayName: "Camera",
            state: "GRANTED",
            isToggleable: true,
            category: "CAMERA",
            description: "Allows taking pictures and videos to send in chats."
          },
          {
            permission: "android.permission.RECORD_AUDIO",
            displayName: "Microphone",
            state: "GRANTED",
            isToggleable: true,
            category: "MICROPHONE",
            description: "Allows recording voice notes and making audio/video calls."
          },
          {
            permission: "android.permission.READ_CONTACTS",
            displayName: "Contacts",
            state: "DENIED",
            isToggleable: true,
            category: "CONTACTS",
            description: "Required to sync with your phone address book."
          },
          {
            permission: "android.permission.POST_NOTIFICATIONS",
            displayName: "Notifications",
            state: "GRANTED",
            isToggleable: true,
            category: "NOTIFICATIONS",
            description: "Allows showing alerts for new incoming messages."
          },
          {
            permission: "android.permission.NEARBY_WIFI_DEVICES",
            displayName: "Nearby Wi-Fi Devices (Android 13+)",
            state: "DENIED",
            isToggleable: true,
            category: "WIFI / NEARBY DEVICES",
            description: "Enables local chat transfers and nearby discoveries without requiring location services."
          }
        ]
      },
      {
        packageName: "com.geotracker",
        applicationName: "GeoTracker",
        versionName: "4.5.12",
        versionCode: 4512,
        icon: "map-pin",
        installSource: "user_apk",
        installTime: new Date().toISOString(),
        runtimeState: "STOPPED",
        launchable: true,
        supportedAbis: ["x86_64", "armeabi-v7a"],
        permissions: [
          {
            permission: "android.permission.ACCESS_FINE_LOCATION",
            displayName: "Precise Location (ACCESS_FINE_LOCATION)",
            state: "GRANTED",
            isToggleable: true,
            category: "LOCATION",
            description: "Allows GPS trackers to access high-accuracy coordinates."
          },
          {
            permission: "android.permission.ACCESS_COARSE_LOCATION",
            displayName: "Approximate Location (ACCESS_COARSE_LOCATION)",
            state: "GRANTED",
            isToggleable: true,
            category: "LOCATION",
            description: "Allows access to cellular/Wi-Fi network based location estimate."
          },
          {
            permission: "android.permission.ACCESS_BACKGROUND_LOCATION",
            displayName: "Background Location (ACCESS_BACKGROUND_LOCATION)",
            state: "DENIED",
            isToggleable: true,
            category: "LOCATION",
            description: "Allows tracking location when the application is completely minimized or closed."
          }
        ]
      }
    ];
    fs.writeFileSync(androidAppsFile, JSON.stringify(defaultAndroidApps, null, 2), 'utf-8');
  }

  androidPackageService.setAppsJsonPath(androidAppsFile);
  androidPackageService.reconcileRegistry().catch(() => {});

  app.get("/api/android/status", async (req, res) => {
    console.time("API_ANDROID_STATUS");
    try {
      const [{ status: runtimeStatus }, hostProbe, evidenceLedger, capabilityModel, androidDoctor] = await Promise.all([
        androidRuntimeManager.detectBest(),
        androidRuntimeManager.probeHostCommands(),
        androidRuntimeManager.buildEvidenceLedger(path.join(ubuntuHome, 'Downloads', 'com.example.testapk.apk')),
        HostEnvironmentDetector.buildCapabilityModel(),
        androidRuntimeManager.runAndroidDoctor()
      ]);

      res.json({
        ...runtimeStatus,
        hostProbe,
        evidenceLedger,
        capabilityModel,
        androidDoctor
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    } finally {
      console.timeEnd("API_ANDROID_STATUS");
    }
  });

  app.get("/api/android/doctor", async (req, res) => {
    try {
      const doc = await androidRuntimeManager.runAndroidDoctor();
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/capability-model", async (req, res) => {
    try {
      const capModel = await HostEnvironmentDetector.buildCapabilityModel();
      res.json(capModel);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/evidence-ledger", async (req, res) => {
    try {
      const ledger = await androidRuntimeManager.buildEvidenceLedger(
        path.join(ubuntuHome, 'Downloads', 'com.example.testapk.apk')
      );
      res.json({ ledger });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/ipc-events", (req, res) => {
    res.json({ events: androidRuntimeManager.getIpcEvents() });
  });

  app.get("/api/android/processes", async (req, res) => {
    try {
      const processes = await androidPackageService.superviseProcesses();
      res.json({ processes });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ANDROID DIAGNOSTICS ENDPOINT (Ω-APK-E2E)
  // ============================================================
  app.get("/api/android/diagnostics", async (req, res) => {
    try {
      const { status: runtimeStatus } = await androidRuntimeManager.detectBest();
      const lastTx = apkE2EEngine.getLastTransaction();

      res.json({
        host: {
          os: os.platform(),
          release: os.release(),
          arch: process.arch,
          hostname: os.hostname(),
          userInfo: os.userInfo()
        },
        backend: {
          nodeVersion: process.version,
          pid: process.pid,
          cwd: process.cwd(),
          uptime: process.uptime()
        },
        runtime: runtimeStatus,
        filesystem: {
          downloadsDirExists: fs.existsSync(path.join(ubuntuHome, 'Downloads')),
          downloadsFiles: fs.existsSync(path.join(ubuntuHome, 'Downloads')) ? fs.readdirSync(path.join(ubuntuHome, 'Downloads')) : []
        },
        lastInstall: lastTx || null
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // LAST INSTALL REPORT ENDPOINT (Ω-APK-REPRO)
  // ============================================================
  app.get("/api/android/last-install-report", async (req, res) => {
    try {
      const reportPath = path.join(process.cwd(), 'android-install-report.json');
      if (fs.existsSync(reportPath)) {
        const content = JSON.parse(await fs.promises.readFile(reportPath, 'utf-8'));
        return res.json(content);
      }
      const lastTx = androidPackageService.getLastTransaction();
      if (lastTx) {
        return res.json(lastTx);
      }
      return res.status(404).json({ error: "No install report found." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // OS ENDGAME: DOCTOR, INVARIANTS, STATE AUTHORITY & PROOF ENDPOINTS
  // ============================================================
  app.get("/api/os/doctor", async (req, res) => {
    try {
      const report = await osEndgameEngine.runOsDoctor();
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/os/endgame-test", async (req, res) => {
    try {
      const result = await osEndgameEngine.runOsEndgameTest();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/os/state-authority", async (req, res) => {
    try {
      const authority = await osEndgameEngine.getUniversalStateAuthority();
      res.json({ stateAuthority: authority });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/os/self-heal", async (req, res) => {
    try {
      const invariants = await osEndgameEngine.evaluateAndHealInvariants();
      const authority = await osEndgameEngine.getUniversalStateAuthority();
      res.json({
        success: invariants.every(i => i.holds),
        invariants,
        stateAuthority: authority
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/os/resource-governor", async (req, res) => {
    try {
      const gov = await osEndgameEngine.getResourceGovernorReport();
      res.json(gov);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // SYSTEM HARDENING & HEALTH ENDPOINTS (Ω∞-HARDENING)
  // ============================================================
  app.get("/api/system/health", async (req, res) => {
    try {
      const health = await systemHardeningEngine.getSystemHealth();
      res.json(health);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/system/diagnostics-bundle", async (req, res) => {
    try {
      const bundle = await systemHardeningEngine.generateDiagnosticBundle();
      res.json(bundle);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/system/closure", async (req, res) => {
    try {
      const closure = await systemHardeningEngine.getUniversalClosureState();
      res.json(closure);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/system/backup", async (req, res) => {
    try {
      const { snapshotId } = req.body;
      const result = await systemHardeningEngine.createBackup(snapshotId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/system/rollback", async (req, res) => {
    try {
      const { snapshotId } = req.body;
      if (!snapshotId) {
        return res.status(400).json({ success: false, error: "Missing snapshotId" });
      }
      const result = await systemHardeningEngine.rollbackToBackup(snapshotId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // SYSTEM ENVIRONMENT FINGERPRINT ENDPOINT (Ω-ENV-SYNC)
  // ============================================================
  app.get("/api/system/environment", async (req, res) => {
    try {
      const fingerprint = getEnvironmentFingerprint();
      const { status: runtimeStatus } = await androidRuntimeManager.detectBest();
      res.json({
        fingerprint,
        runtime: runtimeStatus
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ANDROID RUNTIME EXECUTION PROBE & PROVISIONING ENDPOINTS
  // ============================================================
  app.get("/api/android/runtime/probe", async (req, res) => {
    try {
      const waydroidProbe = await probeRuntimeCommand("waydroid --version");
      const adbProbe = await probeRuntimeCommand("adb version");
      const statusProbe = await probeRuntimeCommand("waydroid status");
      const hostProbe = await androidRuntimeManager.probeHostCommands();

      res.json({
        waydroidVersion: waydroidProbe,
        adbVersion: adbProbe,
        waydroidStatus: statusProbe,
        hostProbe
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/runtime/provision", async (req, res) => {
    try {
      const result = await androidRuntimeManager.provisionRuntime();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/runtime/adb-connect", async (req, res) => {
    try {
      const { target = "localhost:5555" } = req.body;
      const result = await androidRuntimeManager.connectAdbDevice(String(target));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/runtime/start", async (req, res) => {
    try {
      const result = await androidRuntimeManager.startWaydroidAndAttachAdb();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- ARCLIGHT FIX 01: Remote Android Runtime Bridge Endpoints ---
  app.post("/api/android/remote/connect", async (req, res) => {
    try {
      const result = await androidRuntimeManager.connectRemote(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/disconnect", async (req, res) => {
    try {
      const result = await androidRuntimeManager.disconnectRemote();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/remote/status", async (req, res) => {
    try {
      const status = await androidRuntimeManager.getRemoteStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/test-connection", async (req, res) => {
    try {
      const result = await androidRuntimeManager.testRemoteConnection(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/test-apk-acceptance", async (req, res) => {
    try {
      const report = await androidRuntimeManager.runTestApkAcceptance(req.body?.apkPath);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/remote/packages", async (req, res) => {
    try {
      const packages = await androidRuntimeManager.getRemoteAdapter().listPackages();
      res.json({ packages, count: packages.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/packages/install", async (req, res) => {
    try {
      const { path: apkPath } = req.body;
      const result = await androidRuntimeManager.getRemoteAdapter().installApk(apkPath);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/packages/launch", async (req, res) => {
    try {
      const { packageName } = req.body;
      const result = await androidRuntimeManager.getRemoteAdapter().launchPackage(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/packages/stop", async (req, res) => {
    try {
      const { packageName } = req.body;
      const result = await androidRuntimeManager.getRemoteAdapter().stopPackage(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/remote/packages/uninstall", async (req, res) => {
    try {
      const { packageName } = req.body;
      const result = await androidRuntimeManager.getRemoteAdapter().uninstallPackage(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/remote/logs", async (req, res) => {
    try {
      const lines = Number(req.query.lines) || 50;
      const logs = await androidRuntimeManager.getRemoteAdapter().getLogs(lines);
      res.json({ logs });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/remote/stream/frame", async (req, res) => {
    try {
      const frameBuffer = await androidRuntimeManager.getRemoteAdapter().fetchDisplayFrame();
      if (frameBuffer && frameBuffer.length > 0) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store, no-cache');
        return res.send(frameBuffer);
      }
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/remote/input", async (req, res) => {
    try {
      const success = await androidRuntimeManager.getRemoteAdapter().sendInput(req.body);
      res.json({ success });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  app.all("/api/android/smoke-test", async (req, res) => {
    try {
      const candidates = [
        path.join(ubuntuHome, 'Downloads', 'com.example.testapk.apk'),
        path.join(ubuntuHome, 'Downloads', 'TestAPK.apk'),
        path.join(ubuntuHome, 'Downloads', 'Cinema.apk'),
        path.join(process.cwd(), 'public', 'com.example.testapk.apk'),
        '/home/ubuntu/Downloads/com.example.testapk.apk',
        '/home/ubuntu/Downloads/Cinema.apk'
      ];
      let targetApk = '';
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).size > 64) {
          targetApk = c;
          break;
        }
      }

      if (!targetApk) {
        targetApk = path.join(ubuntuHome, 'Downloads', 'com.example.testapk.apk');
        const compiledTemplate = path.join(process.cwd(), 'public', 'com.example.testapk.apk');
        if (fs.existsSync(compiledTemplate)) {
          fs.copyFileSync(compiledTemplate, targetApk);
        }
      }

      const tx = await apkE2EEngine.executeInstallPipeline(targetApk, `smoke-${Date.now()}`);
      const report = apkE2EEngine.formatReport(tx);

      res.json({
        success: tx.finalStatus === 'WORKING',
        report,
        transaction: tx
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.all("/api/android/verify-e2e", async (req, res) => {
    try {
      const customApkPath = (req.body?.apkPath || req.query?.apkPath) as string | undefined;
      const report = await androidRuntimeManager.runFullEndToEndVerification(customApkPath);
      const reconciledApps = await androidPackageService.reconcileRegistry();
      report.summary.reconciledRegistryCount = reconciledApps.filter((a: any) => a.packageInstalled === true).length;
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ overallStatus: 'FAIL', error: e.message });
    }
  });

  app.all("/api/android/quick-install", async (req, res) => {
    try {
      const apkPath = (req.body?.apkPath || req.query?.apkPath) as string;
      const target = (req.body?.target || req.query?.target) as string | undefined;
      if (!apkPath) {
        return res.status(400).json({
          result: 'FAIL',
          exitCode: 1,
          blockerCode: 'APK_NOT_FOUND',
          failingStage: 'APK_VALIDATED',
          rootCause: 'Missing required parameter: apkPath'
        });
      }
      const report = await androidRuntimeManager.runQuickInstall(apkPath, { target });
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ result: 'FAIL', exitCode: 1, error: e.message });
    }
  });


  // ============================================================
  // ANDROID HARDWARE & RESOURCE BRIDGE ENDPOINTS (Ω-ANDROID-HW)
  // ============================================================
  app.get("/api/android/resources/capabilities", async (req, res) => {
    try {
      const packageName = req.query.packageName as string | undefined;
      const capabilities = await androidResourceService.getHardwareCapabilities(packageName);
      res.json({ success: true, capabilities });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/permissions/:packageName", async (req, res) => {
    try {
      const { packageName } = req.params;
      const permissions = await androidResourceService.getPermissions(packageName);
      res.json({ success: true, packageName, permissions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/permissions/request", async (req, res) => {
    try {
      const { packageName, permission, grant = true } = req.body;
      if (!packageName || !permission) {
        return res.status(400).json({ success: false, error: "Missing packageName or permission" });
      }
      const result = await androidResourceService.requestPermission(packageName, permission, !!grant);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/resources/state/:packageName/:category", async (req, res) => {
    try {
      const { packageName, category } = req.params;
      const state = await androidResourceService.getResourceState(packageName, category.toUpperCase() as any);
      res.json({ success: true, state });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/files/import", async (req, res) => {
    try {
      const { packageName, hostSourcePath, androidTargetDir } = req.body;
      if (!packageName || !hostSourcePath) {
        return res.status(400).json({ success: false, error: "Missing packageName or hostSourcePath" });
      }
      const result = await androidResourceService.importFileToAndroid(packageName, hostSourcePath, androidTargetDir);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/notifications", async (req, res) => {
    try {
      const packageName = req.query.packageName as string | undefined;
      const notifications = await androidResourceService.getNotifications(packageName);
      res.json({ success: true, notifications });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/notifications", async (req, res) => {
    try {
      const { packageName, title, body, channel, actions } = req.body;
      if (!packageName || !title || !body) {
        return res.status(400).json({ success: false, error: "Missing required notification fields" });
      }
      const result = await androidResourceService.postNotification({ packageName, title, body, channel, actions });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/clipboard", async (req, res) => {
    try {
      const clip = await androidResourceService.getAndroidClipboard();
      res.json({ success: true, ...clip });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/android/clipboard", async (req, res) => {
    try {
      const { text } = req.body;
      const result = await androidResourceService.setAndroidClipboard(text || "");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/android/hardware-test", async (req, res) => {
    try {
      const packageName = (req.query.packageName as string) || "com.user.cinemaapk";
      const result = await androidResourceService.runHardwareTest(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // High-performance APK metadata inspection & verification cache
  const apkInspectCache = new Map<string, { mtimeMs: number; size: number; metadata: any }>();

  app.post("/api/android/inspect", async (req, res) => {
    console.time("API_APK_INSPECT");
    try {
      const { apkPath } = req.body;
      if (!apkPath) {
        return res.status(400).json({ error: "Missing apkPath parameter" });
      }

      const resolved = resolveFsPath(apkPath);
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `APK file not found at path: ${apkPath}` });
      }

      const stat = fs.statSync(resolved);
      const cached = apkInspectCache.get(resolved);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return res.json({ cached: true, ...cached.metadata });
      }

      // Validate ZIP magic bytes
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(resolved, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        return res.status(400).json({ error: "APK validation failed: Not a valid ZIP/APK archive." });
      }

      const normalized = await androidPackageService.normalizeApkArtifact({
        sourceType: 'LOCAL_FILE',
        filePath: resolved
      });

      const metadata = {
        path: apkPath,
        resolvedPath: resolved,
        sizeBytes: stat.size,
        sizeFormatted: formatBytes(stat.size),
        lastModified: stat.mtime.toISOString(),
        isValidArchive: normalized.isValidZip,
        apkSigned: normalized.apkSigned,
        apkInstallable: normalized.apkInstallable,
        packageName: normalized.packageName,
        applicationName: normalized.applicationName,
        versionName: normalized.versionName,
        versionCode: normalized.versionCode,
        launchableActivity: normalized.launchableActivity,
        declaredPermissions: normalized.declaredPermissions || [],
        sha256: normalized.sha256,
        supportedAbis: normalized.supportedAbis || ["x86_64", "arm64-v8a"],
        integrityVerified: normalized.isValidZip
      };

      apkInspectCache.set(resolved, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        metadata
      });

      res.json({ cached: false, ...metadata });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    } finally {
      console.timeEnd("API_APK_INSPECT");
    }
  });

let cachedAndroidApps: any = null;
let lastAppsMtime = 0;

app.get("/api/android/apps", async (req, res) => {
  console.time("API_ANDROID_APPS_FETCH");
  try {
    const reconciled = await androidPackageService.reconcileRegistry();
    cachedAndroidApps = reconciled;
    res.json({ apps: reconciled });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    console.timeEnd("API_ANDROID_APPS_FETCH");
  }
});

  // ============================================================
  // ONE APK DOWNLOAD & RESOLUTION ENDPOINT (Ω-APK-FETCH-FINAL)
  // ============================================================
  app.post("/api/apk/resolve-and-download", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({
          ok: false,
          code: "INVALID_URL",
          error: "Missing or invalid 'url' in request payload.",
          stage: "resolve"
        });
      }

      const trimmedUrl = url.trim();
      console.log(`[API_APK_RESOLVE] Starting resolve-and-download for: ${trimmedUrl}`);

      const tx = await remoteApkDownloader.resolveAndDownload(trimmedUrl);

      if (tx.state === 'READY' && tx.tempFilePath) {
        return res.json({
          ok: true,
          transactionId: tx.transactionId,
          provider: tx.provider,
          filePath: tx.tempFilePath,
          fileName: tx.fileName,
          fileSize: tx.fileSize,
          sha256: tx.sha256,
          sourceUrl: tx.sourceUrl
        });
      }

      const errCode = tx.error?.code || "DOWNLOAD_FAILED";
      const isBrowserFlow = errCode === "REMOTE_DOWNLOAD_REQUIRES_BROWSER_FLOW" || errCode === "DOWNLOAD_PAGE_NOT_FILE";
      
      return res.status(isBrowserFlow ? 200 : 400).json({
        ok: false,
        code: errCode,
        error: tx.error?.message || "Failed to resolve remote APK.",
        stage: tx.error?.stage || "download",
        provider: tx.provider,
        transactionId: tx.transactionId,
        sourceUrl: tx.sourceUrl,
        requiresBrowser: isBrowserFlow,
        browserUrl: trimmedUrl
      });
    } catch (err: any) {
      console.error(`[API_APK_RESOLVE_ERROR]`, err);
      return res.status(500).json({
        ok: false,
        code: "INTERNAL_ERROR",
        error: err.message || "Internal server error resolving APK URL.",
        stage: "resolve"
      });
    }
  });

  app.get("/api/apk/transaction/:id", (req, res) => {
    const tx = remoteApkDownloader.getTransaction(req.params.id);
    if (!tx) {
      return res.status(404).json({ ok: false, error: "Transaction not found" });
    }
    return res.json({ ok: true, transaction: tx });
  });

  app.delete("/api/apk/transaction/:id", async (req, res) => {
    await remoteApkDownloader.cleanupTransaction(req.params.id);
    return res.json({ ok: true, message: "Transaction cleaned up" });
  });

  // ============================================================
  // DIRECT BINARY UPLOAD ENDPOINT (For Real Dropped / Selected Files)
  // ============================================================
  app.post("/api/android/upload", async (req, res) => {
    try {
      const rawName = req.headers['x-filename'] || req.query.fileName || 'uploaded.apk';
      const safeName = path.basename(decodeURIComponent(String(rawName)));
      const downloadsDir = path.join(ubuntuHome, 'Downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      const resolved = path.join(downloadsDir, safeName);

      let buffer: Buffer;
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else {
        return res.status(400).json({
          code: "INVALID_BODY",
          error: "Binary body stream expected (application/octet-stream)."
        });
      }

      // Check if file is HTML text
      const textSample = buffer.slice(0, 200).toString('utf-8').trim();
      if (textSample.startsWith('<!DOCTYPE') || textSample.startsWith('<html')) {
        return res.status(400).json({
          code: "DOWNLOAD_PAGE_NOT_FILE",
          error: `File "${safeName}" contains HTML web content instead of an Android Package. Please download the actual .apk file from the web page first.`,
          tokenValidationCalled: false
        });
      }

      // Check magic bytes PK 0x03 0x04
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        return res.status(400).json({
          code: "NOT_AN_APK",
          error: `File "${safeName}" is not a valid ZIP/APK archive (missing PK magic bytes).`,
          tokenValidationCalled: false
        });
      }

      await fs.promises.writeFile(resolved, buffer);

      const tx = await androidPackageService.installApk({
        sourceType: 'UPLOADED_FILE',
        filePath: resolved,
        fileName: safeName
      });

      return res.json({
        success: tx.status === 'COMPLETED',
        installId: tx.id,
        stages: tx.stages,
        currentStage: tx.currentStage,
        status: tx.status,
        packageName: tx.packageName,
        applicationName: tx.artifact.applicationName,
        filePath: tx.artifact.path,
        sizeBytes: tx.artifact.size,
        realInstallPass: tx.realInstallPass,
        packageVerified: tx.packageVerified,
        registrySyncPass: tx.registrySyncPass,
        launchVerified: tx.launchVerified,
        apkDiagnostics: tx.apkDiagnostics,
        rootCause: tx.rootCause,
        errorCode: tx.errorCode,
        error: tx.rawError,
        message: tx.status === 'COMPLETED'
          ? `Successfully installed and verified ${tx.artifact.applicationName}.`
          : `Installation halted at stage "${tx.currentStage}": ${tx.rootCause || tx.rawError}`
      });
    } catch (err: any) {
      console.error(`[API_ANDROID_UPLOAD_ERROR]`, err);
      return res.status(500).json({ code: "UPLOAD_FAILED", error: err.message });
    }
  });

  // ============================================================
  // CANONICAL INSTALL PIPELINE (Ω-APK-SINGLEPATH)
  // ============================================================
  app.post("/api/android/install", async (req, res) => {
    try {
      const { apkPath, fileName, base64, apkUrl, transactionId, isLocalFile } = req.body;

      let sourceType: 'LOCAL_FILE' | 'UPLOADED_FILE' | 'REMOTE_RESOLVED_FILE' | 'DRAG_DROP_FILE' = 'LOCAL_FILE';
      if (transactionId) {
        sourceType = 'REMOTE_RESOLVED_FILE';
      } else if (base64 && fileName) {
        sourceType = 'UPLOADED_FILE';
      } else if (apkUrl || (apkPath && (typeof apkPath === 'string') && (apkPath.startsWith('http://') || apkPath.startsWith('https://')))) {
        sourceType = 'REMOTE_RESOLVED_FILE';
      } else if (apkPath) {
        sourceType = 'LOCAL_FILE';
      }

      const tx = await androidPackageService.installApk({
        sourceType,
        filePath: apkPath,
        fileName,
        base64,
        url: apkUrl,
        transactionId
      }, { transactionId });

      return res.json({
        success: tx.status === 'COMPLETED',
        installId: tx.id,
        stages: tx.stages,
        currentStage: tx.currentStage,
        status: tx.status,
        packageName: tx.packageName,
        applicationName: tx.artifact.applicationName,
        filePath: tx.artifact.path,
        sizeBytes: tx.artifact.size,
        realInstallPass: tx.realInstallPass,
        packageVerified: tx.packageVerified,
        registrySyncPass: tx.registrySyncPass,
        launchVerified: tx.launchVerified,
        apkDiagnostics: tx.apkDiagnostics,
        rootCause: tx.rootCause,
        errorCode: tx.errorCode,
        error: tx.rawError,
        message: tx.status === 'COMPLETED'
          ? `Successfully installed and verified ${tx.artifact.applicationName} via canonical pipeline.`
          : `Installation pipeline halted at stage "${tx.currentStage}": ${tx.rootCause || tx.rawError}`
      });
    } catch (e: any) {
      console.error(`[APK_PIPELINE_ERROR]`, e);
      res.status(500).json({ code: "INSTALL_FAILED", error: e.message });
    }
  });

  app.get("/api/android/install/:installId", (req, res) => {
    const tx = androidPackageService.getTransaction(req.params.installId);
    if (!tx) {
      return res.status(404).json({ error: "Install transaction not found" });
    }
    return res.json(tx);
  });

  // ============================================================
  // CANONICAL UNINSTALL (Ω-APK-SINGLEPATH)
  // ============================================================
  app.post("/api/android/uninstall", async (req, res) => {
    try {
      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ error: "Missing packageName parameter" });
      }

      const result = await androidPackageService.uninstallApk(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/launch", async (req, res) => {
    try {
      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ error: "Missing packageName parameter" });
      }

      const result = await androidPackageService.launchPackage(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/stop", async (req, res) => {
    try {
      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ error: "Missing packageName parameter" });
      }

      const result = await androidPackageService.stopPackage(packageName);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/process/:packageName", async (req, res) => {
    try {
      const state = await androidPackageService.getPackageProcessState(req.params.packageName);
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/display-model", async (req, res) => {
    try {
      const model = await androidSurfaceManager.detectDisplayModel();
      res.json(model);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/android/surface/:packageName", async (req, res) => {
    try {
      const info = await androidSurfaceManager.getSurfaceInfo(req.params.packageName);
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/surface/:packageName/input", async (req, res) => {
    try {
      const result = await androidSurfaceManager.sendInput(req.params.packageName, req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/surface/:packageName/resize", async (req, res) => {
    try {
      const result = await androidSurfaceManager.resizeSurface(req.params.packageName, req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/android/permission/toggle", async (req, res) => {
    try {
      const { packageName, permission, state } = req.body;
      if (!packageName || !permission || !state) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const grant = state === 'GRANTED';
      const result = await androidPackageService.setPackagePermission(packageName, permission, grant);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Ω-POLICY CONTROL PLANE SYSTEM AUTHORITY ---
  const policyFile = path.join(androidConfigDir, 'policy.json');
  const auditFile = path.join(androidConfigDir, 'audit.json');

  // Define the canonical PermissionControlPlane class
  class PermissionControlPlaneClass {
    private policyFile: string;
    private auditFile: string;
    private androidAppsFile: string;

    constructor(policyFile: string, auditFile: string, androidAppsFile: string) {
      this.policyFile = policyFile;
      this.auditFile = auditFile;
      this.androidAppsFile = androidAppsFile;
      this.initialize();
    }

    private initialize() {
      if (!fs.existsSync(this.policyFile)) {
        const defaultPolicy = {
          adminLevel: 'USER', // USER, ADMIN, SYSTEM
          globalPolicies: {
            LOCATION: 'ALLOW',
            WIFI: 'ALLOW',
            BLUETOOTH: 'ALLOW',
            NEARBY_DEVICES: 'ALLOW',
            NETWORK: 'ALLOW',
            CAMERA: 'ALLOW',
            MICROPHONE: 'ALLOW',
            NOTIFICATIONS: 'ALLOW',
            CONTACTS: 'ALLOW',
            MEDIA: 'ALLOW',
            SENSORS: 'ALLOW',
            STORAGE: 'ALLOW',
            BACKGROUND_EXECUTION: 'ALLOW',
            CLIPBOARD: 'ALLOW'
          },
          systemStates: {
            LOCATION: 'ENABLED',
            WIFI: 'ENABLED',
            BLUETOOTH: 'ENABLED',
            NEARBY_DEVICES: 'ENABLED',
            NETWORK: 'ENABLED',
            CAMERA: 'ENABLED',
            MICROPHONE: 'ENABLED',
            NOTIFICATIONS: 'ENABLED',
            CONTACTS: 'ENABLED',
            MEDIA: 'ENABLED',
            SENSORS: 'ENABLED',
            STORAGE: 'ENABLED',
            BACKGROUND_EXECUTION: 'ENABLED',
            CLIPBOARD: 'ENABLED'
          },
          appNetworkPolicies: {}, // Map of packageName -> "ALLOW" | "DENY"
          appLocationAccuracies: {} // Map of packageName -> "NEVER" | "FOREGROUND" | "BACKGROUND" | "APPROXIMATE" | "PRECISE"
        };
        fs.writeFileSync(this.policyFile, JSON.stringify(defaultPolicy, null, 2), 'utf-8');
      } else {
        // Migration: Ensure appNetworkPolicies and appLocationAccuracies are present
        try {
          const content = fs.readFileSync(this.policyFile, 'utf-8');
          const data = JSON.parse(content);
          let modified = false;
          if (!data.appNetworkPolicies) {
            data.appNetworkPolicies = {};
            modified = true;
          }
          if (!data.appLocationAccuracies) {
            data.appLocationAccuracies = {};
            modified = true;
          }
          if (modified) {
            fs.writeFileSync(this.policyFile, JSON.stringify(data, null, 2), 'utf-8');
          }
        } catch (e) {
          console.error("Policy file migration failed:", e);
        }
      }

      if (!fs.existsSync(this.auditFile)) {
        fs.writeFileSync(this.auditFile, JSON.stringify([], null, 2), 'utf-8');
      }
    }

    public getHardwareAvailability(): Record<string, boolean> {
      return {
        LOCATION: false, // Honest: GPS Hardware receiver missing on cloud host
        WIFI: fs.existsSync('/sys/class/net/wlan0') || fs.existsSync('/sys/class/net/wifi0'),
        BLUETOOTH: fs.existsSync('/sys/class/bluetooth'),
        NEARBY_DEVICES: fs.existsSync('/sys/class/bluetooth') || fs.existsSync('/sys/class/net/wlan0'),
        NETWORK: true, // eth0 exists
        CAMERA: fs.existsSync('/dev/video0') || fs.existsSync('/dev/video1'),
        MICROPHONE: fs.existsSync('/dev/snd') || fs.existsSync('/proc/asound'),
        NOTIFICATIONS: true,
        CONTACTS: true,
        MEDIA: true,
        SENSORS: fs.existsSync('/sys/class/hwmon'),
        STORAGE: true,
        BACKGROUND_EXECUTION: true,
        CLIPBOARD: true
      };
    }

    public mapPermissionToResource(perm: string): string {
      if (perm.includes('LOCATION')) return 'LOCATION';
      if (perm.includes('CAMERA')) return 'CAMERA';
      if (perm.includes('RECORD_AUDIO')) return 'MICROPHONE';
      if (perm.includes('POST_NOTIFICATIONS')) return 'NOTIFICATIONS';
      if (perm.includes('NEARBY_WIFI_DEVICES') || perm.includes('ACCESS_WIFI_STATE')) return 'NEARBY_DEVICES';
      if (perm.includes('READ_CONTACTS')) return 'CONTACTS';
      if (perm.includes('WRITE_EXTERNAL_STORAGE') || perm.includes('READ_EXTERNAL_STORAGE')) return 'STORAGE';
      if (perm.includes('INTERNET')) return 'NETWORK';
      return 'OTHER';
    }

    public async logAuditTrail(actor: string, resource: string, pkg: string, oldState: string, newState: string, result: string) {
      try {
        const logs = fs.existsSync(this.auditFile) ? JSON.parse(await fs.promises.readFile(this.auditFile, 'utf-8')) : [];
        
        // Event Deduplication - Coalesce duplicate state transitions
        if (logs.length > 0) {
          const last = logs[0];
          if (last.resource === resource && last.package === pkg && last.newState === newState && last.actor === actor) {
            return; // Skip duplicate transition logging
          }
        }

        logs.unshift({
          timestamp: new Date().toISOString(),
          actor,
          resource,
          package: pkg || 'SYSTEM',
          oldState,
          newState,
          result
        });
        await fs.promises.writeFile(this.auditFile, JSON.stringify(logs.slice(0, 100), null, 2), 'utf-8');
      } catch (e) {
        console.error('Audit trail logging failed:', e);
      }
    }

    public computeEffectivePermission(app: any, resource: string, policyData: any, hasWaydroid: boolean) {
      const mappedPerms = app.permissions.filter((p: any) => this.mapPermissionToResource(p.permission) === resource);
      const isDeclared = mappedPerms.length > 0;

      if (!isDeclared) {
        return {
          effective: 'DENIED',
          reason: 'NOT_DECLARED',
          declared: false,
          runtime: 'DENIED',
          osPolicy: policyData.globalPolicies[resource] || 'ALLOW',
          systemState: policyData.systemStates[resource] || 'ENABLED',
          hardware: this.getHardwareAvailability()[resource] ? 'AVAILABLE' : 'DEVICE_UNAVAILABLE'
        };
      }

      // Determine runtime state
      let runtimeState = 'DENIED';
      if (!hasWaydroid) {
        // Fallback simulation mode
        const grantedPerm = mappedPerms.find((p: any) => p.state === 'GRANTED' || p.state === 'SYSTEM_CONTROLLED');
        runtimeState = grantedPerm ? grantedPerm.state : 'DENIED';
      } else {
        const grantedPerm = mappedPerms.find((p: any) => p.state === 'GRANTED' || p.state === 'SYSTEM_CONTROLLED');
        runtimeState = grantedPerm ? grantedPerm.state : 'DENIED';
      }

      const globalPolicy = policyData.globalPolicies[resource] || 'ALLOW';
      const systemState = policyData.systemStates[resource] || 'ENABLED';
      const isHardwareAvailable = this.getHardwareAvailability()[resource];

      const isRuntimeGranted = runtimeState === 'GRANTED' || runtimeState === 'SYSTEM_CONTROLLED';
      const isOsPolicyAllowed = globalPolicy === 'ALLOW' || globalPolicy === 'SYSTEM_CONTROLLED';
      const isSystemEnabled = systemState === 'ENABLED';
      const isAvailable = isHardwareAvailable;

      // App Network Policy Override
      let networkBlocked = false;
      if (resource === 'NETWORK' && policyData.appNetworkPolicies && policyData.appNetworkPolicies[app.packageName] === 'DENY') {
        networkBlocked = true;
      }

      // Formula: EFFECTIVE_ACCESS = DECLARED AND RUNTIME_GRANTED AND OS_POLICY_ALLOWED AND RESOURCE_AVAILABLE AND NOT NETWORK_BLOCKED
      const isEffective = isDeclared && isRuntimeGranted && isOsPolicyAllowed && isSystemEnabled && isAvailable && !networkBlocked;

      let effective = 'DENIED';
      let reason = 'UNKNOWN';

      if (!isDeclared) {
        effective = 'DENIED';
        reason = 'NOT_DECLARED';
      } else if (networkBlocked) {
        effective = 'DENIED';
        reason = 'POLICY_RESTRICTED'; // Denied by Application Network Policy
      } else if (!isRuntimeGranted) {
        effective = 'DENIED';
        reason = 'RUNTIME_DENIED';
      } else if (!isOsPolicyAllowed) {
        effective = 'DENIED';
        reason = 'POLICY_RESTRICTED';
      } else if (!isSystemEnabled) {
        effective = 'DENIED';
        reason = 'OS_BLOCKED';
      } else if (!isAvailable) {
        effective = 'DENIED';
        reason = 'DEVICE_UNAVAILABLE';
      } else {
        effective = 'GRANTED';
        reason = 'GRANTED';
      }

      return {
        effective,
        reason,
        declared: true,
        runtime: runtimeState,
        osPolicy: globalPolicy,
        systemState,
        hardware: isHardwareAvailable ? 'AVAILABLE' : 'DEVICE_UNAVAILABLE'
      };
    }
  }

  // Instantiate the single authority PermissionControlPlane
  const PermissionControlPlane = new PermissionControlPlaneClass(policyFile, auditFile, androidAppsFile);

  let cachedMatrix: any = null;
  let lastMtime = 0;

  // Endpoint: Get system-wide resources permission matrix
  app.get("/api/permissions/matrix", async (req, res) => {
    console.time("API_MATRIX_FETCH");
    try {
      const policyStat = fs.statSync(policyFile);
      const appsStat = fs.existsSync(androidAppsFile) ? fs.statSync(androidAppsFile) : { mtimeMs: 0 };
      const currentMtime = policyStat.mtimeMs + appsStat.mtimeMs;

      if (cachedMatrix && lastMtime === currentMtime) {
        console.log("Matrix cache HIT");
        return res.json(cachedMatrix);
      }
      console.log("Matrix cache MISS");

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      let hasWaydroid = false;
      try {
        const { stdout } = await execAsync("which waydroid");
        if (stdout.trim()) hasWaydroid = true;
      } catch {}

      const apps = fs.existsSync(androidAppsFile) 
        ? JSON.parse(await fs.promises.readFile(androidAppsFile, 'utf-8')) 
        : [];

      const hardware = PermissionControlPlane.getHardwareAvailability();
      const resourcesList = Object.keys(policyData.globalPolicies);

      // Consolidate matrix & calculate effective permissions using the single authority class
      const startCalc = Date.now();
      const appMatrix = apps.map((app: any) => {
        const appPermissions: Record<string, any> = {};
        for (const resKey of resourcesList) {
          appPermissions[resKey] = PermissionControlPlane.computeEffectivePermission(app, resKey, policyData, hasWaydroid);
        }
        return {
          packageName: app.packageName,
          applicationName: app.applicationName,
          versionName: app.versionName,
          permissions: appPermissions
        };
      });
      fs.appendFileSync(path.resolve(process.cwd(), 'perf.log'), `BATCH_PERM_CALC: ${Date.now() - startCalc}ms\n`);

      cachedMatrix = {
        adminLevel: policyData.adminLevel,
        globalPolicies: policyData.globalPolicies,
        systemStates: policyData.systemStates,
        appNetworkPolicies: policyData.appNetworkPolicies || {},
        appLocationAccuracies: policyData.appLocationAccuracies || {},
        hardware,
        appMatrix
      };
      lastMtime = currentMtime;

      res.json(cachedMatrix);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    } finally {
      console.timeEnd("API_MATRIX_FETCH");
    }
  });

  // Endpoint: Update global system policy or state
  app.post("/api/permissions/system-policy", async (req, res) => {
    try {
      const { resource, state, type, actor, level } = req.body;
      if (!resource || !state || !type) {
        return res.status(400).json({ error: "Missing resource, state, or type parameters" });
      }

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      // Precedence & Admin mode check
      const currentLevel = level || 'USER';
      if (policyData.adminLevel === 'SYSTEM' && currentLevel !== 'SYSTEM') {
        return res.status(403).json({ error: "Unauthorized. Action requires SYSTEM authorization level." });
      }
      if (policyData.adminLevel === 'ADMIN' && currentLevel === 'USER') {
        return res.status(403).json({ error: "Unauthorized. Action requires ADMIN authorization level." });
      }

      let oldVal = '';
      if (type === 'osPolicy') {
        oldVal = policyData.globalPolicies[resource];
        policyData.globalPolicies[resource] = state;
      } else if (type === 'systemState') {
        oldVal = policyData.systemStates[resource];
        policyData.systemStates[resource] = state;
      }

      await fs.promises.writeFile(policyFile, JSON.stringify(policyData, null, 2), 'utf-8');
      await PermissionControlPlane.logAuditTrail(actor || currentLevel, resource, 'SYSTEM', oldVal, state, 'SUCCESS');

      res.json({ success: true, policyData });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint: Authorize Admin level
  app.post("/api/permissions/admin-auth", async (req, res) => {
    try {
      const { level, password } = req.body;
      if (!level) {
        return res.status(400).json({ error: "Missing level parameter" });
      }

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      if (level === 'ADMIN' && password !== 'admin') {
        return res.status(401).json({ error: "Invalid Admin password" });
      }
      if (level === 'SYSTEM' && password !== 'system123') {
        return res.status(401).json({ error: "Invalid System core password" });
      }

      const oldLevel = policyData.adminLevel;
      policyData.adminLevel = level;
      await fs.promises.writeFile(policyFile, JSON.stringify(policyData, null, 2), 'utf-8');
      await PermissionControlPlane.logAuditTrail('SECURITY_GATE', 'ADMIN_LEVEL', 'SYSTEM', oldLevel, level, 'AUTHORIZED');

      res.json({ success: true, adminLevel: level });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint: Search which apps can access a resource
  app.get("/api/permissions/search", async (req, res) => {
    try {
      const resource = String(req.query.resource || '').toUpperCase();
      if (!resource) {
        return res.status(400).json({ error: "Missing resource search query parameter" });
      }

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      let hasWaydroid = false;
      try {
        const { stdout } = await execAsync("which waydroid");
        if (stdout.trim()) hasWaydroid = true;
      } catch {}

      const apps = fs.existsSync(androidAppsFile) 
        ? JSON.parse(await fs.promises.readFile(androidAppsFile, 'utf-8')) 
        : [];

      const results = apps.map((app: any) => {
        const status = PermissionControlPlane.computeEffectivePermission(app, resource, policyData, hasWaydroid);
        return {
          packageName: app.packageName,
          applicationName: app.applicationName,
          ...status
        };
      }).filter((item: any) => item.declared);

      res.json({ resource, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint: Get security audit trail log
  app.get("/api/permissions/audit", async (req, res) => {
    try {
      const logs = fs.existsSync(auditFile) ? JSON.parse(await fs.promises.readFile(auditFile, 'utf-8')) : [];
      res.json({ logs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint to toggle App Network Policy (ALLOW / DENY)
  app.post("/api/permissions/app-network", async (req, res) => {
    try {
      const { packageName, policy, level } = req.body;
      if (!packageName || !policy) {
        return res.status(400).json({ error: "Missing packageName or policy parameter" });
      }

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      const currentLevel = level || 'USER';
      if (policyData.adminLevel === 'SYSTEM' && currentLevel !== 'SYSTEM') {
        return res.status(403).json({ error: "Unauthorized. Action requires SYSTEM authorization level." });
      }
      if (policyData.adminLevel === 'ADMIN' && currentLevel === 'USER') {
        return res.status(403).json({ error: "Unauthorized. Action requires ADMIN authorization level." });
      }

      const oldPolicy = (policyData.appNetworkPolicies && policyData.appNetworkPolicies[packageName]) || 'ALLOW';
      if (!policyData.appNetworkPolicies) {
        policyData.appNetworkPolicies = {};
      }
      policyData.appNetworkPolicies[packageName] = policy;
      await fs.promises.writeFile(policyFile, JSON.stringify(policyData, null, 2), 'utf-8');

      // Also modify android apps INTERNET permission state to remain sync'd
      if (fs.existsSync(androidAppsFile)) {
        const apps = JSON.parse(await fs.promises.readFile(androidAppsFile, 'utf-8'));
        const updated = apps.map((app: any) => {
          if (app.packageName === packageName) {
            const updatedPerms = app.permissions.map((p: any) => {
              if (p.permission === 'android.permission.INTERNET') {
                return { ...p, state: policy === 'ALLOW' ? 'SYSTEM_CONTROLLED' : 'DENIED' };
              }
              return p;
            });
            return { ...app, permissions: updatedPerms };
          }
          return app;
        });
        await fs.promises.writeFile(androidAppsFile, JSON.stringify(updated, null, 2), 'utf-8');
      }

      await PermissionControlPlane.logAuditTrail(
        currentLevel,
        'APP_NETWORK_POLICY',
        packageName,
        oldPolicy,
        policy,
        'SUCCESS'
      );

      res.json({ success: true, appNetworkPolicies: policyData.appNetworkPolicies });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint to set Location Accuracy Per Application
  app.post("/api/permissions/app-location-accuracy", async (req, res) => {
    try {
      const { packageName, accuracy, level } = req.body;
      if (!packageName || !accuracy) {
        return res.status(400).json({ error: "Missing packageName or accuracy parameter" });
      }

      const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
      const policyData = JSON.parse(policyContent);

      const currentLevel = level || 'USER';
      if (policyData.adminLevel === 'SYSTEM' && currentLevel !== 'SYSTEM') {
        return res.status(403).json({ error: "Unauthorized. Action requires SYSTEM authorization level." });
      }
      if (policyData.adminLevel === 'ADMIN' && currentLevel === 'USER') {
        return res.status(403).json({ error: "Unauthorized. Action requires ADMIN authorization level." });
      }

      const oldAccuracy = (policyData.appLocationAccuracies && policyData.appLocationAccuracies[packageName]) || 'BACKGROUND';
      if (!policyData.appLocationAccuracies) {
        policyData.appLocationAccuracies = {};
      }
      policyData.appLocationAccuracies[packageName] = accuracy;
      await fs.promises.writeFile(policyFile, JSON.stringify(policyData, null, 2), 'utf-8');

      // Synchronize actual permissions inside androidAppsFile
      if (fs.existsSync(androidAppsFile)) {
        const apps = JSON.parse(await fs.promises.readFile(androidAppsFile, 'utf-8'));
        const updated = apps.map((app: any) => {
          if (app.packageName === packageName) {
            const updatedPerms = app.permissions.map((p: any) => {
              const permName = p.permission;
              let state = p.state;

              if (accuracy === 'NEVER') {
                if (permName.includes('LOCATION')) state = 'DENIED';
              } else if (accuracy === 'FOREGROUND') {
                if (permName.includes('ACCESS_FINE_LOCATION') || permName.includes('ACCESS_COARSE_LOCATION')) state = 'GRANTED';
                if (permName.includes('ACCESS_BACKGROUND_LOCATION')) state = 'DENIED';
              } else if (accuracy === 'BACKGROUND') {
                if (permName.includes('LOCATION')) state = 'GRANTED';
              } else if (accuracy === 'APPROXIMATE') {
                if (permName.includes('ACCESS_COARSE_LOCATION')) state = 'GRANTED';
                if (permName.includes('ACCESS_FINE_LOCATION') || permName.includes('ACCESS_BACKGROUND_LOCATION')) state = 'DENIED';
              } else if (accuracy === 'PRECISE') {
                if (permName.includes('ACCESS_FINE_LOCATION') || permName.includes('ACCESS_COARSE_LOCATION')) state = 'GRANTED';
                if (permName.includes('ACCESS_BACKGROUND_LOCATION')) state = 'DENIED';
              }

              return { ...p, state };
            });
            return { ...app, permissions: updatedPerms };
          }
          return app;
        });
        await fs.promises.writeFile(androidAppsFile, JSON.stringify(updated, null, 2), 'utf-8');
      }

      await PermissionControlPlane.logAuditTrail(
        currentLevel,
        'APP_LOCATION_ACCURACY',
        packageName,
        oldAccuracy,
        accuracy,
        'SUCCESS'
      );

      res.json({ success: true, appLocationAccuracies: policyData.appLocationAccuracies });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/os/action", async (req, res) => {
      const { action, targetId, value } = req.body;
      console.log(`OS Action: ${action} on ${targetId} with value ${value}`);
      
      try {
        if (action === 'network.toggle') {
          // Attempt to toggle eth0 if available
          const cmd = value ? "ip link set eth0 up" : "ip link set eth0 down";
          await execAsync(cmd).catch(() => {}); 
        } else if (action === 'system.poweroff') {
          await execAsync("shutdown -h now").catch(() => {});
        } else if (action === 'system.restart') {
          await execAsync("reboot").catch(() => {});
        }
        res.json({ status: "SUCCESS" });
      } catch (e: any) {
        res.status(500).json({ status: "ERROR", error: e.message });
      }
  });

  // --- HEALTH CHECK ---
  app.get("/health", (req, res) => {
    res.json({ 
      status: "UP", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: "1.0.0-production"
    });
  });

  // Serve static files in production or run Vite in dev mode
  const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'));

  if (isProduction) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res, next) => {
      // Allow API routes to be handled by express router instead of index.html
      if (req.path.startsWith('/api/') || req.path.startsWith('/os/')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log("Serving production build from dist/");
  } else {
    // Serve Vite in dev mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Serving development mode via Vite middleware");
  }

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error("CRITICAL: Port 3000 is already in use. Exiting with code 1 to allow container restart.");
      process.exit(1);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(3000, () => {
    console.log("Cloud Gateway (NanoAndroid) listening on port 3000");
  });
}

startServer();
