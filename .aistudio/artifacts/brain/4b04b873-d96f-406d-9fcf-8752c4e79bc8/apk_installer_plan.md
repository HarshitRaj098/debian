# Implementation Plan: ARCLIGHT FIX 05 — Universal APK Installation Engine

## Objective
Implement a robust, end-to-end pipeline for downloading, validating, installing, verifying, and launching Android APKs within the Arclight environment using the real Android runtime.

## Phase 1: Infrastructure & Orchestration
- [ ] Create `UniversalAndroidInstaller` service in `src/services/UniversalAndroidInstaller.ts`.
- [ ] Integrate with `BrowserDownloadManager` (need to locate/define this) to hook into completed downloads.
- [ ] Implement `installLocalFile(path)` interface.

## Phase 2: APK Validation Engine
- [ ] Implement APK parsing (check file signature/header, size).
- [ ] Compatibility check (check target ABI against runtime ABI via `AndroidRuntimeManager`).
- [ ] File integrity check (content hashing).

## Phase 3: Installation & Verification
- [ ] Implement secure file transfer to the Android Host (using `RemoteAndroidAdapter` or `ADBDeviceAdapter`).
- [ ] Execute `adb install` via `AndroidRuntimeManager`.
- [ ] Implement verification logic (check if package appears in `AndroidPackageService.listPackages()`).
- [ ] Update `PackageRegistry` and trigger launcher UI refresh.

## Phase 4: Integration & Testing
- [ ] Integration with file picker/browser.
- [ ] Error handling and user feedback (status notifications).
- [ ] Test with `TestAPK.apk`.
- [ ] Test with real application (e.g., UC Browser).

## Constraints
- Do not hard-code app behavior.
- Reuse `AndroidRuntimeManager`, `AndroidPackageService`, `RemoteAndroidAdapter`.
- Ensure authenticated and secure transfer.
