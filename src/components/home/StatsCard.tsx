import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { formatCurrencyCompact } from '../../utils/formatting';

interface StatsCardProps {
  totalMonthlySpend: number;
  totalActive: number;
  onWalletPress: () => void;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  totalMonthlySpend,
  totalActive,
  onWalletPress,
}) => {
  return (
    <View style={styles.container} accessibilityRole="summary">
      {/* Monthly Spend Card - Primary Focus */}
      <View
        style={[styles.card, styles.primaryCard]}
        accessible={true}
        accessibilityLabel={`Total monthly spend: ${formatCurrencyCompact(totalMonthlySpend)}`}>
        <Text style={styles.label} accessibilityElementsHidden={true}>
          Monthly Spend
        </Text>
        <Text
          style={[styles.value, styles.primaryValue]}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityElementsHidden={true}>
          {formatCurrencyCompact(totalMonthlySpend)}
        </Text>
      </View>

      {/* Active Count Card */}
      <View
        style={styles.card}
        accessible={true}
        accessibilityLabel={`Active subscriptions: ${totalActive}`}>
        <Text style={styles.label} accessibilityElementsHidden={true}>
          Active
        </Text>
        <Text style={styles.value} accessibilityElementsHidden={true}>
          {totalActive}
        </Text>
      </View>

      {/* Wallet Action Card */}
      <TouchableOpacity
        onPress={onWalletPress}
        style={[styles.card, styles.walletCard]}
        accessibilityRole="button"
        accessibilityLabel="Connect wallet"
        accessibilityHint="Opens the wallet connection screen">
        <Text style={[styles.label, { color: colors.accent }]}>Wallet</Text>
        <Text style={styles.icon} accessibilityElementsHidden={true}>
          🔗
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.md,
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  primaryCard: {
    flex: 1.2, // Give the spending card a bit more visual weight
    borderColor: colors.primary + '30', // Subtle primary tint
    backgroundColor: colors.surface,
  },
  walletCard: {
    backgroundColor: colors.accent + '10', // Very light tint of accent
    borderColor: colors.accent + '30',
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
    fontWeight: '600',
  },
  value: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  primaryValue: {
    color: colors.primary,
    fontWeight: '800',
  },
  icon: {
    fontSize: 20,
    marginTop: 2,
  },
});
