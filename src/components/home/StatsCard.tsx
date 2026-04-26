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
    <View style={styles.statsContainer} accessibilityRole="summary">
      <View
        style={styles.statCard}
        accessible={true}
        accessibilityLabel={`Total monthly spend, ${formatCurrencyCompact(totalMonthlySpend)}`}>
        <Text
          style={styles.statLabel}
          accessibilityElementsHidden={true}
          importantForAccessibility="no">
          Total Monthly
        </Text>
        <Text
          style={styles.statValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityElementsHidden={true}
          importantForAccessibility="no">
          {formatCurrencyCompact(totalMonthlySpend)}
        </Text>
      </View>
      <View
        style={styles.statCard}
        accessible={true}
        accessibilityLabel={`Active subscriptions, ${totalActive}`}>
        <Text
          style={styles.statLabel}
          accessibilityElementsHidden={true}
          importantForAccessibility="no">
          Active Subs
        </Text>
        <Text
          style={styles.statValue}
          accessibilityElementsHidden={true}
          importantForAccessibility="no">
          {totalActive}
        </Text>
      </View>
      <View style={styles.statCard}>
        <TouchableOpacity
          onPress={onWalletPress}
          accessibilityRole="button"
          accessibilityLabel="Connect wallet"
          accessibilityHint="Opens the wallet connection screen">
          <Text style={styles.statLabel}>Wallet</Text>
          <Text
            style={styles.statValue}
            accessibilityElementsHidden={true}
            importantForAccessibility="no">
            🔗
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    ...shadows.sm,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
    minHeight: 22,
  },
});
