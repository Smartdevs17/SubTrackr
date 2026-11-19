import { renderHook, act } from '@testing-library/react-hooks';
import { useDeviceIntegrity } from '../useDeviceIntegrity';
import {
  deviceAttestationService,
  DeviceIntegrityResult,
} from '../../services/auth/deviceAttestationService';

jest.mock('../../services/auth/deviceAttestationService', () => {
  const actual = jest.requireActual('../../services/auth/deviceAttestationService');
  return {
    ...actual,
    deviceAttestationService: {
      checkIntegrity: jest.fn(),
      getCachedIntegrity: jest.fn(),
      isOperationAllowed: jest.fn(),
      assertOperationAllowed: jest.fn(),
    },
  };
});

describe('useDeviceIntegrity hook', () => {
  const mockIntactResult: DeviceIntegrityResult = {
    isIntact: true,
    isRooted: false,
    isJailbroken: false,
    isEmulator: false,
    isTampered: false,
    riskLevel: 'low',
    compromiseIndicators: [],
    degradationPolicy: {
      riskLevel: 'low',
      allowBasicAccess: true,
      allowSensitiveTransactions: true,
      allowBiometrics: true,
      allowLocalKeyExport: true,
      allowOfflineSecretsStorage: true,
      requireStepUpAuth: false,
    },
    attestedAt: Date.now(),
  };

  const mockCompromisedResult: DeviceIntegrityResult = {
    isIntact: false,
    isRooted: true,
    isJailbroken: false,
    isEmulator: false,
    isTampered: false,
    riskLevel: 'critical',
    compromiseIndicators: ['android_root_path:/sbin/su'],
    degradationPolicy: {
      riskLevel: 'critical',
      allowBasicAccess: true,
      allowSensitiveTransactions: false,
      allowBiometrics: false,
      allowLocalKeyExport: false,
      allowOfflineSecretsStorage: false,
      requireStepUpAuth: true,
      warningMessage: 'Device compromised',
    },
    attestedAt: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with cached integrity when available and fresh', async () => {
    (deviceAttestationService.getCachedIntegrity as jest.Mock).mockResolvedValue(mockIntactResult);

    const { result, waitForNextUpdate } = renderHook(() => useDeviceIntegrity());

    expect(result.current.isChecking).toBe(true);
    await waitForNextUpdate();

    expect(result.current.isChecking).toBe(false);
    expect(result.current.result).toEqual(mockIntactResult);
    expect(result.current.isCompromised).toBe(false);
    expect(result.current.riskLevel).toBe('low');
  });

  it('runs fresh check when cached integrity is missing', async () => {
    (deviceAttestationService.getCachedIntegrity as jest.Mock).mockResolvedValue(null);
    (deviceAttestationService.checkIntegrity as jest.Mock).mockResolvedValue(mockCompromisedResult);

    const { result, waitForNextUpdate } = renderHook(() => useDeviceIntegrity());

    await waitForNextUpdate();

    expect(deviceAttestationService.checkIntegrity).toHaveBeenCalled();
    expect(result.current.isChecking).toBe(false);
    expect(result.current.result).toEqual(mockCompromisedResult);
    expect(result.current.isCompromised).toBe(true);
    expect(result.current.riskLevel).toBe('critical');
  });

  it('allows dismissing banner state', async () => {
    (deviceAttestationService.getCachedIntegrity as jest.Mock).mockResolvedValue(
      mockCompromisedResult
    );

    const { result, waitForNextUpdate } = renderHook(() => useDeviceIntegrity());
    await waitForNextUpdate();

    expect(result.current.bannerDismissed).toBe(false);

    act(() => {
      result.current.dismissBanner();
    });

    expect(result.current.bannerDismissed).toBe(true);
  });

  it('recheck invokes checkIntegrity with force refresh', async () => {
    (deviceAttestationService.getCachedIntegrity as jest.Mock).mockResolvedValue(mockIntactResult);
    (deviceAttestationService.checkIntegrity as jest.Mock).mockResolvedValue(mockCompromisedResult);

    const { result, waitForNextUpdate } = renderHook(() => useDeviceIntegrity());
    await waitForNextUpdate();

    await act(async () => {
      await result.current.recheck();
    });

    expect(deviceAttestationService.checkIntegrity).toHaveBeenCalledWith(true);
    expect(result.current.result).toEqual(mockCompromisedResult);
    expect(result.current.isCompromised).toBe(true);
  });
});
