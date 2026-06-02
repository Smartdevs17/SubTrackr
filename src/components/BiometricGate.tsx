/**
 * BiometricGate — wraps the app and prompts for biometric auth on launch.
 *
 * Place this inside App.tsx around <AppNavigator />. It renders a lock screen
 * until the user authenticates. If biometrics are disabled in settings it
 * renders children immediately.
 *
 * <BiometricGate>
 *   <AppNavigator />
 * </BiometricGate>
 */

import React, { useEffect, useState, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useBiometricAuth } from '../hooks/useBiometricAuth';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

const BIOMETRIC_ICON: Record<string, string> = {
  fingerprint: '👆',
  facial: '🪪',
  iris: '👁️',
  none: '🔒',
};

interface Props {
  children: ReactNode;
}

const BiometricGate: React.FC<Props> = ({ children }) => {
  const {
    isAvailable,
    isLoading,
    isAuthenticated,
    error,
    cancelled,
    supportedTypes,
    settings,
    authenticate,
    clearError,
  } = useBiometricAuth();

  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  // Re-lock when app comes back from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState === 'background' && next === 'active' && settings.enabled) {
        // Re-prompt on foreground
        void authenticate();
      }
      setAppState(next);
    });
    return () => sub.remove();
  }, [appState, settings.enabled, authenticate]);

  // Auto-prompt on mount when biometrics are enabled
  useEffect(() => {
    if (!isLoading && settings.enabled && isAvailable && !isAuthenticated) {
      void authenticate();
    }
  }, [isLoading, settings.enabled, isAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pass through immediately when biometrics are disabled or unavailable
  if (!settings.enabled || !isAvailable) {
    return <>{children}</>;
  }

  // Show children once authenticated
  if (isAuthenticated) {
    return <>{children}</>;
  }

  const icon = BIOMETRIC_ICON[supportedTypes[0] ?? 'none'];

  return (
    <SafeAreaView style={styles.container} testID="biometric-gate">
      <View style={styles.card}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>SubTrackr is Locked</Text>
        <Text style={styles.subtitle}>
          Authenticate to access your subscriptions and wallet.
        </Text>

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.spinner}
            accessibilityLabel="Authenticating"
          />
        ) : (
          <>
            {error && !cancelled && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.btn}
              onPress={() => { clearError(); void authenticate(); }}
              accessibilityRole="button"
              accessibilityLabel="Unlock with biometrics">
              <Text style={styles.btnText}>
                {cancelled ? 'Try Again' : `Unlock with ${supportedTypes[0] === 'facial' ? 'Face ID' : 'Biometrics'}`}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: { fontSize: 56, marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  spinner: { marginVertical: spacing.lg },
  errorBox: {
    backgroundColor: colors.error + '22',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    width: '100%',
  },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
    alignItems: 'center',
    width: '100%',
  },
  btnText: { ...typography.body, color: colors.text, fontWeight: '700' },
});

export default BiometricGate;
