import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking } from 'react-native';
import {
  deviceAttestationService,
  DeviceIntegrityError,
  DeviceIntegrityResult,
  IntegrityProbeProvider,
  SensitiveOperation,
} from '../deviceAttestationService';

const mockStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
}));

describe('deviceAttestationService', () => {
  const originalPlatformOS = Platform.OS;
  const originalPlatformConstants = (Platform as any).constants;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStore).forEach((key) => delete mockStore[key]);
    deviceAttestationService.setCustomProbeProvider(null);
    delete (globalThis as any).frida;
    delete (globalThis as any).Process;
    delete (globalThis as any).Module;
    delete (globalThis as any).XposedBridge;
    delete (globalThis as any).__xposed_intercept;
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
    (Platform as any).constants = originalPlatformConstants;
    deviceAttestationService.setCustomProbeProvider(null);
  });

  describe('Clean / Intact Device Evaluation', () => {
    it('evaluates clean iOS device as intact with low risk', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      (Platform as any).constants = { isSimulator: false };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isIntact).toBe(true);
      expect(result.isRooted).toBe(false);
      expect(result.isJailbroken).toBe(false);
      expect(result.isTampered).toBe(false);
      expect(result.isEmulator).toBe(false);
      expect(result.riskLevel).toBe('low');
      expect(result.compromiseIndicators).toEqual([]);
      expect(result.degradationPolicy.allowBasicAccess).toBe(true);
      expect(result.degradationPolicy.allowSensitiveTransactions).toBe(true);
      expect(result.degradationPolicy.allowBiometrics).toBe(true);
      expect(result.degradationPolicy.allowLocalKeyExport).toBe(true);
    });

    it('evaluates clean Android device as intact with low risk', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      (Platform as any).constants = {
        Brand: 'Samsung',
        Model: 'Galaxy S24',
        Fingerprint: 'samsung/galaxy/official:user/release-keys',
        Hardware: 'exynos',
      };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isIntact).toBe(true);
      expect(result.isRooted).toBe(false);
      expect(result.isJailbroken).toBe(false);
      expect(result.isTampered).toBe(false);
      expect(result.isEmulator).toBe(false);
      expect(result.riskLevel).toBe('low');
      expect(result.compromiseIndicators).toEqual([]);
    });
  });

  describe('Android Root Detection', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      (Platform as any).constants = {
        Brand: 'Samsung',
        Model: 'SM-G998B',
      };
    });

    it('detects root when common su / magisk paths are present', async () => {
      const mockProvider: IntegrityProbeProvider = {
        checkPathsExist: jest.fn().mockResolvedValue(['/system/xbin/su', '/sbin/.magisk']),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isRooted).toBe(true);
      expect(result.isIntact).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('android_root_path:/system/xbin/su');
      expect(result.compromiseIndicators).toContain('android_root_path:/sbin/.magisk');
    });

    it('detects root when known root management packages are installed', async () => {
      const mockProvider: IntegrityProbeProvider = {
        getInstalledPackages: jest
          .fn()
          .mockResolvedValue(['com.topjohnwu.magisk', 'com.other.app']),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isRooted).toBe(true);
      expect(result.isIntact).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('android_root_package:com.topjohnwu.magisk');
    });

    it('detects untrusted ROM when build tags contain test-keys', async () => {
      (Platform as any).constants = {
        Brand: 'Pixel',
        Fingerprint: 'google/marlin/test-keys',
      };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isRooted).toBe(true);
      expect(result.compromiseIndicators).toContain('android_build_test_keys');
      expect(result.riskLevel).toBe('critical');
    });

    it('detects insecure system properties (ro.debuggable=1 or ro.secure=0)', async () => {
      const mockProvider: IntegrityProbeProvider = {
        getSystemProperties: jest.fn().mockReturnValue({
          'ro.debuggable': '1',
          'ro.secure': '0',
        }),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isRooted).toBe(true);
      expect(result.compromiseIndicators).toContain('android_insecure_system_properties');
    });
  });

  describe('iOS Jailbreak Detection', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      (Platform as any).constants = { isSimulator: false };
    });

    it('detects jailbreak filesystem artifacts (Cydia, MobileSubstrate, bash)', async () => {
      const mockProvider: IntegrityProbeProvider = {
        checkPathsExist: jest.fn().mockResolvedValue(['/Applications/Cydia.app', '/bin/bash']),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isJailbroken).toBe(true);
      expect(result.isIntact).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('ios_jailbreak_path:/Applications/Cydia.app');
      expect(result.compromiseIndicators).toContain('ios_jailbreak_path:/bin/bash');
    });

    it('detects jailbreak URL schemes (cydia://, sileo://)', async () => {
      const mockProvider: IntegrityProbeProvider = {
        checkUrlSchemes: jest.fn().mockResolvedValue(['cydia://']),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isJailbroken).toBe(true);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('ios_jailbreak_url_scheme:cydia://');
    });

    it('detects sandbox escape / restricted path write violations', async () => {
      const mockProvider: IntegrityProbeProvider = {
        canWriteRestrictedPath: jest.fn().mockResolvedValue(true),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isJailbroken).toBe(true);
      expect(result.compromiseIndicators).toContain('ios_sandbox_violation');
      expect(result.riskLevel).toBe('critical');
    });
  });

  describe('Tampering and Dynamic Hooking Detection', () => {
    it('detects Frida global injection artifacts', async () => {
      (globalThis as any).frida = { version: '16.1.4' };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isTampered).toBe(true);
      expect(result.isIntact).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('tamper_frida_global_detected');
    });

    it('detects Xposed framework globals', async () => {
      (globalThis as any).XposedBridge = {};

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isTampered).toBe(true);
      expect(result.riskLevel).toBe('critical');
      expect(result.compromiseIndicators).toContain('tamper_xposed_detected');
    });

    it('detects debugger attachment in production mode', async () => {
      const oldDev = (globalThis as any).__DEV__;
      const oldEnv = process.env.NODE_ENV;
      try {
        (globalThis as any).__DEV__ = false;
        process.env.NODE_ENV = 'production';

        const mockProvider: IntegrityProbeProvider = {
          isDebuggerAttached: jest.fn().mockReturnValue(true),
        };
        deviceAttestationService.setCustomProbeProvider(mockProvider);

        const result = await deviceAttestationService.checkIntegrity(true);

        expect(result.isTampered).toBe(true);
        expect(result.compromiseIndicators).toContain('tamper_debugger_attached_in_production');
      } finally {
        (globalThis as any).__DEV__ = oldDev;
        process.env.NODE_ENV = oldEnv;
      }
    });
  });

  describe('Emulator and Simulator Detection', () => {
    it('detects Android emulator via goldfish/ranchu hardware flags', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      (Platform as any).constants = {
        Brand: 'google',
        Model: 'sdk_gphone64_arm64',
        Hardware: 'ranchu',
        Fingerprint: 'generic_x86',
      };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isEmulator).toBe(true);
      expect(result.riskLevel).toBe('medium');
      expect(result.compromiseIndicators).toContain('emulator_android_detected');
    });

    it('detects iOS Simulator', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      (Platform as any).constants = { isSimulator: true };

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.isEmulator).toBe(true);
      expect(result.riskLevel).toBe('medium');
      expect(result.compromiseIndicators).toContain('emulator_ios_simulator_detected');
    });
  });

  describe('Graceful Degradation Engine', () => {
    it('allows basic operations in degraded mode when device is compromised', async () => {
      const mockProvider: IntegrityProbeProvider = {
        checkPathsExist: jest.fn().mockResolvedValue(['/sbin/su']),
      };
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      expect(result.riskLevel).toBe('critical');

      // Safe / Basic operations are allowed under graceful degradation
      expect(
        deviceAttestationService.isOperationAllowed('VIEW_SUBSCRIPTIONS', result.degradationPolicy)
      ).toBe(true);
      expect(
        deviceAttestationService.isOperationAllowed('VIEW_ANALYTICS', result.degradationPolicy)
      ).toBe(true);
      expect(
        deviceAttestationService.isOperationAllowed('MANAGE_CATEGORIES', result.degradationPolicy)
      ).toBe(true);
      expect(
        deviceAttestationService.isOperationAllowed('CHANGE_SETTINGS', result.degradationPolicy)
      ).toBe(true);
      expect(
        deviceAttestationService.isOperationAllowed('READ_DOCUMENTATION', result.degradationPolicy)
      ).toBe(true);

      // Sensitive operations are RESTRICTED under graceful degradation
      expect(
        deviceAttestationService.isOperationAllowed('EXECUTE_PAYMENT', result.degradationPolicy)
      ).toBe(false);
      expect(
        deviceAttestationService.isOperationAllowed('SIGN_TRANSACTION', result.degradationPolicy)
      ).toBe(false);
      expect(
        deviceAttestationService.isOperationAllowed('EXPORT_PRIVATE_KEYS', result.degradationPolicy)
      ).toBe(false);
      expect(
        deviceAttestationService.isOperationAllowed('BIOMETRIC_AUTH', result.degradationPolicy)
      ).toBe(false);
      expect(
        deviceAttestationService.isOperationAllowed(
          'EXPORT_SENSITIVE_DATA',
          result.degradationPolicy
        )
      ).toBe(false);
      expect(
        deviceAttestationService.isOperationAllowed(
          'PERSIST_PLAINTEXT_TOKENS',
          result.degradationPolicy
        )
      ).toBe(false);
    });

    it('assertOperationAllowed throws DeviceIntegrityError for restricted operations on compromised device', async () => {
      const mockProvider: IntegrityProbeProvider = {
        checkPathsExist: jest.fn().mockResolvedValue(['/Applications/Cydia.app']),
      };
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      const result = await deviceAttestationService.checkIntegrity(true);

      // Basic operation succeeds without error
      expect(() => {
        deviceAttestationService.assertOperationAllowed('VIEW_SUBSCRIPTIONS', result);
      }).not.toThrow();

      // Sensitive operation throws DeviceIntegrityError
      expect(() => {
        deviceAttestationService.assertOperationAllowed('SIGN_TRANSACTION', result);
      }).toThrow(DeviceIntegrityError);

      try {
        deviceAttestationService.assertOperationAllowed('SIGN_TRANSACTION', result);
      } catch (e: any) {
        expect(e).toBeInstanceOf(DeviceIntegrityError);
        expect(e.riskLevel).toBe('critical');
        expect(e.operation).toBe('SIGN_TRANSACTION');
        expect(e.indicators).toContain('ios_jailbreak_path:/Applications/Cydia.app');
      }
    });

    it('allows all operations on intact device', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      (Platform as any).constants = { isSimulator: false };

      const result = await deviceAttestationService.checkIntegrity(true);

      const allOps: SensitiveOperation[] = [
        'VIEW_SUBSCRIPTIONS',
        'VIEW_ANALYTICS',
        'MANAGE_CATEGORIES',
        'CHANGE_SETTINGS',
        'READ_DOCUMENTATION',
        'EXECUTE_PAYMENT',
        'SIGN_TRANSACTION',
        'EXPORT_PRIVATE_KEYS',
        'BIOMETRIC_AUTH',
        'EXPORT_SENSITIVE_DATA',
        'PERSIST_PLAINTEXT_TOKENS',
      ];

      for (const op of allOps) {
        expect(deviceAttestationService.isOperationAllowed(op, result.degradationPolicy)).toBe(
          true
        );
        expect(() => deviceAttestationService.assertOperationAllowed(op, result)).not.toThrow();
      }
    });
  });

  describe('Caching and Lifecycle', () => {
    it('persists evaluation to AsyncStorage and reuses fresh cache', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      (Platform as any).constants = { isSimulator: false };

      const first = await deviceAttestationService.checkIntegrity(true);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@subtrackr/device_integrity',
        expect.any(String)
      );

      // Mock provider that would detect root if called
      const mockProvider: IntegrityProbeProvider = {
        checkPathsExist: jest.fn().mockResolvedValue(['/bin/bash']),
      };
      deviceAttestationService.setCustomProbeProvider(mockProvider);

      // checkIntegrity(false) should return cached without calling mockProvider
      const cached = await deviceAttestationService.checkIntegrity(false);
      expect(mockProvider.checkPathsExist).not.toHaveBeenCalled();
      expect(cached.isIntact).toBe(true);

      // checkIntegrity(true) bypasses cache and runs probes
      const fresh = await deviceAttestationService.checkIntegrity(true);
      expect(mockProvider.checkPathsExist).toHaveBeenCalled();
      expect(fresh.isJailbroken).toBe(true);
    });

    it('getCachedIntegrity handles backwards-compatible schema upgrades', async () => {
      const legacyResult = {
        isIntact: false,
        isRooted: true,
        isEmulator: false,
        attestedAt: Date.now(),
      };
      mockStore['@subtrackr/device_integrity'] = JSON.stringify(legacyResult);

      const loaded = await deviceAttestationService.getCachedIntegrity();
      expect(loaded).not.toBeNull();
      expect(loaded?.riskLevel).toBe('critical');
      expect(loaded?.degradationPolicy).toBeDefined();
      expect(loaded?.degradationPolicy.allowBasicAccess).toBe(true);
      expect(loaded?.degradationPolicy.allowSensitiveTransactions).toBe(false);
    });
  });
});
