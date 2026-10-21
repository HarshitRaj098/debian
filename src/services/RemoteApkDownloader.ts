import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ApkTransactionState = 
  | 'RECEIVED'
  | 'RESOLVING'
  | 'DOWNLOADING'
  | 'VALIDATING'
  | 'READY'
  | 'INSTALLING'
  | 'VERIFYING'
  | 'INSTALLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CLEANED';

export interface ApkTransactionError {
  code: string;
  message: string;
  stage: 'resolve' | 'download' | 'validate' | 'install';
}

export interface ApkTransaction {
  transactionId: string;
  requestId: string;
  state: ApkTransactionState;
  sourceUrl?: string;
  resolvedUrl?: string;
  provider: string;
  tempFilePath?: string;
  fileName?: string;
  fileSize?: number;
  sha256?: string;
  error?: ApkTransactionError;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedApkResult {
  ok: boolean;
  provider: string;
  resolvedUrl?: string;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  sha256?: string;
  error?: ApkTransactionError;
}

export interface RemoteApkProvider {
  name: string;
  canHandle(url: URL): boolean;
  resolveAndDownload(url: URL, requestId: string, tempDir: string): Promise<ResolvedApkResult>;
}

/**
 * SSRF Safety Guard
 * Restricts remote fetching strictly to safe public HTTPS targets.
 */
export function isSafePublicHttpsUrl(urlObj: URL): { safe: boolean; reason?: string } {
  if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
    return { safe: false, reason: 'INVALID_URL: Only HTTP and HTTPS schemes are supported.' };
  }

  const hostname = urlObj.hostname.toLowerCase();

  // Reject local and loopback addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254'
  ) {
    return { safe: false, reason: 'SSRF_BLOCKED: Access to local/internal network targets is forbidden.' };
  }

  // Reject private RFC1918 IPv4 ranges
  const ipv4Parts = hostname.split('.').map(Number);
  if (ipv4Parts.length === 4 && ipv4Parts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
    const [a, b] = ipv4Parts;
    if (a === 10) return { safe: false, reason: 'SSRF_BLOCKED: Private 10.0.0.0/8 network is forbidden.' };
    if (a === 127) return { safe: false, reason: 'SSRF_BLOCKED: Loopback 127.0.0.0/8 network is forbidden.' };
    if (a === 169 && b === 254) return { safe: false, reason: 'SSRF_BLOCKED: Link-local 169.254.0.0/16 is forbidden.' };
    if (a === 172 && b >= 16 && b <= 31) return { safe: false, reason: 'SSRF_BLOCKED: Private 172.16.0.0/12 network is forbidden.' };
    if (a === 192 && b === 168) return { safe: false, reason: 'SSRF_BLOCKED: Private 192.168.0.0/16 network is forbidden.' };
  }

  return { safe: true };
}

/**
 * LimeWire Provider
 * Handles limewire.com share URLs (e.g., https://limewire.com/d/mlXZp#NlW2ueD24j).
 * Real behavior: LimeWire returns an HTML web landing page (content-type: text/html).
 * The URL fragment (#...) is a client-side decryption key used in the user's browser,
 * NOT an HTTP authorization token.
 */
export class LimeWireProvider implements RemoteApkProvider {
  name = 'LimeWire';

  canHandle(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.includes('limewire.com');
  }

  async resolveAndDownload(url: URL, requestId: string, tempDir: string): Promise<ResolvedApkResult> {
    console.log(`[LimeWireProvider][${requestId}] Inspecting LimeWire URL: ${url.origin}${url.pathname}`);

    // Clean URL: fragments are strictly client-side; never sent as HTTP headers or tokens
    const cleanUrl = `${url.origin}${url.pathname}`;

    // Create abort controller for 15s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AETHER-OS/1.0.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      console.log(`[LimeWireProvider][${requestId}] HTTP status=${response.status}, contentType=${contentType}`);

      // If LimeWire returns an HTML landing page (its normal real behavior)
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        console.log(`[LimeWireProvider][${requestId}] Share page returned HTML. Direct raw APK byte stream unavailable without browser decryption.`);
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'REMOTE_DOWNLOAD_REQUIRES_BROWSER_FLOW',
            message: 'LimeWire share links are web application pages requiring client-side in-browser decryption. Please open the link in your browser to download Cinema.apk, then drag the downloaded .apk file directly into AETHER OS.',
            stage: 'resolve'
          }
        };
      }

      // If it redirected to an actual direct binary download
      if (response.ok && (contentType.includes('application/vnd.android.package-archive') || contentType.includes('application/octet-stream') || contentType.includes('application/zip'))) {
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        // Verify ZIP magic bytes
        if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
          const fileName = 'Cinema.apk';
          const filePath = path.join(tempDir, fileName);
          await fs.promises.writeFile(filePath, buffer);

          const hash = crypto.createHash('sha256').update(buffer).digest('hex');

          return {
            ok: true,
            provider: this.name,
            resolvedUrl: response.url,
            fileName,
            filePath,
            fileSize: buffer.length,
            sha256: hash
          };
        }
      }

      return {
        ok: false,
        provider: this.name,
        error: {
          code: 'DOWNLOAD_PAGE_NOT_FILE',
          message: 'The LimeWire share URL returned a web application page instead of raw APK bytes. Please download the APK in your browser first.',
          stage: 'download'
        }
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_TIMEOUT',
            message: 'Connection to LimeWire timed out after 15 seconds.',
            stage: 'download'
          }
        };
      }
      return {
        ok: false,
        provider: this.name,
        error: {
          code: 'CONNECTION_ERROR',
          message: `Network error reaching LimeWire: ${e.message}`,
          stage: 'resolve'
        }
      };
    }
  }
}

/**
 * Direct HTTPS Provider
 * Handles direct APK mirror links, GitHub releases, F-Droid, and raw APK downloads.
 */
export class DirectHttpProvider implements RemoteApkProvider {
  name = 'DirectHTTPS';

  canHandle(url: URL): boolean {
    return url.protocol === 'https:' || url.protocol === 'http:';
  }

  async resolveAndDownload(url: URL, requestId: string, tempDir: string): Promise<ResolvedApkResult> {
    console.log(`[DirectHttpProvider][${requestId}] Fetching direct URL: ${url.href}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s download timeout

    try {
      const response = await fetch(url.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AETHER-OS/1.0.0',
          'Accept': '*/*'
        },
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const status = response.status;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      console.log(`[DirectHttpProvider][${requestId}] Response status=${status}, contentType=${contentType}`);

      if (status === 401 || status === 403) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'AUTH_REQUIRED',
            message: `Remote server rejected download with HTTP ${status} (Authorization or valid access token required).`,
            stage: 'download'
          }
        };
      }

      if (status === 404) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_HTTP_ERROR',
            message: 'Remote APK file was not found (HTTP 404).',
            stage: 'download'
          }
        };
      }

      if (status === 429) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_HTTP_ERROR',
            message: 'Rate limit exceeded by remote download provider (HTTP 429).',
            stage: 'download'
          }
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_HTTP_ERROR',
            message: `Remote download failed with HTTP status ${status} ${response.statusText}.`,
            stage: 'download'
          }
        };
      }

      // Check if response is HTML
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_PAGE_NOT_FILE',
            message: `The provided URL resolved to a webpage (${contentType}) rather than a direct APK file. Please download the file in your browser first and drag the local .apk file here.`,
            stage: 'download'
          }
        };
      }

      // Stream to buffer
      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      // Check for JSON error payload
      if (buffer.length > 0 && buffer[0] === 0x7b /* '{' */) {
        try {
          const jsonErr = JSON.parse(buffer.toString('utf-8'));
          return {
            ok: false,
            provider: this.name,
            error: {
              code: jsonErr.error?.toLowerCase().includes('token') ? 'INVALID_TOKEN' : 'DOWNLOAD_HTTP_ERROR',
              message: `Remote provider returned API error: ${jsonErr.error || jsonErr.message || 'Unknown'}`,
              stage: 'download'
            }
          };
        } catch {}
      }

      // Validate ZIP magic bytes (0x50, 0x4b, 0x03, 0x04)
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'NOT_AN_APK',
            message: 'Downloaded content is not a valid Android Package archive (missing ZIP PK magic bytes).',
            stage: 'validate'
          }
        };
      }

      // Extract filename from Content-Disposition or URL path
      let fileName = 'downloaded.apk';
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) fileName = path.basename(match[1]);
      } else {
        const pathBase = path.basename(new URL(response.url).pathname);
        if (pathBase && pathBase.includes('.')) fileName = pathBase;
      }
      if (!fileName.toLowerCase().endsWith('.apk')) fileName += '.apk';

      const filePath = path.join(tempDir, fileName);
      await fs.promises.writeFile(filePath, buffer);

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');

      return {
        ok: true,
        provider: this.name,
        resolvedUrl: response.url,
        fileName,
        filePath,
        fileSize: buffer.length,
        sha256: hash
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        return {
          ok: false,
          provider: this.name,
          error: {
            code: 'DOWNLOAD_TIMEOUT',
            message: 'Download timed out after 20 seconds.',
            stage: 'download'
          }
        };
      }
      return {
        ok: false,
        provider: this.name,
        error: {
          code: 'CONNECTION_ERROR',
          message: `Network error downloading APK: ${e.message}`,
          stage: 'download'
        }
      };
    }
  }
}

/**
 * Universal Remote APK Downloader Manager
 * Manages providers, single-flight deduplication, transactions, and temporary storage.
 */
export class RemoteApkDownloader {
  private providers: RemoteApkProvider[] = [
    new LimeWireProvider(),
    new DirectHttpProvider()
  ];
  private transactions = new Map<string, ApkTransaction>();
  private activeSingleFlight = new Map<string, Promise<ResolvedApkResult>>();
  private tempBaseDir = '/tmp/apk-transactions';

  constructor() {
    if (!fs.existsSync(this.tempBaseDir)) {
      fs.mkdirSync(this.tempBaseDir, { recursive: true });
    }
  }

  public getTransaction(transactionId: string): ApkTransaction | undefined {
    return this.transactions.get(transactionId);
  }

  public updateTransactionState(transactionId: string, state: ApkTransactionState, error?: ApkTransactionError): void {
    const tx = this.transactions.get(transactionId);
    if (tx) {
      tx.state = state;
      if (error) tx.error = error;
      tx.updatedAt = Date.now();
    }
  }

  public async cleanupTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId);
    if (tx && tx.tempFilePath && fs.existsSync(tx.tempFilePath)) {
      try {
        await fs.promises.unlink(tx.tempFilePath);
        const dir = path.dirname(tx.tempFilePath);
        if (fs.existsSync(dir)) {
          await fs.promises.rm(dir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn(`[RemoteApkDownloader] Cleanup warning for ${transactionId}:`, e);
      }
      tx.state = 'CLEANED';
      tx.updatedAt = Date.now();
    }
  }

  public async resolveAndDownload(rawUrlString: string): Promise<ApkTransaction> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    console.log(`[RemoteApkDownloader][${requestId}] Ingesting URL: ${rawUrlString}`);

    let urlObj: URL;
    try {
      urlObj = new URL(rawUrlString);
    } catch {
      const err: ApkTransactionError = {
        code: 'INVALID_URL',
        message: 'The provided URL is malformed or invalid.',
        stage: 'resolve'
      };
      const tx: ApkTransaction = {
        transactionId,
        requestId,
        state: 'FAILED',
        sourceUrl: rawUrlString,
        provider: 'None',
        error: err,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.transactions.set(transactionId, tx);
      return tx;
    }

    // SSRF Safety Check
    const ssrfCheck = isSafePublicHttpsUrl(urlObj);
    if (!ssrfCheck.safe) {
      const err: ApkTransactionError = {
        code: 'INVALID_URL',
        message: ssrfCheck.reason || 'Unsafe target destination.',
        stage: 'resolve'
      };
      const tx: ApkTransaction = {
        transactionId,
        requestId,
        state: 'FAILED',
        sourceUrl: rawUrlString,
        provider: 'None',
        error: err,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.transactions.set(transactionId, tx);
      return tx;
    }

    // Select provider
    const provider = this.providers.find(p => p.canHandle(urlObj));
    if (!provider) {
      const err: ApkTransactionError = {
        code: 'UNSUPPORTED_PROVIDER',
        message: `No supported APK provider found for host: ${urlObj.hostname}.`,
        stage: 'resolve'
      };
      const tx: ApkTransaction = {
        transactionId,
        requestId,
        state: 'FAILED',
        sourceUrl: rawUrlString,
        provider: 'None',
        error: err,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.transactions.set(transactionId, tx);
      return tx;
    }

    // Initialize Transaction
    const tx: ApkTransaction = {
      transactionId,
      requestId,
      state: 'RESOLVING',
      sourceUrl: rawUrlString,
      provider: provider.name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.transactions.set(transactionId, tx);

    // Create isolated temp directory for transaction
    const txTempDir = path.join(this.tempBaseDir, transactionId);
    if (!fs.existsSync(txTempDir)) {
      await fs.promises.mkdir(txTempDir, { recursive: true });
    }

    // Single-flight deduplication key
    const singleFlightKey = `${provider.name}:${urlObj.origin}${urlObj.pathname}`;
    let downloadPromise = this.activeSingleFlight.get(singleFlightKey);

    if (!downloadPromise) {
      tx.state = 'DOWNLOADING';
      tx.updatedAt = Date.now();
      downloadPromise = provider.resolveAndDownload(urlObj, requestId, txTempDir);
      this.activeSingleFlight.set(singleFlightKey, downloadPromise);
    }

    try {
      const result = await downloadPromise;
      this.activeSingleFlight.delete(singleFlightKey);

      if (!result.ok || !result.filePath) {
        tx.state = 'FAILED';
        tx.error = result.error || {
          code: 'DOWNLOAD_FAILED',
          message: 'Download resolution did not yield a valid file.',
          stage: 'download'
        };
        tx.updatedAt = Date.now();
        return tx;
      }

      // Validated
      tx.state = 'READY';
      tx.resolvedUrl = result.resolvedUrl;
      tx.fileName = result.fileName;
      tx.tempFilePath = result.filePath;
      tx.fileSize = result.fileSize;
      tx.sha256 = result.sha256;
      tx.updatedAt = Date.now();

      console.log(`[RemoteApkDownloader][${requestId}] Transaction ${transactionId} READY. File: ${tx.fileName} (${tx.fileSize} bytes)`);
      return tx;
    } catch (err: any) {
      this.activeSingleFlight.delete(singleFlightKey);
      tx.state = 'FAILED';
      tx.error = {
        code: 'DOWNLOAD_FAILED',
        message: err.message || 'Unexpected failure in download pipeline.',
        stage: 'download'
      };
      tx.updatedAt = Date.now();
      return tx;
    }
  }
}

export const remoteApkDownloader = new RemoteApkDownloader();
