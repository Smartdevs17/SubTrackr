import { useState, useEffect, useCallback } from 'react';
import {
  deviceAttestationService,
  DeviceIntegrityResult,
  RiskLevel,
  SensitiveOperation,
} from '../services/auth/deviceAttestationService';

export interface DeviceIntegrityState {
  result: DeviceIntegrityResult | null;
  isChecking: boolean;
  error: string | null;
  isCompromised: boolean;
  riskLevel: RiskLevel;
  isOperationAllowed: (operation: SensitiveOperation) => boolean;
  assertOperationAllowed: (operation: SensitiveOperation) => void;
  recheck: () => Promise<void>;
  bannerDismissed: boolean;
  dismissBanner: () => void;
}

export function useDeviceIntegrity(): DeviceIntegrityState {
  const [result, setResult] = useState<DeviceIntegrityResult | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const check = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      const integrity = await deviceAttestationService.checkIntegrity(true);
      setResult(integrity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Device integrity check failed');
    } finally {
      setIsChecking(false);
    }
  }, []);

  const isOperationAllowed = useCallback(
    (operation: SensitiveOperation): boolean => {
      return deviceAttestationService.isOperationAllowed(operation, result?.degradationPolicy);
    },
    [result]
  );

  const assertOperationAllowed = useCallback(
    (operation: SensitiveOperation): void => {
      deviceAttestationService.assertOperationAllowed(operation, result ?? undefined);
    },
    [result]
  );

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const cached = await deviceAttestationService.getCachedIntegrity();
        if (cached && Date.now() - cached.attestedAt < 24 * 60 * 60 * 1000) {
          if (mounted) {
            setResult(cached);
            setIsChecking(false);
          }
        } else {
          const fresh = await deviceAttestationService.checkIntegrity();
          if (mounted) {
            setResult(fresh);
            setIsChecking(false);
          }
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Device integrity check failed');
          setIsChecking(false);
        }
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const riskLevel = result?.riskLevel ?? 'low';
  const isCompromised =
    !result?.isIntact && (result?.isRooted || result?.isJailbroken || result?.isTampered || false);

  return {
    result,
    isChecking,
    error,
    isCompromised,
    riskLevel,
    isOperationAllowed,
    assertOperationAllowed,
    recheck: check,
    bannerDismissed,
    dismissBanner,
  };
}
