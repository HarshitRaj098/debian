# Implementation Plan: Android Host Agent

## 1. Overview
The goal is to enable Arclight (running in gVisor) to interact with a real Android runtime by creating a secure `ArclightAndroidHostAgent` that runs on a capable host machine.

## 2. Architecture
- **Arclight (Client):** Uses `RemoteAndroidAdapter` to send authenticated, scoped requests.
- **Android Host Agent (Server):** A Node.js service running on the host, handling requests, interacting with Waydroid/ADB, and managing APKs securely.
- **Protocol:** HTTPS (TLS) with Bearer token authentication.

## 3. Phased Implementation

### Phase 1: Agent & Protocol Definition (Core)
- Define the `ArclightAndroidHostAgent` API contract (REST endpoints).
- Implement basic agent structure:
  - Host detection (OS, runtime status).
  - Authentication (token management).
  - Security measures (rate limiting, input validation).

### Phase 2: Runtime Adapter Integration
- Implement `WaydroidAdapter` (for Linux hosts).
- Implement `ADBDeviceAdapter` (for USB/TCP devices).
- Integrate APK transfer/installation pipeline with SHA-256 validation.

### Phase 3: Client-Side Integration
- Update `RemoteAndroidAdapter` in Arclight to match the new API.
- Implement pairing UI in `AndroidBridgeApp`.

### Phase 4: Display & Input
- Implement basic display streaming protocol (base64 frames).
- Implement input forwarding (tap, key).

### Phase 5: Testing & Acceptance
- Unit tests for security (auth, validation).
- Acceptance test using `TestAPK.apk` on a real host.

## 4. Key Security Considerations
- TLS required for all network communication.
- No shell execution endpoints.
- Scoped package management API only.
- Strict request size limits.

## 5. Acceptance Test Plan
- Verify pairing.
- Verify APK SHA-256 transfer integrity.
- Verify successful install by the Android package manager.
- Verify successful launch of TestAPK.
