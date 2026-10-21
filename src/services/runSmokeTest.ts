import { apkE2EEngine } from './ApkE2EEngine';
import path from 'path';
import fs from 'fs';

async function run() {
  const testApk = path.join('/home/ubuntu/Downloads', 'Cinema.apk');
  console.log(`[SESSION_TEST] Running Android session readiness check on: ${testApk}`);
  
  if (!fs.existsSync(testApk)) {
    fs.mkdirSync(path.dirname(testApk), { recursive: true });
    fs.writeFileSync(testApk, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));
  }

  const tx = await apkE2EEngine.executeInstallPipeline(testApk, `sess-${Date.now()}`);
  const report = apkE2EEngine.formatReport(tx);
  console.log('\n========================================');
  console.log(report);
  console.log('========================================\n');
}

run().catch(console.error);
