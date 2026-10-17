# Device Integrity and Tamper Detection Policy

SubTrackr is a cross-platform subscription management platform handling sensitive user data, automated recurring billing, Web3 wallet integrations, and payment credentials. To protect user assets and prevent token extraction or man-in-the-middle attacks on compromised environments, SubTrackr implements real-time **tamper, root, and jailbreak detection** coupled with a **graceful degradation** model.

---

## 1. Threat Model

A compromised mobile client poses substantial risks to subscription payment credentials, private key material, and local cache confidentiality:

| Threat Vector | Platform | Mechanism | Potential Impact |
| --- | --- | --- | --- |
| **Rooted Device (Superuser / Magisk)** | Android | Unrestricted `su` binaries, root daemon, Zygisk / Magisk modules | Bypassing OS sandbox, reading plaintext tokens from SQLite/AsyncStorage, memory scraping |
| **Jailbroken Device (Checkra1n, unc0ver, Taurine)** | iOS | Modified system partition, patched kernel / dyld, Cydia/Sileo package managers | Bypassing keychain protections, sandbox escape, hooking keychain APIs |
| **Dynamic Hooking & Instrumentation** | Both | Frida, Xposed Framework, Substrate, Cycript | Intercepting cryptographic signing, forging biometric auth success callbacks, altering payment amounts |
| **Runtime Debugging / Tampering** | Both | GDB/LLDB attachment, modified APK/IPA repackaging, patched prototypes | Stealing session secrets, modifying authorization headers in flight |
| **Simulated / Emulator Environments** | Both | Android SDK emulator, iOS Simulator | Testbed for automated credential stuffing or mock payment exploitation |

---

## 2. Detection Signals and Indicators

SubTrackr evaluates device posture across multiple defensive layers without relying on any single brittle check:

### 2.1 Android Root Indicators
- **Known Root Binaries & Paths**: Checks for standard binaries in system execution directories:
  - `/system/app/Superuser.apk`, `/sbin/su`, `/system/bin/su`, `/system/xbin/su`
  - `/data/local/xbin/su`, `/data/local/bin/su`, `/system/sd/xbin/su`
  - `/system/bin/failsafe/su`, `/data/local/su`, `/su/bin/su`
- **Magisk & Root Artifacts**:
  - `/sbin/.magisk`, `/data/adb/magisk`, `/cache/.disable_magisk`, `/data/adb/modules`
  - `/system/xbin/busybox`, `/system/bin/busybox`
- **Root Management Packages**: Detection of known manager identifiers:
  - `com.topjohnwu.magisk`, `eu.chainfire.supersu`, `com.koushikdutta.superuser`
  - `com.noshufou.android.su`, `com.kingroot.kinguser`, `com.thirdparty.superuser`
- **OS Build Integrity & Tags**: Inspection of `Build.TAGS` for `test-keys` indicating an unofficial or insecure third-party custom ROM.
- **Insecure System Properties**: Flags such as `ro.debuggable=1` or `ro.secure=0`.

### 2.2 iOS Jailbreak Indicators
- **Filesystem Paths & Tools**:
  - `/Applications/Cydia.app`, `/Applications/Sileo.app`, `/Applications/Zebra.app`
  - `/Library/MobileSubstrate/MobileSubstrate.dylib`
  - `/bin/bash`, `/bin/sh`, `/usr/sbin/sshd`, `/usr/bin/ssh`
  - `/etc/apt`, `/private/var/lib/apt/`, `/private/var/stash`
- **URL Schemes**: Probing for package manager registration:
  - `cydia://`, `sileo://`, `zbra://`, `undecimus://`
- **Sandbox Confinement Check**:
  - Attempting write operations outside the designated iOS sandbox container (e.g. `/private/`). On standard non-jailbroken systems, sandbox restrictions block the write; a successful write confirms jailbreak compromise.

### 2.3 Application Tampering & Hooking Indicators
- **Frida Framework Presence**: Detection of injected `globalThis.frida`, Frida agent threads, or runtime symbols.
- **Xposed Framework**: Detection of `globalThis.XposedBridge` or `de.robv.android.xposed`.
- **Prototype Tampering**: Verifying integrity of critical JavaScript primitives (e.g., verifying `Function.prototype.toString` retains native code signature).
- **Production Debugger Attachment**: Active debugger connection in production mode (`__DEV__ === false`).

---

## 3. Risk Classification

Signals are evaluated into four risk tiers:

| Tier | Risk Level | Description | Criteria |
| --- | --- | --- | --- |
| **0** | **Low (Intact)** | Standard production device | No root, jailbreak, tamper, or emulator indicators detected |
| **1** | **Medium (Emulated)** | Development / simulator runtime | Official simulator/emulator detected without root or hooking |
| **2** | **High (Suspicious)** | Suspicious modifications | Test-keys, insecure system properties, or debugger attached |
| **3** | **Critical (Compromised)**| Confirmed compromise | Root binaries found, Cydia/jailbreak paths present, or active Frida/Xposed hooks |

---

## 4. Graceful Degradation Policy

Rather than an abrupt process crash or unrecoverable lock screen (which frustrates legitimate users on edge cases and provides poor accessibility), SubTrackr **degrades gracefully**:
- **Safe features remain accessible** so users can always view their subscriptions, categories, analytics, documentation, and app settings.
- **High-risk financial operations are restricted** to prevent credential extraction, unauthorized payments, or private key exfiltration.

### 4.1 Operation Permission Matrix

| Operation | Low (Intact) | Medium (Emulated) | High (Suspicious) | Critical (Compromised) | Rationale |
| --- | :---: | :---: | :---: | :---: | --- |
| **View Subscriptions (`VIEW_SUBSCRIPTIONS`)** | Allowed | Allowed | Allowed | Allowed | Safe read-only data; preserves basic utility |
| **View Analytics (`VIEW_ANALYTICS`)** | Allowed | Allowed | Allowed | Allowed | Safe aggregated charts |
| **Manage Categories (`MANAGE_CATEGORIES`)** | Allowed | Allowed | Allowed | Allowed | Low-risk metadata organization |
| **Change App Settings (`CHANGE_SETTINGS`)** | Allowed | Allowed | Allowed | Allowed | Theme, locale, and presentation options |
| **Execute Payment (`EXECUTE_PAYMENT`)** | Allowed | Allowed | Blocked | Blocked | Prevents compromised client from authorizing card charges |
| **Sign Crypto Tx (`SIGN_TRANSACTION`)** | Allowed | Allowed | Blocked | Blocked | Protects Web3 wallets against memory scrapers / key theft |
| **Export Private Keys (`EXPORT_PRIVATE_KEYS`)** | Allowed | Allowed | Blocked | Blocked | Restricts raw key / seed phrase disclosure |
| **Biometric Auth (`BIOMETRIC_AUTH`)** | Allowed | Blocked | Blocked | Blocked | Biometrics on rooted devices can be hooked via Frida |
| **Export Sensitive Data (`EXPORT_SENSITIVE_DATA`)** | Allowed | Allowed | Blocked | Blocked | Disables unencrypted financial exports |
| **Persist Plaintext Tokens (`PERSIST_PLAINTEXT_TOKENS`)** | Allowed | Allowed | Allowed | Blocked | Tokens stored in ephemeral memory only on critical devices |

### 4.2 Degradation Enforcement

The service exposes programmatic assertion and checking APIs:

```typescript
import { deviceAttestationService, DeviceIntegrityError } from './services/auth/deviceAttestationService';

// Non-throwing check for UI conditionality
if (!deviceAttestationService.isOperationAllowed('SIGN_TRANSACTION')) {
  // Disable transaction button and display warning badge
}

// Throwing assertion for guard clauses in services/stores
try {
  deviceAttestationService.assertOperationAllowed('EXPORT_PRIVATE_KEYS');
  // proceed with export
} catch (error) {
  if (error instanceof DeviceIntegrityError) {
    // Graceful error notification explaining the restriction
  }
}
```

---

## 5. User Communication and Transparency

When a device is determined to be at High or Critical risk:
1. **Notice, Not Termination**: The app displays an accessible, non-blocking `DeviceIntegrityBanner` informing the user that restricted mode is active.
2. **Transparent Explanation**: Users can view the detected signals (e.g. `android_root_path:/sbin/su`) and understand why transactions are locked.
3. **Dismissable Alert**: Users can dismiss the warning to continue using read-only subscription tracking without interruption.

---

## 6. Developer and Testing Environments

To ensure developer productivity and CI testability:
- **Pluggable Probe Provider**: `deviceAttestationService.setCustomProbeProvider(provider)` enables mocking file checks, URL schemes, and system properties during unit and integration tests.
- **Simulators / Emulators**: In local development (`__DEV__ === true`), emulator indicators are classified as Medium risk, allowing development without false-positive blocks.
- **Cache TTL**: Attestation results are cached in AsyncStorage with a 24-hour expiration (`checkIntegrity(force?: boolean)`). Calling `checkIntegrity(true)` forces an immediate re-evaluation.

---

## 7. Compliance and Auditing

This policy adheres to:
- **OWASP Mobile Application Security Verification Standard (MASVS)**:
  - *MASVS-RESILIENCE-1*: Device integrity checks (root / jailbreak detection).
  - *MASVS-RESILIENCE-2*: Anti-tampering & reverse engineering resistance.
  - *MASVS-RESILIENCE-3*: Graceful degradation under compromised execution environments.
- **PCI DSS Section 6.5**: Protecting payment credentials on untrusted client endpoints.
