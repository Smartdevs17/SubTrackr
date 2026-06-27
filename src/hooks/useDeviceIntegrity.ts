import { useState, useEffect } from 'react';
import {
  deviceAttestationService,
  DeviceIntegrityResult,
} from '../services/auth/deviceAttestationService';

interface DeviceIntegrityState {
  result: DeviceIntegrityResult | null;
  isChecking: boolean;
  error: string | null;
  recheck: () => Promise<void>;
}

export function useDeviceIntegrity(): DeviceIntegrityState {
  const [result, setResult] = useState<DeviceIntegrityResult | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setIsChecking(true);
    setError(null);
    try {
      const integrity = await deviceAttestationService.checkIntegrity();
      setResult(integrity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Device integrity check failed');
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const cached = await deviceAttestationService.getCachedIntegrity();
      if (cached && Date.now() - cached.attestedAt < 24 * 60 * 60 * 1000) {
        setResult(cached);
        setIsChecking(false);
      } else {
        await check();
      }
    };
    init();
  }, []);

  return { result, isChecking, error, recheck: check };
}
