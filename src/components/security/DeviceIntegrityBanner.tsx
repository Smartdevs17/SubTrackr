import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AccessibilityInfo } from 'react-native';
import { useDeviceIntegrity } from '../../hooks/useDeviceIntegrity';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';

export interface DeviceIntegrityBannerProps {
  onLearnMore?: () => void;
}

export const DeviceIntegrityBanner: React.FC<DeviceIntegrityBannerProps> = ({ onLearnMore }) => {
  const { result, isCompromised, riskLevel, bannerDismissed, dismissBanner } = useDeviceIntegrity();
  const [showDetails, setShowDetails] = useState(false);

  // Only render if device is compromised or at high/critical risk and not dismissed
  if (!isCompromised && riskLevel !== 'critical' && riskLevel !== 'high') {
    return null;
  }

  if (bannerDismissed) {
    return null;
  }

  const isCritical = riskLevel === 'critical';
  const bannerColor = isCritical ? colors.error : colors.warning;
  const badgeText = isCritical ? 'SECURITY ALERT' : 'SECURITY NOTICE';
  const title = result?.isRooted
    ? 'Rooted Android Device Detected'
    : result?.isJailbroken
      ? 'Jailbroken iOS Device Detected'
      : result?.isTampered
        ? 'Application Tampering Detected'
        : 'Device Integrity Compromised';

  const defaultMessage =
    result?.degradationPolicy?.warningMessage ||
    'Your device environment is modified. Sensitive actions (such as crypto signing and private key exports) are restricted for your safety while standard tracking remains active.';

  const handleToggleDetails = () => {
    setShowDetails((prev) => !prev);
    AccessibilityInfo.announceForAccessibility(
      showDetails ? 'Details collapsed' : 'Details expanded'
    );
  };

  return (
    <View
      style={[styles.container, { borderColor: bannerColor }]}
      testID="device-integrity-banner"
      accessibilityRole="alert"
      accessibilityLabel={`${badgeText}: ${title}. ${defaultMessage}`}>
      <View style={styles.headerRow}>
        <View style={[styles.badge, { backgroundColor: bannerColor }]}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
        <TouchableOpacity
          onPress={dismissBanner}
          style={styles.dismissButton}
          accessibilityRole="button"
          accessibilityLabel="Dismiss security alert"
          testID="device-integrity-dismiss">
          <Text style={styles.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.titleText}>{title}</Text>
      <Text style={styles.bodyText}>{defaultMessage}</Text>

      {showDetails && result?.compromiseIndicators && (
        <View style={styles.detailsBox} testID="device-integrity-details">
          <Text style={styles.detailsTitle}>Detected Signals:</Text>
          {result.compromiseIndicators.map((indicator, index) => (
            <Text key={index} style={styles.indicatorText}>
              • {indicator}
            </Text>
          ))}
          <Text style={styles.policyNotice}>
            Mode: Graceful Degradation (Read-only / Safe operations permitted)
          </Text>
        </View>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={handleToggleDetails}
          style={styles.linkButton}
          accessibilityRole="button"
          accessibilityLabel={showDetails ? 'Hide security details' : 'Show security details'}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {showDetails ? 'Hide details' : 'Show details'}
          </Text>
        </TouchableOpacity>

        {onLearnMore && (
          <TouchableOpacity
            onPress={onLearnMore}
            style={styles.linkButton}
            accessibilityRole="button"
            accessibilityLabel="Learn more about device integrity policy">
            <Text style={[styles.linkText, { color: colors.accent }]}>Security policy</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dismissButton: {
    padding: spacing.xs,
  },
  dismissText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  titleText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: 4,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  detailsBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
  },
  detailsTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  indicatorText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 2,
  },
  policyNotice: {
    marginTop: 6,
    color: colors.warning,
    fontSize: 11,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  linkButton: {
    paddingVertical: 2,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
