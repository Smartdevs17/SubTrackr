/**
 * BiometricService — wraps expo-local-authentication for Face ID / Touch ID /
 * fingerprint authentication with PIN fallback.
 *
 * Install the native module once:
 *   npx expo install expo-local-authentication
 *
 * The service degrades gracefully when the module is unavailable (e.g. in
 * Jest or on a device with no enrolled biometrics) so the rest of the app
 * never needs to guard against import errors.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@subtrackr/biometric_settings';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

export interface BiometricSettings {
  /** Whether the user has opted in to biometric lock. */
  enabled: boolean;
  /** Whether to fall back to device PIN/passcode when biometrics fail. */
  fallbackToPIN: boolean;
  /** Hashed app PIN (bcrypt) — minimum 6 digits. */
  pinHash?: string;
  /** Consecutive biometric failure count (for exponential backoff). */
  failureCount?: number;
  /** Timestamp when lockout expires (0 = no lockout). */
  lockoutUntil?: number;
  /** Whether device-bound key pair has been generated. */
  keyBound?: boolean;
  /** Hash of enrolled biometrics at time of setup (detect enrollment changes). */
  enrollmentHash?: string;
}

export interface BiometricPolicy {
  /** Lockout tiers: [failures, lockoutMinutes] */
  lockoutTiers: [number, number][];
  /** Minimum PIN length */
  minPinLength: number;
  /** Whether device integrity check is required */
  requireDeviceAttestation: boolean;
}

export interface BiometricAuthResult {
  success: boolean;
  /** Human-readable reason for failure, if any. */
  error?: string;
  /** Whether the user cancelled the prompt. */
  cancelled?: boolean;
}

// ─── Lazy-load expo-local-authentication ─────────────────────────────────────
// We import dynamically so the app doesn't crash if the native module hasn't
// been linked yet (e.g. in Expo Go or unit tests).

type LocalAuth = typeof import('expo-local-authentication');

let _localAuth: LocalAuth | null = null;

async function getLocalAuth(): Promise<LocalAuth | null> {
  if (_localAuth) return _localAuth;
  try {
    _localAuth = await import('expo-local-authentication');
    return _localAuth;
  } catch {
    return null;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class BiometricService {
  // ── Settings persistence ───────────────────────────────────────────────────

  async getSettings(): Promise<BiometricSettings> {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw) as BiometricSettings;
    } catch {
      // Fall through to defaults
    }
    return { enabled: false, fallbackToPIN: true };
  }

  async saveSettings(settings: Partial<BiometricSettings>): Promise<BiometricSettings> {
    const current = await this.getSettings();
    const merged = { ...current, ...settings };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  }

  // ── Hardware / enrollment checks ───────────────────────────────────────────

  /**
   * Returns true when the device has biometric hardware AND the user has
   * enrolled at least one biometric credential.
   */
  async isAvailable(): Promise<boolean> {
    const lib = await getLocalAuth();
    if (!lib) return false;
    try {
      const compatible = await lib.hasHardwareAsync();
      if (!compatible) return false;
      const enrolled = await lib.isEnrolledAsync();
      return enrolled;
    } catch {
      return false;
    }
  }

  /**
   * Returns the list of biometric types supported by the device
   * (e.g. fingerprint, facial recognition).
   */
  async getSupportedTypes(): Promise<BiometricType[]> {
    const lib = await getLocalAuth();
    if (!lib) return ['none'];
    try {
      const types = await lib.supportedAuthenticationTypesAsync();
      const AuthType = lib.AuthenticationType;
      return types.map((t: any) => {
        if (t === AuthType.FINGERPRINT) return 'fingerprint';
        if (t === AuthType.FACIAL_RECOGNITION) return 'facial';
        if (t === AuthType.IRIS) return 'iris';
        return 'none';
      });
    } catch {
      return ['none'];
    }
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  /**
   * Prompt the user to authenticate with biometrics.
   *
   * @param reason  Message shown in the system prompt (e.g. "Unlock SubTrackr").
   * @param fallbackToPIN  When true, the system prompt includes a PIN fallback.
   */
  async authenticate(
    reason = 'Authenticate to access SubTrackr',
    fallbackToPIN = true
  ): Promise<BiometricAuthResult> {
    const lib = await getLocalAuth();
    if (!lib) {
      return { success: false, error: 'Biometric authentication is not available on this device.' };
    }

    const available = await this.isAvailable();
    if (!available) {
      return { success: false, error: 'No biometric credentials enrolled on this device.' };
    }

    try {
      const result = await lib.authenticateAsync({
        promptMessage: reason,
        fallbackLabel: fallbackToPIN ? 'Use PIN' : '',
        disableDeviceFallback: !fallbackToPIN,
        cancelLabel: 'Cancel',
      });

      if (result.success) return { success: true };

      if (result.error === 'user_cancel' || result.error === 'system_cancel') {
        return { success: false, cancelled: true, error: 'Authentication cancelled.' };
      }

      return {
        success: false,
        error: result.error ?? 'Authentication failed. Please try again.',
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'An unexpected error occurred.',
      };
    }
  }

  /**
   * Convenience method: reads settings and authenticates only when biometrics
   * are enabled by the user. Returns `{ success: true }` immediately when
   * biometrics are disabled (so callers don't need to check settings first).
   */
  async authenticateIfEnabled(reason?: string): Promise<BiometricAuthResult> {
    const settings = await this.getSettings();
    if (!settings.enabled) return { success: true };
    return this.authenticate(reason, settings.fallbackToPIN);
  }

  // ── Hardening: Exponential backoff ────────────────────────────────────────

  private static readonly LOCKOUT_TIERS: [number, number][] = [
    [3, 3],    // 3 failures → 3 min lockout
    [6, 10],   // 6 failures → 10 min lockout
    [9, 30],   // 9 failures → 30 min lockout
  ];

  async checkLockout(): Promise<{ locked: boolean; remainingMs: number }> {
    const settings = await this.getSettings();
    const now = Date.now();
    const lockoutUntil = settings.lockoutUntil ?? 0;
    if (lockoutUntil > now) {
      return { locked: true, remainingMs: lockoutUntil - now };
    }
    return { locked: false, remainingMs: 0 };
  }

  async recordFailure(): Promise<void> {
    const settings = await this.getSettings();
    const failures = (settings.failureCount ?? 0) + 1;
    let lockoutUntil = 0;

    for (const [threshold, minutes] of BiometricService.LOCKOUT_TIERS) {
      if (failures >= threshold) {
        lockoutUntil = Date.now() + minutes * 60 * 1000;
      }
    }

    await this.saveSettings({ failureCount: failures, lockoutUntil });
  }

  async resetFailures(): Promise<void> {
    await this.saveSettings({ failureCount: 0, lockoutUntil: 0 });
  }

  // ── Hardening: Authenticated with lockout enforcement ─────────────────────

  async authenticateHardened(reason?: string): Promise<BiometricAuthResult> {
    const lockout = await this.checkLockout();
    if (lockout.locked) {
      const mins = Math.ceil(lockout.remainingMs / 60000);
      return { success: false, error: `Too many failures. Try again in ${mins} minute(s).` };
    }

    const result = await this.authenticate(reason);
    if (result.success) {
      await this.resetFailures();
    } else if (!result.cancelled) {
      await this.recordFailure();
    }
    return result;
  }

  // ── PIN management ────────────────────────────────────────────────────────

  async setPinHash(pinHash: string): Promise<void> {
    await this.saveSettings({ pinHash });
  }

  async verifyPin(inputHash: string): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.pinHash === inputHash;
  }

  // ── Enrollment change detection ───────────────────────────────────────────

  async setEnrollmentHash(hash: string): Promise<void> {
    await this.saveSettings({ enrollmentHash: hash });
  }

  async hasEnrollmentChanged(): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.enrollmentHash) return false;
    // In production, compare against current biometric enrollment via native module
    // Placeholder: always returns false (no native enrollment hash API in Expo)
    return false;
  }

  // ── Key binding ───────────────────────────────────────────────────────────

  async markKeyBound(): Promise<void> {
    await this.saveSettings({ keyBound: true });
  }

  async isKeyBound(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.keyBound ?? false;
  }
}

export const biometricService = new BiometricService();
