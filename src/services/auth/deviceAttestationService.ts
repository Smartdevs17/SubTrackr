import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking } from 'react-native';

const DEVICE_INTEGRITY_KEY = '@subtrackr/device_integrity';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type SensitiveOperation =
  | 'VIEW_SUBSCRIPTIONS'
  | 'VIEW_ANALYTICS'
  | 'MANAGE_CATEGORIES'
  | 'CHANGE_SETTINGS'
  | 'READ_DOCUMENTATION'
  | 'EXECUTE_PAYMENT'
  | 'SIGN_TRANSACTION'
  | 'EXPORT_PRIVATE_KEYS'
  | 'BIOMETRIC_AUTH'
  | 'EXPORT_SENSITIVE_DATA'
  | 'PERSIST_PLAINTEXT_TOKENS';

export interface DegradationPolicy {
  riskLevel: RiskLevel;
  allowBasicAccess: boolean;
  allowSensitiveTransactions: boolean;
  allowBiometrics: boolean;
  allowLocalKeyExport: boolean;
  allowOfflineSecretsStorage: boolean;
  requireStepUpAuth: boolean;
  warningMessage?: string;
}

export interface DeviceIntegrityResult {
  isIntact: boolean;
  isRooted: boolean;
  isJailbroken: boolean;
  isEmulator: boolean;
  isTampered: boolean;
  riskLevel: RiskLevel;
  compromiseIndicators: string[];
  degradationPolicy: DegradationPolicy;
  attestedAt: number;
}

export class DeviceIntegrityError extends Error {
  readonly riskLevel: RiskLevel;
  readonly operation: SensitiveOperation;
  readonly indicators: string[];

  constructor(operation: SensitiveOperation, riskLevel: RiskLevel, indicators: string[]) {
    super(
      `Operation "${operation}" is restricted due to compromised device integrity (risk: ${riskLevel}). Indicators: ${indicators.join(', ')}`
    );
    this.name = 'DeviceIntegrityError';
    this.riskLevel = riskLevel;
    this.operation = operation;
    this.indicators = indicators;
  }
}

/**
 * Common file system paths indicating a rooted Android device.
 */
export const ANDROID_ROOT_PATHS = [
  '/system/app/Superuser.apk',
  '/system/app/Superuser/Superuser.apk',
  '/system/priv-app/Superuser.apk',
  '/sbin/su',
  '/system/bin/su',
  '/system/xbin/su',
  '/data/local/xbin/su',
  '/data/local/bin/su',
  '/system/sd/xbin/su',
  '/system/bin/failsafe/su',
  '/data/local/su',
  '/su/bin/su',
  '/su/xbin/su',
  '/system/xbin/daemonsu',
  '/system/etc/init.d/99SuperSUDaemon',
  '/sbin/.magisk',
  '/data/adb/magisk',
  '/cache/.disable_magisk',
  '/data/adb/modules',
  '/system/xbin/busybox',
  '/system/bin/busybox',
];

/**
 * Common package names associated with Android root managers.
 */
export const ANDROID_ROOT_PACKAGES = [
  'com.topjohnwu.magisk',
  'eu.chainfire.supersu',
  'com.koushikdutta.superuser',
  'com.noshufou.android.su',
  'com.kingroot.kinguser',
  'com.thirdparty.superuser',
  'com.yellowes.su',
  'com.chelpus.lackypatch',
  'com.ramdroid.appquarantine',
];

/**
 * Common paths indicating a jailbroken iOS device.
 */
export const IOS_JAILBREAK_PATHS = [
  '/Applications/Cydia.app',
  '/Applications/Sileo.app',
  '/Applications/Zebra.app',
  '/Applications/blackra1n.app',
  '/Library/MobileSubstrate/MobileSubstrate.dylib',
  '/Library/PreferenceBundles/SubstitutePrefs.bundle',
  '/Library/PreferenceBundles/CydiaSubstratePrefs.bundle',
  '/bin/bash',
  '/bin/sh',
  '/usr/sbin/sshd',
  '/usr/libexec/ssh-keysign',
  '/etc/apt',
  '/etc/ssh/sshd_config',
  '/private/var/lib/apt/',
  '/private/var/lib/cydia',
  '/private/var/stash',
  '/private/var/tmp/cydia.log',
  '/usr/bin/ssh',
  '/var/binpack',
  '/var/checkra1n.dylib',
];

/**
 * Custom URL schemes registered by jailbreak package managers.
 */
export const IOS_JAILBREAK_SCHEMES = ['cydia://', 'sileo://', 'zbra://', 'undecimus://'];

/**
 * Pluggable probe provider to allow native module integration or test mocking.
 */
export interface IntegrityProbeProvider {
  checkPathsExist?: (paths: string[]) => Promise<string[]> | string[];
  checkUrlSchemes?: (schemes: string[]) => Promise<string[]> | string[];
  canWriteRestrictedPath?: (path: string) => Promise<boolean> | boolean;
  getInstalledPackages?: () => Promise<string[]> | string[];
  getSystemProperties?: () => Record<string, string>;
  isDebuggerAttached?: () => boolean;
}

class DeviceAttestationService {
  private customProvider: IntegrityProbeProvider | null = null;

  /**
   * Inject a custom probe provider (useful for native modules or unit tests).
   */
  setCustomProbeProvider(provider: IntegrityProbeProvider | null): void {
    this.customProvider = provider;
  }

  /**
   * Run full device integrity evaluation.
   */
  async checkIntegrity(force = false): Promise<DeviceIntegrityResult> {
    if (!force) {
      const cached = await this.getCachedIntegrity();
      if (cached && Date.now() - cached.attestedAt < 24 * 60 * 60 * 1000) {
        return cached;
      }
    }

    const indicators: string[] = [];

    // 1. Android Root Detection
    const isRooted = await this.detectRoot(indicators);

    // 2. iOS Jailbreak Detection
    const isJailbroken = await this.detectJailbreak(indicators);

    // 3. Tamper & Hooking Detection
    const isTampered = await this.detectTamper(indicators);

    // 4. Emulator Detection
    const isEmulator = this.detectEmulator(indicators);

    // 5. Evaluate Risk Level
    const riskLevel = this.computeRiskLevel({
      isRooted,
      isJailbroken,
      isTampered,
      isEmulator,
      indicators,
    });

    // 6. Graceful Degradation Policy
    const degradationPolicy = this.computeDegradationPolicy(riskLevel, indicators);

    const isIntact = !isRooted && !isJailbroken && !isTampered && !isEmulator;

    const result: DeviceIntegrityResult = {
      isIntact,
      isRooted,
      isJailbroken,
      isEmulator,
      isTampered,
      riskLevel,
      compromiseIndicators: indicators,
      degradationPolicy,
      attestedAt: Date.now(),
    };

    try {
      await AsyncStorage.setItem(DEVICE_INTEGRITY_KEY, JSON.stringify(result));
    } catch {
      // Non-fatal if storage fails
    }

    return result;
  }

  /**
   * Retrieve cached integrity evaluation without re-running probes.
   */
  async getCachedIntegrity(): Promise<DeviceIntegrityResult | null> {
    try {
      const raw = await AsyncStorage.getItem(DEVICE_INTEGRITY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Ensure backwards compatibility with older schema
      if (!parsed.riskLevel || !parsed.degradationPolicy) {
        const riskLevel = this.computeRiskLevel({
          isRooted: !!parsed.isRooted,
          isJailbroken: !!parsed.isJailbroken,
          isTampered: !!parsed.isTampered,
          isEmulator: !!parsed.isEmulator,
          indicators: parsed.compromiseIndicators || [],
        });
        parsed.riskLevel = riskLevel;
        parsed.isJailbroken = parsed.isJailbroken ?? false;
        parsed.isTampered = parsed.isTampered ?? false;
        parsed.compromiseIndicators = parsed.compromiseIndicators ?? [];
        parsed.degradationPolicy = this.computeDegradationPolicy(
          riskLevel,
          parsed.compromiseIndicators
        );
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Determine whether a sensitive operation is allowed under current device state.
   */
  isOperationAllowed(operation: SensitiveOperation, policy?: DegradationPolicy): boolean {
    const activePolicy = policy ?? this.computeDegradationPolicy('low', []);

    switch (operation) {
      case 'VIEW_SUBSCRIPTIONS':
      case 'VIEW_ANALYTICS':
      case 'MANAGE_CATEGORIES':
      case 'CHANGE_SETTINGS':
      case 'READ_DOCUMENTATION':
        return activePolicy.allowBasicAccess;

      case 'EXECUTE_PAYMENT':
      case 'SIGN_TRANSACTION':
        return activePolicy.allowSensitiveTransactions;

      case 'BIOMETRIC_AUTH':
        return activePolicy.allowBiometrics;

      case 'EXPORT_PRIVATE_KEYS':
        return activePolicy.allowLocalKeyExport;

      case 'EXPORT_SENSITIVE_DATA':
        return activePolicy.allowSensitiveTransactions && activePolicy.allowLocalKeyExport;

      case 'PERSIST_PLAINTEXT_TOKENS':
        return activePolicy.allowOfflineSecretsStorage;

      default:
        return false;
    }
  }

  /**
   * Assert an operation is allowed, throwing DeviceIntegrityError if restricted.
   */
  assertOperationAllowed(operation: SensitiveOperation, result?: DeviceIntegrityResult): void {
    const policy = result?.degradationPolicy ?? this.computeDegradationPolicy('low', []);
    if (!this.isOperationAllowed(operation, policy)) {
      throw new DeviceIntegrityError(
        operation,
        result?.riskLevel ?? 'critical',
        result?.compromiseIndicators ?? ['device_compromised']
      );
    }
  }

  // ── Detection Implementations ─────────────────────────────────────────────

  private async detectRoot(indicators: string[]): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    let detected = false;

    // 1. Filesystem paths check via provider or Node fs in tests
    if (this.customProvider?.checkPathsExist) {
      try {
        const found = await this.customProvider.checkPathsExist(ANDROID_ROOT_PATHS);
        if (found && found.length > 0) {
          detected = true;
          indicators.push(...found.map((p) => `android_root_path:${p}`));
        }
      } catch {
        // ignore probe error
      }
    }

    // 2. Installed packages check
    if (this.customProvider?.getInstalledPackages) {
      try {
        const installed = await this.customProvider.getInstalledPackages();
        for (const pkg of ANDROID_ROOT_PACKAGES) {
          if (installed.includes(pkg)) {
            detected = true;
            indicators.push(`android_root_package:${pkg}`);
          }
        }
      } catch {
        // ignore probe error
      }
    }

    // 3. Android build tags check (test-keys indicates custom/untrusted build)
    const constants = (Platform as any).constants || {};
    const tags = (constants.Release?.tags || constants.Fingerprint || '').toLowerCase();
    const serverHost = (constants.ServerHost || '').toLowerCase();
    if (tags.includes('test-keys') || serverHost.includes('test-keys')) {
      detected = true;
      indicators.push('android_build_test_keys');
    }

    // 4. System properties check
    if (this.customProvider?.getSystemProperties) {
      try {
        const props = this.customProvider.getSystemProperties();
        if (props['ro.debuggable'] === '1' || props['ro.secure'] === '0') {
          detected = true;
          indicators.push('android_insecure_system_properties');
        }
      } catch {
        // ignore probe error
      }
    }

    return detected;
  }

  private async detectJailbreak(indicators: string[]): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;

    let detected = false;

    // 1. Filesystem paths check via provider
    if (this.customProvider?.checkPathsExist) {
      try {
        const found = await this.customProvider.checkPathsExist(IOS_JAILBREAK_PATHS);
        if (found && found.length > 0) {
          detected = true;
          indicators.push(...found.map((p) => `ios_jailbreak_path:${p}`));
        }
      } catch {
        // ignore probe error
      }
    }

    // 2. URL Schemes check (Cydia, Sileo, Zebra)
    if (this.customProvider?.checkUrlSchemes) {
      try {
        const opened = await this.customProvider.checkUrlSchemes(IOS_JAILBREAK_SCHEMES);
        if (opened && opened.length > 0) {
          detected = true;
          indicators.push(...opened.map((s) => `ios_jailbreak_url_scheme:${s}`));
        }
      } catch {
        // ignore probe error
      }
    } else if (Linking && typeof Linking.canOpenURL === 'function') {
      for (const scheme of IOS_JAILBREAK_SCHEMES) {
        try {
          const supported = await Linking.canOpenURL(scheme);
          if (supported) {
            detected = true;
            indicators.push(`ios_jailbreak_url_scheme:${scheme}`);
          }
        } catch {
          // ignore linking error
        }
      }
    }

    // 3. Sandbox write test
    if (this.customProvider?.canWriteRestrictedPath) {
      try {
        const canWrite = await this.customProvider.canWriteRestrictedPath(
          '/private/subtrackr_jailbreak.txt'
        );
        if (canWrite) {
          detected = true;
          indicators.push('ios_sandbox_violation');
        }
      } catch {
        // ignore probe error
      }
    }

    return detected;
  }

  private async detectTamper(indicators: string[]): Promise<boolean> {
    let detected = false;

    // 1. Frida / hooking globals
    const g = (typeof globalThis !== 'undefined' ? globalThis : global) as any;
    if (g && (g.frida || g.Process?.arch || g.Module?.findBaseAddressByName)) {
      detected = true;
      indicators.push('tamper_frida_global_detected');
    }

    // 2. Xposed framework check
    if (g && (g.XposedBridge || g.__xposed_intercept)) {
      detected = true;
      indicators.push('tamper_xposed_detected');
    }

    // 3. Hooked prototype check (function tampering)
    try {
      const toStringSource = Function.prototype.toString.call(Function.prototype.toString);
      if (!toStringSource.includes('[native code]')) {
        detected = true;
        indicators.push('tamper_native_prototype_hooked');
      }
    } catch {
      // ignore
    }

    // 4. Debugger attachment in production
    const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
    if (!isDev) {
      if (this.customProvider?.isDebuggerAttached && this.customProvider.isDebuggerAttached()) {
        detected = true;
        indicators.push('tamper_debugger_attached_in_production');
      }
    }

    return detected;
  }

  private detectEmulator(indicators: string[]): boolean {
    if (Platform.OS === 'android') {
      const brand = ((Platform as any).constants?.Brand || '').toLowerCase();
      const model = ((Platform as any).constants?.Model || '').toLowerCase();
      const fingerprint = ((Platform as any).constants?.Fingerprint || '').toLowerCase();
      const hardware = ((Platform as any).constants?.Hardware || '').toLowerCase();

      const isAndroidEmu =
        (brand === 'google' && model.includes('sdk')) ||
        model.includes('emulator') ||
        model.includes('google_sdk') ||
        fingerprint.includes('generic') ||
        hardware.includes('goldfish') ||
        hardware.includes('ranchu');

      if (isAndroidEmu) {
        indicators.push('emulator_android_detected');
        return true;
      }
    }

    if (Platform.OS === 'ios') {
      const isSim =
        (Platform as any).constants?.isSimulator || process.env.SIMULATOR_DEVICE_NAME !== undefined;

      if (isSim) {
        indicators.push('emulator_ios_simulator_detected');
        return true;
      }
    }

    return false;
  }

  // ── Policy Computation ────────────────────────────────────────────────────

  private computeRiskLevel({
    isRooted,
    isJailbroken,
    isTampered,
    isEmulator,
    indicators,
  }: {
    isRooted: boolean;
    isJailbroken: boolean;
    isTampered: boolean;
    isEmulator: boolean;
    indicators: string[];
  }): RiskLevel {
    if (isRooted || isJailbroken) {
      return 'critical';
    }
    if (isTampered) {
      return 'critical';
    }
    if (indicators.some((i) => i.includes('test_keys') || i.includes('insecure'))) {
      return 'high';
    }
    if (isEmulator) {
      return 'medium';
    }
    return 'low';
  }

  private computeDegradationPolicy(riskLevel: RiskLevel, indicators: string[]): DegradationPolicy {
    switch (riskLevel) {
      case 'critical':
        return {
          riskLevel: 'critical',
          allowBasicAccess: true,
          allowSensitiveTransactions: false,
          allowBiometrics: false,
          allowLocalKeyExport: false,
          allowOfflineSecretsStorage: false,
          requireStepUpAuth: true,
          warningMessage:
            'Critical security risk detected: This device appears to be rooted, jailbroken, or tampered. Sensitive operations like crypto signing and private key exports are disabled to protect your data.',
        };

      case 'high':
        return {
          riskLevel: 'high',
          allowBasicAccess: true,
          allowSensitiveTransactions: false,
          allowBiometrics: false,
          allowLocalKeyExport: false,
          allowOfflineSecretsStorage: true,
          requireStepUpAuth: true,
          warningMessage:
            'High security risk: Suspicious system modifications detected. High-value transactions require secondary verification.',
        };

      case 'medium':
        return {
          riskLevel: 'medium',
          allowBasicAccess: true,
          allowSensitiveTransactions: true,
          allowBiometrics: false,
          allowLocalKeyExport: true,
          allowOfflineSecretsStorage: true,
          requireStepUpAuth: false,
          warningMessage:
            'Development or simulated environment detected. Biometric hardware is not available.',
        };

      case 'low':
      default:
        return {
          riskLevel: 'low',
          allowBasicAccess: true,
          allowSensitiveTransactions: true,
          allowBiometrics: true,
          allowLocalKeyExport: true,
          allowOfflineSecretsStorage: true,
          requireStepUpAuth: false,
        };
    }
  }
}

export const deviceAttestationService = new DeviceAttestationService();
