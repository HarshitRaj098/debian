# Implementation Plan: Android Display & Input Bridge

## 1. Overview
Enable real-time interactive control of an Android runtime from the Arclight environment by bridging the display and input systems via the authenticated `ArclightAndroidHostAgent`.

## 2. Phased Implementation

### Phase 1: Host Agent Enhancements
- Extend `ArclightAndroidHostAgent` API:
  - `GET /android/display/frame`: Capture current screen (screencap).
  - `POST /android/input`: Forward mouse/keyboard/touch events.

### Phase 2: AndroidBridge Display Integration
- Update `AndroidDisplayStream` to fetch and render frames efficiently.
- Coordinate input mapping between the Arclight window coordinates and the Android display resolution.

### Phase 3: Interactive Window
- Enhance `AndroidBridgeApp` UI to:
  - Render the display frame on an HTML `<canvas>`.
  - Capture mouse, keyboard, and touch events on the canvas.
  - Forward events via `AndroidInputBridge` to the Host Agent.

### Phase 4: Verification
- Verify frame latency and input responsiveness using `TestAPK`.
- Implement stream auto-reconnection and state synchronization.

## 3. Implementation Priority
1. **API Extensions**: Implement secure frame capture and input injection in `host-agent`.
2. **Display Streaming**: Implement frame rendering loop in `AndroidBridgeApp`.
3. **Input Bridge**: Map and forward user inputs.
4. **Resilience**: Add reconnection and error handling.
