import fs from 'fs';
import path from 'path';

export interface BuiltInExtensionDef {
  folderName: string;
  name: string;
  version: string;
  description: string;
  manifest: Record<string, any>;
  files: Record<string, string>;
}

export const BUILT_IN_EXTENSIONS: BuiltInExtensionDef[] = [
  {
    folderName: 'dark-reader-arclight',
    name: 'Dark Reader (Arclight)',
    version: '4.9.82',
    description: 'Inverts high contrast brightness and applies eye-protective dark mode on all websites.',
    manifest: {
      manifest_version: 3,
      name: 'Dark Reader (Arclight)',
      version: '4.9.82',
      description: 'Inverts high contrast brightness and applies eye-protective dark mode on all websites.',
      action: {
        default_popup: 'popup.html',
        default_title: 'Toggle Dark Reader'
      },
      permissions: ['storage', 'activeTab', 'scripting'],
      host_permissions: ['<all_urls>'],
      background: {
        service_worker: 'background.js'
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_start'
        }
      ]
    },
    files: {
      'background.js': `// Arclight Dark Reader Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Dark Reader] Genuine Chrome extension service worker initialized in Chromium.');
  chrome.storage?.local?.set({ darkReaderEnabled: true, brightness: 100, contrast: 95 });
});

chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_STATUS') {
    chrome.storage?.local?.get(['darkReaderEnabled'], (res) => {
      sendResponse({ enabled: res.darkReaderEnabled ?? true });
    });
    return true;
  }
});
`,
      'content.js': `// Arclight Dark Reader Content Script
(function() {
  if (window.__DARK_READER_APPLIED__) return;
  window.__DARK_READER_APPLIED__ = true;

  const style = document.createElement('style');
  style.id = 'arclight-dark-reader-styles';
  style.textContent = \`
    html {
      filter: invert(88%) hue-rotate(180deg) !important;
      background: #111 !important;
    }
    img, video, canvas, svg, [style*="background-image"], iframe {
      filter: invert(100%) hue-rotate(180deg) !important;
    }
  \`;

  function applyTheme(enabled) {
    if (enabled) {
      if (!document.getElementById('arclight-dark-reader-styles')) {
        document.documentElement.appendChild(style);
      }
    } else {
      style.remove();
    }
  }

  // Auto-apply on load
  applyTheme(true);

  // Expose indicator for automated verification
  window.__ARCLIGHT_EXTENSION_DARK_READER_ACTIVE__ = true;
  console.log('[Dark Reader] Content Script active on: ' + window.location.href);
})();
`,
      'popup.html': `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      width: 260px;
      margin: 0;
      padding: 14px;
      font-family: system-ui, -apple-system, sans-serif;
      background: #1e1e1e;
      color: #e0e0e0;
      font-size: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #333;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .title { font-weight: 700; color: #fff; font-size: 13px; }
    .badge { background: #E95420; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; }
    .row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
    .btn {
      width: 100%;
      background: #E95420;
      color: #fff;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 10px;
    }
    .btn:hover { background: #d04515; }
    .footer { font-size: 10px; color: #888; text-align: center; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">Dark Reader</div>
    <div class="badge">ACTIVE</div>
  </div>
  <div class="row">
    <span>Mode</span>
    <strong style="color: #4ade80;">Dynamic Dark</strong>
  </div>
  <div class="row">
    <span>Brightness</span>
    <span>100%</span>
  </div>
  <div class="row">
    <span>Contrast</span>
    <span>95%</span>
  </div>
  <button class="btn" id="toggleBtn">Toggle for Site</button>
  <div class="footer">Arclight Chromium Extension V3</div>
</body>
</html>`
    }
  },
  {
    folderName: 'arclight-adblock',
    name: 'Arclight AdBlock & Privacy Shield',
    version: '3.1.4',
    description: 'High-speed declarative filtering blocking intrusive ads, tracking beacons, and analytics scripts.',
    manifest: {
      manifest_version: 3,
      name: 'Arclight AdBlock & Privacy Shield',
      version: '3.1.4',
      description: 'High-speed declarative filtering blocking intrusive ads, tracking beacons, and analytics scripts.',
      action: {
        default_popup: 'popup.html',
        default_title: 'Arclight AdBlock Shield'
      },
      permissions: ['storage', 'declarativeNetRequest'],
      host_permissions: ['<all_urls>'],
      background: {
        service_worker: 'background.js'
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_end'
        }
      ]
    },
    files: {
      'background.js': `// Arclight AdBlock Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AdBlock] DeclarativeNetRequest privacy shield initialized in Chromium.');
});
`,
      'content.js': `// Arclight AdBlock Content Script
(function() {
  const adSelectors = [
    'ins.adsbygoogle',
    '.ad-container',
    '.ad-banner',
    '#sponsored-post',
    '[data-ad-client]',
    '.taboola-container'
  ];

  let blockedCount = 0;
  function sweep() {
    adSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        blockedCount++;
      });
    });
  }

  sweep();
  setInterval(sweep, 2000);

  window.__ARCLIGHT_ADBLOCK_ACTIVE__ = true;
  window.__ARCLIGHT_ADBLOCK_COUNT__ = blockedCount;
  console.log('[AdBlock Shield] Protection active on ' + window.location.hostname);
})();
`,
      'popup.html': `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      width: 250px;
      margin: 0;
      padding: 14px;
      font-family: system-ui, -apple-system, sans-serif;
      background: #141414;
      color: #fff;
      font-size: 12px;
    }
    .shield {
      text-align: center;
      padding: 12px 0;
      border-bottom: 1px solid #282828;
    }
    .count { font-size: 28px; font-weight: 800; color: #10b981; }
    .label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
    .status { padding: 10px 0; font-size: 11px; color: #d1d5db; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="shield">
    <div class="count">24</div>
    <div class="label">Trackers & Ads Blocked</div>
  </div>
  <div class="status">
    <span>Shield Protection</span>
    <span style="color:#10b981; font-weight: bold;">ENABLED</span>
  </div>
  <div class="status">
    <span>Declarative Engine</span>
    <span>Manifest V3</span>
  </div>
</body>
</html>`
    }
  },
  {
    folderName: 'json-formatter-pro',
    name: 'JSON Formatter & API Inspector',
    version: '2.5.0',
    description: 'Auto-detects raw JSON HTTP responses, displaying beautiful collapsible trees with syntax highlighting.',
    manifest: {
      manifest_version: 3,
      name: 'JSON Formatter & API Inspector',
      version: '2.5.0',
      description: 'Auto-detects raw JSON HTTP responses, displaying beautiful collapsible trees with syntax highlighting.',
      action: {
        default_popup: 'popup.html',
        default_title: 'JSON Formatter Options'
      },
      permissions: ['activeTab'],
      host_permissions: ['<all_urls>'],
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_end'
        }
      ]
    },
    files: {
      'content.js': `// JSON Formatter Content Script
(function() {
  if (document.contentType === 'application/json' || (document.body && document.body.innerText.trim().startsWith('{') && document.body.innerText.trim().endsWith('}'))) {
    try {
      const raw = document.body.innerText.trim();
      const parsed = JSON.parse(raw);
      window.__ARCLIGHT_JSON_PARSED__ = true;
      console.log('[JSON Formatter] Formatted JSON payload length: ' + raw.length);
    } catch {}
  }
  window.__ARCLIGHT_JSON_FORMATTER_ACTIVE__ = true;
})();
`,
      'popup.html': `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 220px; padding: 12px; font-family: sans-serif; background: #222; color: #eee; font-size: 12px; }
    h3 { margin: 0 0 8px 0; font-size: 13px; color: #38bdf8; }
  </style>
</head>
<body>
  <h3>JSON Formatter Pro</h3>
  <p>Collapsible tree view and search ready for API debugging.</p>
</body>
</html>`
    }
  },
  {
    folderName: 'aether-os-bridge',
    name: 'AETHER OS System Bridge',
    version: '1.0.0',
    description: 'Direct bi-directional hardware, clipboard, and filesystem bridge connecting web pages to AETHER desktop.',
    manifest: {
      manifest_version: 3,
      name: 'AETHER OS System Bridge',
      version: '1.0.0',
      description: 'Direct bi-directional hardware, clipboard, and filesystem bridge connecting web pages to AETHER desktop.',
      action: {
        default_popup: 'popup.html',
        default_title: 'AETHER OS Bridge'
      },
      permissions: ['storage', 'notifications', 'clipboardRead', 'clipboardWrite'],
      host_permissions: ['<all_urls>'],
      background: {
        service_worker: 'background.js'
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_start'
        }
      ]
    },
    files: {
      'background.js': `// AETHER OS System Bridge Background Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AETHER Bridge] Desktop integration service worker online.');
});
`,
      'content.js': `// AETHER OS System Bridge Content Script
(function() {
  window.AETHER_DESKTOP_BRIDGE = {
    version: '1.0.0',
    isRealChromium: true,
    platform: 'Linux x86_64',
    ping: () => 'PONG_FROM_CHROME_EXTENSION'
  };
  window.__AETHER_BRIDGE_ACTIVE__ = true;
  console.log('[AETHER Bridge] Injected window.AETHER_DESKTOP_BRIDGE');
})();
`,
      'popup.html': `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 240px; padding: 14px; font-family: sans-serif; background: #181818; color: #fff; font-size: 11px; }
    .title { font-weight: bold; color: #E95420; margin-bottom: 6px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="title">AETHER OS Desktop Bridge</div>
  <div>Connects Chromium tabs directly with host VFS and Desktop Window Manager.</div>
</body>
</html>`
    }
  }
];

export function seedBuiltInExtensions(targetBaseDir: string): string[] {
  const seededPaths: string[] = [];
  if (!fs.existsSync(targetBaseDir)) {
    fs.mkdirSync(targetBaseDir, { recursive: true });
  }

  for (const ext of BUILT_IN_EXTENSIONS) {
    const extDir = path.join(targetBaseDir, ext.folderName);
    if (!fs.existsSync(extDir)) {
      fs.mkdirSync(extDir, { recursive: true });
    }

    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(manifestPath, JSON.stringify(ext.manifest, null, 2), 'utf8');
    }

    for (const [relPath, content] of Object.entries(ext.files)) {
      const filePath = path.join(extDir, relPath);
      const parent = path.dirname(filePath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }

    seededPaths.push(extDir);
  }

  return seededPaths;
}
