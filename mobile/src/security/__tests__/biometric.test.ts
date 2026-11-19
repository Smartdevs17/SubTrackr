import { requireBiometricReAuth } from '../biometric';
import { biometricService } from '../../../../src/services/auth/biometricService';

jest.mock('../../../../src/services/auth/biometricService', () => ({
  biometricService: {
    isAvailable: jest.fn(),
    checkLockout: jest.fn(),
    authenticateHardened: jest.fn(),
  },
}));

const mockService = biometricService as jest.Mocked<typeof biometricService>;

beforeEach(() => {
  jest.clearAllMocks();
  mockService.isAvailable.mockResolvedValue(true);
  mockService.checkLockout.mockResolvedValue({ locked: false, remainingMs: 0 });
  mockService.authenticateHardened.mockResolvedValue({ success: true });
});

describe('requireBiometricReAuth', () => {
  it('grants when authentication succeeds', async () => {
    const result = await requireBiometricReAuth('update_payment_method');
    expect(result.granted).toBe(true);
    expect(mockService.authenticateHardened).toHaveBeenCalledWith(
      'Confirm your identity to update your payment method',
    );
  });

  it('grants (biometrics_unavailable) when device has no enrolled biometrics', async () => {
    mockService.isAvailable.mockResolvedValue(false);
    const result = await requireBiometricReAuth('change_plan');
    expect(result.granted).toBe(true);
    expect(result.reason).toBe('biometrics_unavailable');
    expect(mockService.authenticateHardened).not.toHaveBeenCalled();
  });

  it('denies with locked_out when too many failures', async () => {
    mockService.checkLockout.mockResolvedValue({ locked: true, remainingMs: 5 * 60 * 1000 });
    const result = await requireBiometricReAuth('cancel_subscription');
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('locked_out');
    expect(result.message).toContain('5 minute');
    expect(mockService.authenticateHardened).not.toHaveBeenCalled();
  });

  it('denies with cancelled when user dismisses the prompt', async () => {
    mockService.authenticateHardened.mockResolvedValue({ success: false, cancelled: true });
    const result = await requireBiometricReAuth('update_billing_address');
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('cancelled');
  });

  it('denies with failed when biometrics reject the user', async () => {
    mockService.authenticateHardened.mockResolvedValue({
      success: false,
      error: 'Too many failed attempts',
    });
    const result = await requireBiometricReAuth('apply_promo_code');
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('failed');
    expect(result.message).toContain('Too many failed attempts');
  });

  it('grants even if isAvailable throws (graceful degradation)', async () => {
    mockService.isAvailable.mockRejectedValue(new Error('native module unavailable'));
    const result = await requireBiometricReAuth('change_plan');
    expect(result.granted).toBe(true);
  });
});
