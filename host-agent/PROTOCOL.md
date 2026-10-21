# Arclight Android Host Agent Protocol Specification

## 1. Overview
The Arclight Android Host Agent is a lightweight secure daemon running on a physical Linux host with KVM and Binder support (e.g., Waydroid host) or an authorized ADB-connected Android device. It exposes a TLS-secured REST API enabling Arclight OS to securely discover, pair, verify, and interact with the real Android runtime userspace.

## 2. Authentication & Security
- **Transport Security**: TLS 1.3 / HTTPS (or loopback HTTP for local daemon development).
- **Token Authorization**: Every request must include the header:
  `Authorization: Bearer <AUTH_TOKEN>`
- **Pairing Handshake**: Dynamic 6-digit PIN challenge verified on the host console before issuing long-lived access tokens.
- **Restricted Scope**: No unrestricted remote shell execution. Only scoped Android package manager, app launch, display streaming, and input forwarding operations are permitted.

## 3. Endpoints

### Health & Preflight
- `GET /api/health`
  - Returns agent uptime and status.
- `GET /api/preflight`
  - Probes host OS, architecture, Waydroid/ADB binaries, binder kernel driver status (`/dev/binder`), KVM (`/dev/kvm`), Android shell responsiveness, version, ABI, and package manager readiness.

### Pairing
- `POST /api/pairing/request`
  - Initiates pairing, generating a temporary 6-digit PIN challenge.
- `POST /api/pairing/verify`
  - Submits the PIN challenge and returns an authentication token upon success.

### Runtime Status & Info
- `GET /api/runtime/status`
  - Returns authoritative runtime status (`ANDROID_READY`, `DEGRADED`, `STOPPED`, etc.).
- `GET /api/android/version`
  - Returns Android release version (e.g., `14.0`).
- `GET /api/android/abi`
  - Returns CPU ABI (e.g., `x86_64`, `arm64-v8a`).
- `GET /api/android/packages`
  - Lists installed package names.
- `GET /api/android/packages/verify/:packageName`
  - Confirms if a specific package is installed.

### Package Installation & Execution
- `POST /api/android/packages/install`
  - Payload: `{ apkBase64: string, expectedSha256: string, packageName: string }`
  - Verifies hash, installs via `waydroid app install` or `adb install`, and verifies installation.
- `POST /api/android/packages/launch`
  - Payload: `{ packageName: string, activityName?: string }`
  - Launches the package.
