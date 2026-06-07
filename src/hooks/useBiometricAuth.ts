/**
 * useBiometricAuth — React hook for biometric authentication.
 *
 * Handles the full lifecycle:
 *  - Checks hardware availability on mount
 *  - Exposes authenticate() to trigger the system prompt
 *  - Tracks loading / success / error state
 *  - Reads and writes user settings (enabled, fallbackToPIN)
 *
 * Usage:
 *   const { isAvailable, isAuthenticated, authenticate, settings, saveSettings } =
 *     useBiometricAuth();
 */

import { useState, useEffect, useCallback } from 'react';
import { biometricService, BiometricSettings, BiometricType } from '../services/auth/biometricService';

interface BiometricAuthState {
  /** True when the device has enrolled biometrics. */
  isAvailable: boolean;
  /** True while checking availability or authenticating. */
  isLoading: boolean;
  /** True after a successful authentication in this session. */
  isAuthenticated: boolean;
  /** Error message from the last failed attempt. */
  error: string | null;
  /** Whether the user cancelled the last prompt. */
  cancelled: boolean;
  /** Supported biometric types on this device. */
  supportedTypes: BiometricType[];
  /** Persisted user settings. */
  settings: BiometricSettings;
  /** Trigger the biometric prompt. */
  authenticate: (reason?: string) => Promise<boolean>;
  /** Persist updated settings. */
  saveSettings: (patch: Partial<BiometricSettings>) => Promise<void>;
  /** Clear the current error. */
  clearError: () => void;
}

export function useBiometricAuth(): BiometricAuthState {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [supportedTypes, setSupportedTypes] = useState<BiometricType[]>(['none']);
  const [settings, setSettings] = useState<BiometricSettings>({ enabled: false, fallbackToPIN: true });

  // Load availability and settings on mount
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const [available, types, savedSettings] = await Promise.all([
        biometricService.isAvailable(),
        biometricService.getSupportedTypes(),
        biometricService.getSettings(),
      ]);
      if (!cancelled) {
        setIsAvailable(available);
        setSupportedTypes(types);
        setSettings(savedSettings);
        setIsLoading(false);
      }
    };
    void init();
    return () => { cancelled = true; };
  }, []);

  const authenticate = useCallback(async (reason?: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    setCancelled(false);

    const result = await biometricService.authenticate(
      reason ?? 'Authenticate to access SubTrackr',
      settings.fallbackToPIN
    );

    setIsLoading(false);

    if (result.success) {
      setIsAuthenticated(true);
      return true;
    }

    setIsAuthenticated(false);
    setCancelled(result.cancelled ?? false);
    setError(result.error ?? 'Authentication failed.');
    return false;
  }, [settings.fallbackToPIN]);

  const saveSettings = useCallback(async (patch: Partial<BiometricSettings>) => {
    const updated = await biometricService.saveSettings(patch);
    setSettings(updated);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    isAvailable,
    isLoading,
    isAuthenticated,
    error,
    cancelled,
    supportedTypes,
    settings,
    authenticate,
    saveSettings,
    clearError,
  };
}
