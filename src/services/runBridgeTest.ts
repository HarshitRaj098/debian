import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { androidDesktopBridge, BridgeRequestContext } from './AndroidDesktopBridge';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function runBridgeTests() {
  console.log('================================================================');
  console.log('Ω∞ — ANDROID DESKTOP BRIDGE AUTOMATED TEST SUITE');
  console.log('================================================================');

  const results: TestResult[] = [];

  const record = async (id: string, name: string, fn: () => Promise<string>) => {
    try {
      const details = await fn();
      results.push({ id, name, passed: true, details });
      console.log(`[PASS] ${id}: ${name} -> ${details}`);
    } catch (err: any) {
      results.push({ id, name, passed: false, details: err.message });
      console.error(`[FAIL] ${id}: ${name} -> ${err.message}`);
    }
  };

  // 1. Authorized vs Unauthorized Requests
  await record('T01_AUTHORIZED_REQUEST', 'Allow valid notifications request from verified package', async () => {
    const ctx: BridgeRequestContext = {
      packageName: 'com.example.testapk',
      capability: 'NOTIFICATIONS',
      operation: 'SHOW',
      payload: { title: 'Test', body: 'Hello' },
      timestamp: new Date().toISOString(),
      correlationId: 'corr-1'
    };
    const res = await androidDesktopBridge.executeBridgeRequest(ctx, {
      onNotification: () => {}
    });
    assert(res.success === true, `Expected success=true, got ${res.success}`);
    assert(res.decision === 'ALLOW', `Expected decision=ALLOW, got ${res.decision}`);
    return `Decision=${res.decision}, Success=${res.success}`;
  });

  await record('T02_UNAUTHORIZED_MALFORMED_PACKAGE', 'Deny request with invalid or malformed package identifier', async () => {
    const ctx: BridgeRequestContext = {
      packageName: 'malformed_pkg_name',
      capability: 'NOTIFICATIONS',
      operation: 'SHOW',
      payload: { title: 'Test', body: 'Hello' },
      timestamp: new Date().toISOString(),
      correlationId: 'corr-2'
    };
    const res = await androidDesktopBridge.executeBridgeRequest(ctx, {});
    assert(res.success === false, `Expected success=false`);
    assert(res.decision === 'DENY', `Expected decision=DENY, got ${res.decision}`);
    return `Decision=${res.decision}, Reason=${res.message}`;
  });

  // 2. Permission Approval & User Prompt
  await record('T03_USER_PROMPT_POLICY', 'Require user confirmation for scoped file access or clipboard read', async () => {
    const ctx: BridgeRequestContext = {
      packageName: 'com.example.testapk',
      capability: 'CLIPBOARD',
      operation: 'READ',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-3'
    };
    const res = await androidDesktopBridge.executeBridgeRequest(ctx, {});
    assert(res.success === false, `Expected success=false`);
    assert(res.decision === 'USER_PROMPT', `Expected decision=USER_PROMPT, got ${res.decision}`);
    return `Decision=${res.decision}`;
  });

  // 3. Clipboard Access & Audit Logging
  await record('T04_CLIPBOARD_WRITE_AND_READ', 'Allow clipboard write and audit log recording', async () => {
    const writeCtx: BridgeRequestContext = {
      packageName: 'com.example.testapk',
      capability: 'CLIPBOARD',
      operation: 'WRITE',
      payload: { action: 'WRITE', text: 'Hello Arclight Desktop' },
      timestamp: new Date().toISOString(),
      correlationId: 'corr-4'
    };
    const writeRes = await androidDesktopBridge.executeBridgeRequest(writeCtx, {});
    assert(writeRes.success === true, `Clipboard write failed`);

    const auditLog = androidDesktopBridge.getAuditLog();
    assert(auditLog.length > 0, 'Expected audit log entries');
    assert(auditLog[0].packageName === 'com.example.testapk', 'Audit log package mismatch');
    return `AuditEntries=${auditLog.length}, LastDecision=${auditLog[0].decision}`;
  });

  // 4. File Selection & Path Traversal Prevention
  await record('T05_SAFE_FILE_SAVE', 'Save shared file safely into shared directory with sanitized name', async () => {
    const ctx: BridgeRequestContext = {
      packageName: 'com.example.testapk',
      capability: 'FILE_ACCESS',
      operation: 'SAVE',
      payload: { action: 'SAVE', suggestedName: '../../etc/passwd', dataBase64: Buffer.from('test').toString('base64') },
      timestamp: new Date().toISOString(),
      correlationId: 'corr-5'
    };
    const res = await androidDesktopBridge.executeBridgeRequest(ctx, {});
    // Should trigger USER_PROMPT or deny path traversal
    assert(res.success === false || res.decision === 'USER_PROMPT', 'Expected user prompt or denial for file access');
    return `Decision=${res.decision}, Message=${res.message}`;
  });

  // 5. Audio Resource Cleanup
  await record('T06_AUDIO_RESOURCE_CLEANUP', 'Release active audio streams when app terminates', async () => {
    const playCtx: BridgeRequestContext = {
      packageName: 'com.example.testapk',
      capability: 'AUDIO',
      operation: 'PLAY',
      payload: { action: 'PLAY' },
      timestamp: new Date().toISOString(),
      correlationId: 'corr-6'
    };
    await androidDesktopBridge.executeBridgeRequest(playCtx, {});

    const cleanup = androidDesktopBridge.cleanupAppResources('com.example.testapk');
    assert(cleanup.audioStreamsReleased === 1, `Expected 1 stream released, got ${cleanup.audioStreamsReleased}`);
    return `StreamsReleased=${cleanup.audioStreamsReleased}`;
  });

  console.log('----------------------------------------------------------------');
  const passed = results.filter(r => r.passed).length;
  console.log(`DESKTOP BRIDGE TESTS SUMMARY: ${passed}/${results.length} PASSED`);
  console.log('================================================================');

  if (passed !== results.length) {
    process.exit(1);
  }
}

runBridgeTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
