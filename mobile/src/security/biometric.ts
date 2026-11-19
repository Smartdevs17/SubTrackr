/**
 * Biometric re-authentication gate for billing settings changes.
 *
 * Any mutation that touches billing data (payment methods, plan upgrades,
 * cancellation, billing address) must pass through `requireBiometricReAuth`
 * before the action executes. The check is skipped when the device has no
 * enrolled biometrics — the caller receives `{ success: true }` and must
 * decide whether to fall back to a password challenge instead.
 */

import { biometricService } from '../../../src/services/auth/biometricService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BillingAction =
  | 'update_payment_method'
  | 'change_plan'
  | 'cancel_subscription'
  | 'update_billing_address'
  | 'apply_promo_code';

export interface BillingReAuthResult {
  granted: boolean;
  /** Machine-readable reason when not granted. */
  reason?: 'biometrics_unavailable' | 'cancelled' | 'locked_out' | 'failed';
  /** Human-readable message suitable for a toast or alert. */
  message?: string;
}

// Human-readable prompt shown in the biometric system dialog per action.
const PROMPTS: Record<BillingAction, string> = {
  update_payment_method: 'Confirm your identity to update your payment method',
  change_plan: 'Confirm your identity to change your subscription plan',
  cancel_subscription: 'Confirm your identity to cancel your subscription',
  update_billing_address: 'Confirm your identity to update your billing address',
  apply_promo_code: 'Confirm your identity to apply a promotional code',
};

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Prompt biometric re-authentication before a sensitive billing action.
 *
 * Usage:
 * ```ts
 * const auth = await requireBiometricReAuth('update_payment_method');
 * if (!auth.granted) {
 *   showAlert(auth.message ?? 'Authentication required');
 *   return;
 * }
 * // proceed with the billing mutation
 * ```
 */
export async function requireBiometricReAuth(
  action: BillingAction,
): Promise<BillingReAuthResult> {
  // Check if biometrics are even configured on this device.
  const available = await biometricService.isAvailable().catch(() => false);
  if (!available) {
    // The caller should decide whether to fall back to password re-auth.
    // We grant here so this gate is not a hard block on devices without biometrics.
    return { granted: true, reason: 'biometrics_unavailable' };
  }

  // Check lockout before triggering the native prompt.
  const lockout = await biometricService.checkLockout();
  if (lockout.locked) {
    const mins = Math.ceil(lockout.remainingMs / 60_000);
    return {
      granted: false,
      reason: 'locked_out',
      message: `Too many failed attempts. Please try again in ${mins} minute(s).`,
    };
  }

  const prompt = PROMPTS[action];
  const result = await biometricService.authenticateHardened(prompt);

  if (result.success) {
    return { granted: true };
  }

  if (result.cancelled) {
    return { granted: false, reason: 'cancelled', message: 'Authentication cancelled.' };
  }

  return {
    granted: false,
    reason: 'failed',
    message: result.error ?? 'Biometric authentication failed. Please try again.',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// see __tests__/biometric.test.ts
