/**
 * SensitiveActionGuard — step-up biometric authentication for high-risk
 * actions (Issue #1765).
 *
 * Certain operations (moving funds, exporting keys, deleting the account, …)
 * require a fresh biometric check even though the app itself is already
 * unlocked. The guard consults a persisted policy — so enforcement is
 * opt-in per action ("enforced where configured") — and delegates the actual
 * prompt to `biometricService`, which supplies lockout backoff and the
 * device-PIN fallback.
 *
 * Graceful fallback: devices without enrolled biometrics (or with the native
 * module missing, e.g. tests / Expo Go) are not locked out of their own data
 * unless the policy opts into `onUnavailable: 'block'`. The fallback decision
 * is always surfaced on the result so callers/UI can show why.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { biometricService } from './biometricService';

const POLICY_KEY = '@subtrackr/sensitive_action_policy';

export type SensitiveAction =
  | 'transfer_funds'
  | 'export_private_key'
  | 'confirm_payment'
  | 'delete_account'
  | 'change_security_settings';

export interface SensitiveActionPolicy {
  /** Actions that require a biometric step-up before executing. */
  enforced: SensitiveAction[];
  /** Fallback when no biometric hardware/enrollment is available. */
  onUnavailable: 'allow' | 'block';
}

export type AuthorizationCode =
  'allowed' | 'not_enforced' | 'denied' | 'cancelled' | 'unavailable' | 'locked_out';

export interface AuthorizationResult {
  allowed: boolean;
  code: AuthorizationCode;
  /** True when the guard ran but there was nothing to enforce. */
  required: boolean;
  /** True when the allow/deny decision came from the unavailable-fallback. */
  fellBack: boolean;
  message?: string;
}

export class BiometricGateError extends Error {
  readonly code: AuthorizationCode;
  readonly action: SensitiveAction;

  constructor(action: SensitiveAction, result: AuthorizationResult) {
    super(result.message ?? `Biometric step-up required for "${action}" (code: ${result.code})`);
    this.name = 'BiometricGateError';
    this.code = result.code;
    this.action = action;
  }
}

export const DEFAULT_SENSITIVE_ACTION_POLICY: SensitiveActionPolicy = {
  enforced: ['transfer_funds', 'export_private_key', 'confirm_payment', 'delete_account'],
  onUnavailable: 'allow',
};

class SensitiveActionGuard {
  async getPolicy(): Promise<SensitiveActionPolicy> {
    try {
      const raw = await AsyncStorage.getItem(POLICY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SensitiveActionPolicy>;
        return {
          enforced: Array.isArray(parsed.enforced)
            ? parsed.enforced
            : DEFAULT_SENSITIVE_ACTION_POLICY.enforced,
          onUnavailable: parsed.onUnavailable === 'block' ? 'block' : 'allow',
        };
      }
    } catch {
      // Corrupt policy → defaults
    }
    return {
      ...DEFAULT_SENSITIVE_ACTION_POLICY,
      enforced: [...DEFAULT_SENSITIVE_ACTION_POLICY.enforced],
    };
  }

  async savePolicy(patch: Partial<SensitiveActionPolicy>): Promise<SensitiveActionPolicy> {
    const current = await this.getPolicy();
    const next: SensitiveActionPolicy = {
      enforced: patch.enforced ?? current.enforced,
      onUnavailable: patch.onUnavailable ?? current.onUnavailable,
    };
    await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(next));
    return next;
  }

  /** Whether `action` currently requires a biometric step-up. */
  async isEnforced(action: SensitiveAction): Promise<boolean> {
    const policy = await this.getPolicy();
    return policy.enforced.includes(action);
  }

  /**
   * Authorize a sensitive action. Never throws — callers decide whether to
   * proceed; `withBiometricGuard` is the throwing convenience wrapper.
   */
  async authorize(action: SensitiveAction, reason?: string): Promise<AuthorizationResult> {
    const policy = await this.getPolicy();
    if (!policy.enforced.includes(action)) {
      return { allowed: true, code: 'not_enforced', required: false, fellBack: false };
    }

    const lockout = await biometricService.checkLockout();
    if (lockout.locked) {
      const mins = Math.ceil(lockout.remainingMs / 60000);
      return {
        allowed: false,
        code: 'locked_out',
        required: true,
        fellBack: false,
        message: `Too many failed attempts. Try again in ${mins} minute(s).`,
      };
    }

    const available = await biometricService.isAvailable();
    if (!available) {
      const allowed = policy.onUnavailable === 'allow';
      return {
        allowed,
        code: 'unavailable',
        required: true,
        fellBack: true,
        message: allowed
          ? 'Biometrics unavailable on this device; action allowed by fallback policy.'
          : 'Biometric authentication is required but unavailable on this device.',
      };
    }

    const prompt = reason ?? `Authenticate to ${action.replace(/_/g, ' ')} in SubTrackr`;
    const result = await biometricService.authenticateHardened(prompt);

    if (result.success) {
      return { allowed: true, code: 'allowed', required: true, fellBack: false };
    }

    return {
      allowed: false,
      code: result.cancelled ? 'cancelled' : 'denied',
      required: true,
      fellBack: false,
      message: result.error ?? 'Authentication failed.',
    };
  }

  /**
   * Run `fn` only after a successful step-up. Throws `BiometricGateError`
   * (before `fn` runs) when the guard denies the action.
   */
  async withBiometricGuard<T>(
    action: SensitiveAction,
    fn: () => Promise<T> | T,
    reason?: string
  ): Promise<T> {
    const result = await this.authorize(action, reason);
    if (!result.allowed) {
      throw new BiometricGateError(action, result);
    }
    return fn();
  }
}

export const sensitiveActionGuard = new SensitiveActionGuard();
