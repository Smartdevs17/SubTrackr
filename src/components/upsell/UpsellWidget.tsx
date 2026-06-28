// Issue 561: UpsellWidget – embeddable recommendation widget for mobile and web

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../utils/constants';
import { RecommendationCard } from './RecommendationCard';
import { recommendationService } from '../../../backend/services/upsell/recommendationService';
import type {
  CollaborativeFilteringInput,
  RecommendationItem,
  RecommendationTrigger,
  UpsellRecommendation,
} from '../../types/upsell';

export interface UpsellWidgetProps {
  subscriberId: string;
  merchantId: string;
  trigger: RecommendationTrigger;
  currentPlanId: string;
  currentPlanTierRank?: number;
  similarSubscriberPlanIds?: string[];
  usageScore?: number;
  onConvert?: (item: RecommendationItem) => void;
}

export const UpsellWidget: React.FC<UpsellWidgetProps> = ({
  subscriberId,
  merchantId,
  trigger,
  currentPlanId,
  currentPlanTierRank = 1,
  similarSubscriberPlanIds = [],
  usageScore = 0.5,
  onConvert,
}) => {
  const [recommendation, setRecommendation] = useState<UpsellRecommendation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    try {
      const variant = recommendationService.assignABVariant(subscriberId);
      const input: CollaborativeFilteringInput = {
        subscriberId,
        currentPlanId,
        usageScore,
        similarSubscriberPlanIds,
      };
      const rec = recommendationService.recommend(
        subscriberId,
        merchantId,
        trigger,
        input,
        currentPlanTierRank,
        variant
      );
      setRecommendation(rec);
      if (rec) {
        // Track impression for each item
        rec.items.forEach((item) =>
          recommendationService.trackEvent(rec.id, item.id, 'impression')
        );
      }
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [
    subscriberId,
    merchantId,
    trigger,
    currentPlanId,
    currentPlanTierRank,
    similarSubscriberPlanIds,
    usageScore,
  ]);

  const handleCardPress = (item: RecommendationItem) => {
    if (!recommendation) return;
    recommendationService.trackEvent(recommendation.id, item.id, 'click');
    onConvert?.(item);
    recommendationService.trackEvent(recommendation.id, item.id, 'conversion', item.price);
  };

  if (!loaded) {
    return (
      <TouchableOpacity
        style={styles.loadTrigger}
        onPress={load}
        accessibilityRole="button"
        accessibilityLabel="Load recommendations">
        <Text style={styles.loadTriggerText}>See Recommended Upgrades</Text>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!recommendation || recommendation.items.length === 0) {
    return null; // No recommendations (control variant or max tier)
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="region"
      accessibilityLabel="Upsell recommendations">
      <Text style={styles.heading}>Recommended for You</Text>
      <Text style={styles.subheading}>{TRIGGER_LABELS[trigger]}</Text>
      {recommendation.items.map((item) => (
        <RecommendationCard key={item.id} item={item} onPress={handleCardPress} />
      ))}
    </View>
  );
};

const TRIGGER_LABELS: Record<RecommendationTrigger, string> = {
  checkout: 'Complete your setup with these add-ons',
  usage_threshold: "You're growing fast — consider upgrading",
  renewal_window: 'Maximize value at renewal time',
  support_request: 'These plans could prevent future issues',
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  subheading: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  loadTrigger: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  loadTriggerText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
});
