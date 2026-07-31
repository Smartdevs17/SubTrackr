// Issue 561: RecommendationCard component

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing } from '../../utils/constants';
import type { RecommendationItem } from '../../types/upsell';

const TYPE_LABELS = {
  upgrade_tier: '⬆ Upgrade',
  add_on: '➕ Add-On',
  complementary_plan: '🔗 Bundle',
};

interface RecommendationCardProps {
  item: RecommendationItem;
  onPress?: (item: RecommendationItem) => void;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({ item, onPress }) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(item)}
      accessibilityRole="button"
      accessibilityLabel={`Recommendation: ${item.planName}`}>
      <View style={styles.header}>
        <Text style={styles.typeLabel}>{TYPE_LABELS[item.type]}</Text>
        <Text style={styles.score}>{Math.round(item.score * 100)}% match</Text>
      </View>
      <Text style={styles.planName}>{item.planName}</Text>
      <Text style={styles.description}>{item.description}</Text>
      <View style={styles.footer}>
        <Text style={styles.price}>
          {item.currency} {item.price.toFixed(2)}/mo
        </Text>
        {item.commission !== undefined && (
          <Text style={styles.commission}>{item.commission}% commission</Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  score: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  commission: {
    fontSize: 12,
    color: '#1E8E3E',
    fontWeight: '600',
  },
});
