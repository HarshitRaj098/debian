# Implementation Plan: ARCLIGHT FIX 06 — Android Runtime Setup Wizard

## Objective
Create a user-friendly setup wizard within Arclight Settings to configure, pair, and verify the Android runtime connection.

## 1. UI Components
*   **AndroidSetupWizard.tsx**: New component in `/src/components/apps/settings/`.
*   **Wizard Steps**:
    1.  **Source Selection**: List available runtimes (Local Waydroid, ADB Device, Remote Host).
    2.  **Capability Check**: Automated scan based on `AndroidRuntimeManager` status.
        *   Explicitly show gVisor limitations.
    3.  **Connection Configuration**: Inputs for host/port (if Remote) or device selection (if ADB).
    4.  **Pairing**: UI to generate and enter pairing codes for secure connection.
    5.  **Verification**: Test connection, display stream, and input forwarding capabilities.

## 2. Service Integration
*   **AndroidConnectionManager**: New service to maintain connection state (`UNCONFIGURED`, `PAIRING`, `READY`, `ERROR`).
*   Extend `AndroidRuntimeManager` to expose pairing/configuration methods.

## 3. Pairing Flow (Security)
*   **Generation**: Agent generates a short-lived QR/Numeric code.
*   **Exchange**: Arclight UI requests the code and passes it to the host-agent connection.
*   **Handshake**: Use TLS 1.3 for secure communication after pairing.

## 4. gVisor Limitation Labeling
*   Clearly mark supported runtimes vs. restricted environments (e.g., "gVisor (Local Runtime Disabled)").
*   Guide user to Remote Host or ADB Device when gVisor is detected.
