import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import type { CrashRecord } from '../services/crashReporter';

interface Props {
  visible: boolean;
  crash: CrashRecord | null;
  onRecover: () => Promise<void>;
  onDismiss: () => void;
}

const CrashRecoveryModal: React.FC<Props> = ({ visible, crash, onRecover, onDismiss }) => {
  const [recovering, setRecovering] = React.useState(false);

  const handleRecover = async () => {
    setRecovering(true);
    await onRecover();
    setRecovering(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.card}>
            <Text style={styles.icon}>⚠️</Text>
            <Text style={styles.title}>App Recovered from a Crash</Text>
            <Text style={styles.body}>
              The app crashed during your last session. Your data may be in an inconsistent state.
              We can attempt to restore it now.
            </Text>

            {__DEV__ && crash && (
              <View style={styles.devBox}>
                <Text style={styles.devLabel}>Debug info</Text>
                <Text style={styles.devText} numberOfLines={3}>
                  {crash.message}
                </Text>
                <Text style={styles.devText}>{crash.timestamp}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleRecover}
              disabled={recovering}
              accessibilityRole="button"
              accessibilityLabel="Attempt data recovery">
              {recovering ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.primaryBtnText}>Recover Data</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onDismiss}
              disabled={recovering}
              accessibilityRole="button"
              accessibilityLabel="Continue without recovering">
              <Text style={styles.secondaryBtnText}>Continue Without Recovering</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  safeArea: {
    flex: 0,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  icon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  devBox: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  devLabel: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  devText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  secondaryBtnText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

export default CrashRecoveryModal;
