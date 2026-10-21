import fs from 'fs';
import path from 'path';
import { arclightChromiumEngine } from './ArclightChromiumEngine';

function printHelp() {
  console.log(`
============================================================
ARCLIGHT CHROMIUM CLI — BROWSER COMMAND-LINE INTERFACE
============================================================
Usage:
  browser <command> [arguments...]

Commands:
  open <url>               Navigate active tab to URL (or search Google)
  new [url]                Open a new browser tab with optional URL
  tabs                     List all currently open tabs
  close <tabId>            Close a tab by its ID
  dump <url>               Fetch & print rendered page DOM text
  screenshot <url> [file]  Capture screenshot to file (default: /home/ubuntu/screenshot.jpg)
  eval "<javascript>"      Evaluate JS expression in the active tab via CDP
  extensions               List all installed Chrome extensions & statuses
  toggle-ext <id> <on|off> Enable or disable an installed extension
  load-ext <path>          Install and load an unpacked extension directory
  doctor                   Run comprehensive 10-point browser & extensions audit
  status                   Show Chromium PID, CDP port, memory, and engine health
  help                     Show this help message

Examples:
  browser open https://github.com
  browser screenshot https://news.ycombinator.com /home/ubuntu/hn.jpg
  browser eval "document.title"
  browser extensions
  browser doctor
============================================================
`);
}

async function main() {
  const args = process.argv.slice(2);
  const subcommand = (args[0] || 'help').toLowerCase();

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    process.exit(0);
  }

  await arclightChromiumEngine.init();

  if (subcommand === 'status') {
    const st = arclightChromiumEngine.getEngineStatus();
    console.log('Chromium Engine Status:');
    console.log(`  Engine Verdict    : ${st.engineVerdict}`);
    console.log(`  Binary Path       : ${st.executablePath}`);
    console.log(`  Engine Version    : ${st.version}`);
    console.log(`  Process PID       : ${st.pid || 'SUPERVISED'}`);
    console.log(`  CDP Debug Port    : ${st.cdpPort} (${st.cdpUrl})`);
    console.log(`  Profile Directory : ${st.profileDir}`);
    console.log(`  Active Extensions : ${st.activeExtensionsCount} / ${st.extensionsCount}`);
    process.exit(0);
  }

  if (subcommand === 'doctor') {
    const report = await arclightChromiumEngine.runBrowserDoctor();
    console.log('============================================================');
    console.log('ARCLIGHT BROWSER DOCTOR — REAL CHROMIUM & EXTENSIONS AUDIT');
    console.log('Timestamp          :', report.timestamp);
    console.log('Overall Status     :', report.overallStatus);
    console.log('Chromium Engine    :', report.chromiumVersion);
    console.log('Process PID        :', report.pid || 'SUPERVISED');
    console.log('CDP Debugging Port :', report.cdpPort);
    console.log('Profile Directory  :', report.profileDir);
    const activeExts = report.activeExtensions || [];
    console.log('Active Extensions  :', activeExts.length);
    console.log('============================================================');
    console.log('\n[1] 10-STAGE BROWSER RUNTIME INSPECTION:');
    for (const c of report.checks || []) {
      const paddedItem = (c.item || c.domain || 'CHECK').toUpperCase().padEnd(30, ' ');
      const paddedStatus = (c.status || c.verdict || 'WARN').padEnd(6, ' ');
      console.log(`  ${paddedItem} | ${paddedStatus} | ${c.evidence}`);
    }

    console.log('\n[2] ACTIVE GENUINE CHROME EXTENSIONS:');
    for (const ext of activeExts) {
      console.log(`  - [${ext.id}] ${ext.name} (v${ext.version}) [${ext.runtimeType}]`);
      console.log(`    Permissions: ${ext.permissions.join(', ') || 'none'}`);
      console.log(`    Dir: ${ext.dirPath}`);
    }

    console.log('\n[3] ENGINE VERDICT:');
    console.log(`  ${report.summary}`);
    console.log('============================================================\n');
    process.exit(report.overallStatus === 'CHROMIUM_READY' ? 0 : 1);
  }

  if (subcommand === 'tabs') {
    const tabs = await arclightChromiumEngine.getTabs();
    console.log(`\nActive Browser Tabs (${tabs.length}):`);
    if (tabs.length === 0) {
      console.log('  No open tabs.');
    } else {
      tabs.forEach((t, i) => {
        console.log(`  [${i + 1}] ID: ${t.id}`);
        console.log(`      Title: "${t.title}"`);
        console.log(`      URL  : ${t.url}`);
      });
    }
    console.log('');
    process.exit(0);
  }

  if (subcommand === 'new') {
    const targetUrl = args[1] || 'https://www.google.com';
    console.log(`Opening new tab to: ${targetUrl}...`);
    const tab = await arclightChromiumEngine.createTab(targetUrl);
    if (tab) {
      console.log(`Tab created: ID=${tab.id}, Title="${tab.title}", URL=${tab.url}`);
    } else {
      console.error('Failed to create tab.');
      process.exit(1);
    }
    process.exit(0);
  }

  if (subcommand === 'close') {
    const tabId = args[1];
    if (!tabId) {
      console.error('Error: specify tabId to close. Run "browser tabs" to list tabs.');
      process.exit(1);
    }
    const closed = await arclightChromiumEngine.closeTab(tabId);
    console.log(closed ? `Tab ${tabId} closed.` : `Failed to close tab ${tabId}.`);
    process.exit(closed ? 0 : 1);
  }

  if (subcommand === 'open') {
    const targetUrl = args[1];
    if (!targetUrl) {
      console.error('Error: specify URL to open. Example: browser open https://github.com');
      process.exit(1);
    }

    const tabs = await arclightChromiumEngine.getTabs();
    const tab = tabs[0] || (await arclightChromiumEngine.createTab(targetUrl));
    if (!tab) {
      console.error('Could not get or create active tab.');
      process.exit(1);
    }

    console.log(`Navigating tab ${tab.id} to: ${targetUrl}...`);
    const res = await arclightChromiumEngine.navigate(tab.id, targetUrl);
    console.log(`Result: Title="${res.title}", URL="${res.url}"`);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'dump') {
    const targetUrl = args[1];
    if (!targetUrl) {
      console.error('Error: specify URL to dump. Example: browser dump https://example.com');
      process.exit(1);
    }

    const tab = await arclightChromiumEngine.createTab(targetUrl);
    if (!tab) {
      console.error('Failed to create tab for dump.');
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 1200));
    const evalRes: any = await arclightChromiumEngine.executeCdpCommand(tab.id, 'Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : document.documentElement.outerHTML'
    });

    console.log(evalRes?.result?.value || 'No content returned');
    await arclightChromiumEngine.closeTab(tab.id);
    process.exit(0);
  }

  if (subcommand === 'screenshot') {
    const targetUrl = args[1];
    const outputPath = args[2] || '/home/ubuntu/screenshot.jpg';
    if (!targetUrl) {
      console.error('Error: specify URL. Example: browser screenshot https://example.com /home/ubuntu/shot.jpg');
      process.exit(1);
    }

    console.log(`Navigating to ${targetUrl}...`);
    const tab = await arclightChromiumEngine.createTab(targetUrl);
    if (!tab) {
      console.error('Failed to create tab.');
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 1500));
    console.log(`Capturing frame via CDP...`);
    const frame = await arclightChromiumEngine.captureFrame(tab.id, 90);
    if (frame) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, frame);
      console.log(`Screenshot saved to: ${outputPath} (${frame.length} bytes)`);
    } else {
      console.error('Failed to capture frame.');
      process.exit(1);
    }

    await arclightChromiumEngine.closeTab(tab.id);
    process.exit(0);
  }

  if (subcommand === 'eval') {
    const expression = args.slice(1).join(' ');
    if (!expression) {
      console.error('Error: specify expression to evaluate. Example: browser eval "document.title"');
      process.exit(1);
    }

    const tabs = await arclightChromiumEngine.getTabs();
    if (tabs.length === 0) {
      console.error('No open tabs to evaluate script in.');
      process.exit(1);
    }

    const targetTab = tabs[0];
    const evalRes: any = await arclightChromiumEngine.executeCdpCommand(targetTab.id, 'Runtime.evaluate', {
      expression
    });

    console.log('Result:', evalRes?.result?.value ?? evalRes?.result);
    process.exit(0);
  }

  if (subcommand === 'extensions') {
    const exts = arclightChromiumEngine.getInstalledExtensions();
    console.log(`\nInstalled Genuine Chrome Extensions (${exts.length}):`);
    exts.forEach((e) => {
      const status = e.enabled ? '[ENABLED]' : '[DISABLED]';
      console.log(`  ${status} ${e.name} (v${e.version}) - ID: ${e.id}`);
      console.log(`      Manifest: ${e.runtimeType} | Source: ${e.source}`);
      console.log(`      Permissions: ${e.permissions.join(', ') || 'none'}`);
      console.log(`      Path: ${e.dirPath}`);
    });
    console.log('');
    process.exit(0);
  }

  if (subcommand === 'toggle-ext') {
    const extId = args[1];
    const mode = (args[2] || '').toLowerCase();
    if (!extId || (mode !== 'on' && mode !== 'off')) {
      console.error('Usage: browser toggle-ext <extId> <on|off>');
      process.exit(1);
    }

    const enabled = mode === 'on';
    const res = await arclightChromiumEngine.toggleExtension(extId, enabled);
    console.log(`Extension ${extId} is now ${enabled ? 'ENABLED' : 'DISABLED'}. (Chromium restarted: ${res.restarted})`);
    process.exit(0);
  }

  if (subcommand === 'load-ext') {
    const sourcePath = args[1];
    if (!sourcePath) {
      console.error('Usage: browser load-ext <path_to_extension_folder>');
      process.exit(1);
    }

    const res = await arclightChromiumEngine.installUnpackedExtension(sourcePath);
    console.log(res.message);
    process.exit(res.success ? 0 : 1);
  }

  if (subcommand === 'test') {
    console.log('Running automated navigation and extension DOM injection test...');
    const tabs = await arclightChromiumEngine.getTabs();
    const tab = tabs[0] || (await arclightChromiumEngine.createTab('https://example.com'));
    if (!tab) {
      console.error('Failed to obtain browser tab');
      process.exit(1);
    }

    console.log(`Navigating tab ${tab.id} to https://example.com...`);
    const nav = await arclightChromiumEngine.navigate(tab.id, 'https://example.com');
    console.log(`Navigation Result: title="${nav.title}", url="${nav.url}"`);

    await new Promise(r => setTimeout(r, 1500));
    const frame = await arclightChromiumEngine.captureFrame(tab.id, 80);
    console.log(`Captured frame size: ${frame?.length || 0} bytes`);

    const evalRes: any = await arclightChromiumEngine.executeCdpCommand(tab.id, 'Runtime.evaluate', {
      expression: '({ darkReader: !!window.__ARCLIGHT_EXTENSION_DARK_READER_ACTIVE__, adblock: !!window.__ARCLIGHT_ADBLOCK_ACTIVE__, bridge: !!window.AETHER_DESKTOP_BRIDGE })'
    });
    console.log('DOM Extension Inspection Results:', evalRes?.result?.value);
    console.log('REAL CHROMIUM TEST COMPLETED SUCCESSFULLY.');
    process.exit(0);
  }

  console.error(`Unknown subcommand: ${subcommand}`);
  printHelp();
  process.exit(1);
}

main().catch(err => {
  console.error('Error running browserCli:', err);
  process.exit(1);
});
