# Arclight Android Host Agent

Deployable host-agent daemon for connecting Arclight OS to a real Linux host (Waydroid / KVM / Binder) or an ADB-connected Android device.

## Prerequisites
- Linux OS (Ubuntu 22.04+ recommended) with KVM (`/dev/kvm`) and Binder (`/dev/binder`) support, OR an authorized Android device connected via ADB (`adb devices`).
- Node.js 18+ and npm / tsx.

## Setup Instructions

1. Clone or copy the `host-agent` directory to your target Linux host machine.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables (create `.env`):
   ```env
   PORT=8555
   AUTH_TOKEN=your-secure-secret-token
   ```

## Running the Host Agent (Foreground / Dev Mode)
```bash
npm run start
```
Or for watch mode:
```bash
npm run dev
```

## Health Check
Verify the agent is running:
```bash
curl -H "Authorization: Bearer your-secure-secret-token" http://localhost:8555/api/health
```

## Preflight Probe
Check full Android runtime readiness (Waydroid/ADB/Binder/KVM):
```bash
curl -H "Authorization: Bearer your-secure-secret-token" http://localhost:8555/api/preflight
```

## Secure Pairing Flow
1. Initiate pairing from Arclight OS Settings.
2. The host agent outputs a 6-digit PIN in the console logs.
3. Enter the PIN in Arclight OS to establish an authenticated TLS session.

## Uninstall Instructions
To remove the host agent and clean up temporary state:
```bash
rm -rf node_modules package-lock.json
```
