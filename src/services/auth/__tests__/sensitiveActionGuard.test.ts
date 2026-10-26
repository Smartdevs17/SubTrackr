import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BiometricGateError,
  DEFAULT_SENSITIVE_ACTION_POLICY,
  sensitiveActionGuard,
} from '../sensitiveActionGuard';
import { biometricService } from '../biometricService';

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

jest.mock('../biometricService', () => ({
  biometricService: {
    checkLockout: jest.fn(async () => ({ locked: false, remainingMs: 0 })),
    isAvailable: jest.fn(async () => true),
    authenticateHardened: jest.fn(async () => ({ success: true })),
  },
}));

const mockedAuth = biometricService as jest.Mocked<typeof biometricService>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('sensitiveActionGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStore).forEach((key) => delete mockStore[key]);
    mockedAuth.checkLockout.mockResolvedValue({ locked: false, remainingMs: 0 });
    mockedAuth.isAvailable.mockResolvedValue(true);
    mockedAuth.authenticateHardened.mockResolvedValue({ success: true });
  });

  describe('enforced where configured', () => {
    it('prompts and runs the action for an enforced action', async () => {
      const fn = jest.fn().mockReturnValue('done');

      const result = await sensitiveActionGuard.authorize('transfer_funds');

      expect(result).toMatchObject({ allowed: true, code: 'allowed', required: true });
      expect(mockedAuth.authenticateHardened).toHaveBeenCalledTimes(1);

      await expect(sensitiveActionGuard.withBiometricGuard('transfer_funds', fn)).resolves.toBe(
        'done'
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not prompt for actions that are not configured', async () => {
      await sensitiveActionGuard.savePolicy({ enforced: ['delete_account'] });

      const fn = jest.fn();
      await expect(
        sensitiveActionGuard.withBiometricGuard('transfer_funds', fn)
      ).resolves.toBeUndefined();

      expect(mockedAuth.authenticateHardened).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(await sensitiveActionGuard.isEnforced('delete_account')).toBe(true);
      expect(await sensitiveActionGuard.isEnforced('transfer_funds')).toBe(false);
    });

    it('denies and never executes the action when the prompt fails', async () => {
      mockedAuth.authenticateHardened.mockResolvedValue({
        success: false,
        error: 'Authentication failed.',
      });

      const fn = jest.fn();
      const result = await sensitiveActionGuard.authorize('confirm_payment');
      expect(result).toMatchObject({ allowed: false, code: 'denied' });

      await expect(sensitiveActionGuard.withBiometricGuard('confirm_payment', fn)).rejects.toThrow(
        BiometricGateError
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it('surfaces cancellation distinctly from a hard failure', async () => {
      mockedAuth.authenticateHardened.mockResolvedValue({
        success: false,
        cancelled: true,
        error: 'Authentication cancelled.',
      });

      const result = await sensitiveActionGuard.authorize('transfer_funds');
      expect(result).toMatchObject({ allowed: false, code: 'cancelled' });
    });

    it('blocks while locked out after repeated failures, without prompting', async () => {
      mockedAuth.checkLockout.mockResolvedValue({ locked: true, remainingMs: 120_000 });

      const result = await sensitiveActionGuard.authorize('transfer_funds');
      expect(result).toMatchObject({ allowed: false, code: 'locked_out' });
      expect(result.message).toContain('2 minute(s)');
      expect(mockedAuth.authenticateHardened).not.toHaveBeenCalled();
    });
  });

  describe('graceful fallback', () => {
    it('allows the action when biometrics are unavailable and policy is fail-open', async () => {
      mockedAuth.isAvailable.mockResolvedValue(false);
      await sensitiveActionGuard.savePolicy({ onUnavailable: 'allow' });

      const fn = jest.fn().mockReturnValue('ok');
      const result = await sensitiveActionGuard.authorize('transfer_funds');

      expect(result).toMatchObject({
        allowed: true,
        code: 'unavailable',
        fellBack: true,
        required: true,
      });
      expect(mockedAuth.authenticateHardened).not.toHaveBeenCalled();
      await expect(sensitiveActionGuard.withBiometricGuard('transfer_funds', fn)).resolves.toBe(
        'ok'
      );
    });

    it('blocks the action when biometrics are unavailable and policy is fail-closed', async () => {
      mockedAuth.isAvailable.mockResolvedValue(false);
      await sensitiveActionGuard.savePolicy({ onUnavailable: 'block' });

      const fn = jest.fn();
      const result = await sensitiveActionGuard.authorize('delete_account');
      expect(result).toMatchObject({ allowed: false, code: 'unavailable' });

      await expect(sensitiveActionGuard.withBiometricGuard('delete_account', fn)).rejects.toThrow(
        BiometricGateError
      );
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('policy persistence', () => {
    it('uses the default policy when nothing is stored', async () => {
      const policy = await sensitiveActionGuard.getPolicy();
      expect(policy).toEqual(DEFAULT_SENSITIVE_ACTION_POLICY);
    });

    it('recovers from corrupt stored policy', async () => {
      mockStore['@subtrackr/sensitive_action_policy'] = '{not json';
      const policy = await sensitiveActionGuard.getPolicy();
      expect(policy.enforced).toEqual(DEFAULT_SENSITIVE_ACTION_POLICY.enforced);
      expect(policy.onUnavailable).toBe('allow');
    });

    it('merges patches into the stored policy', async () => {
      const updated = await sensitiveActionGuard.savePolicy({ onUnavailable: 'block' });
      expect(updated.onUnavailable).toBe('block');
      expect(updated.enforced).toEqual(DEFAULT_SENSITIVE_ACTION_POLICY.enforced);

      const reloaded = await sensitiveActionGuard.getPolicy();
      expect(reloaded).toEqual(updated);
    });
  });
});
