import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type DesktopCapability =
  | 'NOTIFICATIONS'
  | 'CLIPBOARD'
  | 'FILE_ACCESS'
  | 'AUDIO'
  | 'SHARING_AND_DEEP_LINKS';

export type PermissionDecision = 'ALLOW' | 'DENY' | 'USER_PROMPT' | 'UNSUPPORTED';

export interface BridgeRequestContext {
  packageName: string;
  applicationName?: string;
  capability: DesktopCapability;
  operation: string;
  payload?: any;
  timestamp: string;
  correlationId: string;
}

export interface BridgeAuditRecord {
  id: string;
  timestamp: string;
  packageName: string;
  capability: DesktopCapability;
  operation: string;
  decision: PermissionDecision;
  reason: string;
  durationMs: number;
  correlationId: string;
}

export interface DesktopNotificationRequest {
  title: string;
  body: string;
  iconUrl?: string;
  actions?: Array<{ id: string; title: string }>;
  payload?: any;
}

export interface ClipboardRequest {
  action: 'READ' | 'WRITE';
  text?: string;
}

export interface FileAccessRequest {
  action: 'OPEN' | 'SAVE' | 'SHARE';
  suggestedName?: string;
  mimeType?: string;
  dataBase64?: string;
}

export interface AudioPlaybackRequest {
  action: 'PLAY' | 'STOP' | 'PAUSE';
  streamType?: string;
  volume?: number;
}

export interface DeepLinkRequest {
  uri: string;
  action: string;
}

export class AndroidDesktopBridge {
  private auditLog: BridgeAuditRecord[] = [];
  private clipboardStore: string = '';
  private activeAudioStreams: Set<string> = new Set();
  private sharedFilesDir: string = path.resolve(process.cwd(), 'dist', 'shared-files');

  constructor() {
    try {
      if (!fs.existsSync(this.sharedFilesDir)) {
        fs.mkdirSync(this.sharedFilesDir, { recursive: true });
      }
    } catch {}
  }

  /**
   * Permission Broker: Enforces least-privilege policies for cross-boundary bridge actions.
   */
  public evaluatePermission(ctx: BridgeRequestContext): { decision: PermissionDecision; reason: string } {
    const { packageName, capability, operation } = ctx;

    // Validate package identity format
    if (!packageName || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(packageName)) {
      return { decision: 'DENY', reason: `Invalid or untrusted package identifier "${packageName}".` };
    }

    switch (capability) {
      case 'NOTIFICATIONS':
        if (operation === 'SHOW') {
          return { decision: 'ALLOW', reason: 'Notifications allowed for verified package.' };
        }
        return { decision: 'DENY', reason: `Operation "${operation}" for NOTIFICATIONS is unsupported or denied.` };

      case 'CLIPBOARD':
        if (operation === 'READ') {
          return { decision: 'USER_PROMPT', reason: 'Cross-boundary clipboard read requires user confirmation.' };
        }
        if (operation === 'WRITE') {
          return { decision: 'ALLOW', reason: 'Clipboard write allowed with audit logging.' };
        }
        return { decision: 'DENY', reason: `Unknown clipboard operation "${operation}".` };

      case 'FILE_ACCESS':
        if (operation === 'OPEN' || operation === 'SAVE' || operation === 'SHARE') {
          return { decision: 'USER_PROMPT', reason: 'Scoped file access requires explicit user approval.' };
        }
        return { decision: 'DENY', reason: `Path traversal or unauthorized file operation "${operation}" rejected.` };

      case 'AUDIO':
        if (operation === 'PLAY' || operation === 'STOP' || operation === 'PAUSE') {
          return { decision: 'ALLOW', reason: 'Audio stream playback routed through host audio channel.' };
        }
        return { decision: 'DENY', reason: `Audio operation "${operation}" denied.` };

      case 'SHARING_AND_DEEP_LINKS':
        if (operation === 'ROUTE') {
          return { decision: 'USER_PROMPT', reason: 'External deep link sharing requires desktop confirmation.' };
        }
        return { decision: 'DENY', reason: `Sharing operation "${operation}" denied.` };

      default:
        return { decision: 'UNSUPPORTED', reason: `Capability "${capability}" is not supported by the desktop bridge.` };
    }
  }

  /**
   * Executes a bridge request through the permission broker with audit logging.
   */
  public async executeBridgeRequest(ctx: BridgeRequestContext, handlers: {
    onNotification?: (req: DesktopNotificationRequest) => void;
    onShare?: (link: string) => void;
  }): Promise<{ success: boolean; decision: PermissionDecision; message: string; data?: any }> {
    const startTime = Date.now();
    const { decision, reason } = this.evaluatePermission(ctx);

    const record: BridgeAuditRecord = {
      id: crypto.randomUUID(),
      timestamp: ctx.timestamp || new Date().toISOString(),
      packageName: ctx.packageName,
      capability: ctx.capability,
      operation: ctx.operation,
      decision,
      reason,
      durationMs: 0,
      correlationId: ctx.correlationId || crypto.randomUUID()
    };

    if (decision === 'DENY' || decision === 'UNSUPPORTED') {
      record.durationMs = Date.now() - startTime;
      this.auditLog.unshift(record);
      if (this.auditLog.length > 200) this.auditLog.pop();
      return { success: false, decision, message: `Access denied: ${reason}` };
    }

    if (decision === 'USER_PROMPT') {
      record.durationMs = Date.now() - startTime;
      this.auditLog.unshift(record);
      if (this.auditLog.length > 200) this.auditLog.pop();
      return { success: false, decision, message: `User confirmation required for ${ctx.capability}.${ctx.operation}: ${reason}` };
    }

    try {
      let data: any = null;
      if (ctx.capability === 'NOTIFICATIONS' && handlers.onNotification) {
        handlers.onNotification(ctx.payload as DesktopNotificationRequest);
        data = { delivered: true };
      } else if (ctx.capability === 'CLIPBOARD') {
        const req = ctx.payload as ClipboardRequest;
        if (req.action === 'WRITE') {
          this.clipboardStore = req.text || '';
          data = { clipboardLength: this.clipboardStore.length };
        } else {
          data = { text: this.clipboardStore };
        }
      } else if (ctx.capability === 'FILE_ACCESS') {
        const req = ctx.payload as FileAccessRequest;
        if (req.action === 'SAVE' && req.dataBase64) {
          const safeName = path.basename(req.suggestedName || `shared-${Date.now()}.bin`).replace(/[^a-zA-Z0-9._-]/g, '_');
          const targetPath = path.join(this.sharedFilesDir, safeName);
          const buf = Buffer.from(req.dataBase64, 'base64');
          fs.writeFileSync(targetPath, buf);
          data = { savedPath: `/shared-files/${safeName}`, sizeBytes: buf.length };
        } else {
          data = { status: 'SCOPED_ACCESS_READY' };
        }
      } else if (ctx.capability === 'AUDIO') {
        const req = ctx.payload as AudioPlaybackRequest;
        const streamId = `${ctx.packageName}-stream`;
        if (req.action === 'PLAY') {
          this.activeAudioStreams.add(streamId);
          data = { activeStreams: this.activeAudioStreams.size };
        } else {
          this.activeAudioStreams.delete(streamId);
          data = { activeStreams: this.activeAudioStreams.size };
        }
      } else if (ctx.capability === 'SHARING_AND_DEEP_LINKS' && handlers.onShare) {
        const req = ctx.payload as DeepLinkRequest;
        handlers.onShare(req.uri);
        data = { routed: true, uri: req.uri };
      }

      record.durationMs = Date.now() - startTime;
      this.auditLog.unshift(record);
      if (this.auditLog.length > 200) this.auditLog.pop();

      return { success: true, decision, message: 'Bridge request executed successfully', data };
    } catch (err: any) {
      record.decision = 'DENY';
      record.reason = `Execution error: ${err.message}`;
      record.durationMs = Date.now() - startTime;
      this.auditLog.unshift(record);
      return { success: false, decision: 'DENY', message: err.message };
    }
  }

  public cleanupAppResources(packageName: string): { audioStreamsReleased: number } {
    let released = 0;
    const targetStream = `${packageName}-stream`;
    if (this.activeAudioStreams.has(targetStream)) {
      this.activeAudioStreams.delete(targetStream);
      released++;
    }
    return { audioStreamsReleased: released };
  }

  public getAuditLog(): BridgeAuditRecord[] {
    return this.auditLog.map(record => ({
      ...record,
      reason: record.reason.replace(/(\/home\/[^\s]+|token=[^\s]+|Bearer\s+[^\s]+)/gi, '[REDACTED]')
    }));
  }
}

export const androidDesktopBridge = new AndroidDesktopBridge();
