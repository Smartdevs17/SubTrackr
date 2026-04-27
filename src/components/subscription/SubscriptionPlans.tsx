import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { SubscriptionTier, SubscriptionPlan } from '../types/subscription';
import { FeatureId } from '../types/feature';
import { FEATURE_CONFIG } from '../config/features';
import { useUserStore } from '../store/userStore';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';

const { width } = Dimensions.get('window');
const cardWidth = (width - spacing.lg * 3) / 2; // Two cards per row

interface SubscriptionPlansProps {
  onSelectPlan?: (plan: SubscriptionPlan) => void;
  showCurrentPlan?: boolean;
}

/**
 * Component displaying available subscription plans
 */
export const SubscriptionPlans: React.FC<SubscriptionPlansProps> = ({
  onSelectPlan,
  showCurrentPlan = true,
}) => {
  const { subscriptionTier } = useUserStore();

  // Mock plans data - in real app this would come from API
  const plans: SubscriptionPlan[] = [
    {
      id: 'free',
      name: 'Free',
      tier: SubscriptionTier.FREE,
      price: 0,
      currency: 'USD',
      billingCycle: 'monthly' as any,
      features: FEATURE_CONFIG.plans[SubscriptionTier.FREE],
      limits: {},
      description: 'Perfect for getting started',
    },
    {
      id: 'basic',
      name: 'Basic',
      tier: SubscriptionTier.BASIC,
      price: 4.99,
      currency: 'USD',
      billingCycle: 'monthly' as any,
      features: FEATURE_CONFIG.plans[SubscriptionTier.BASIC],
      limits: {},
      description: 'Great for personal use',
    },
    {
      id: 'premium',
      name: 'Premium',
      tier: SubscriptionTier.PREMIUM,
      price: 9.99,
      currency: 'USD',
      billingCycle: 'monthly' as any,
      features: FEATURE_CONFIG.plans[SubscriptionTier.PREMIUM],
      limits: {},
      isPopular: true,
      description: 'Advanced features for power users',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      tier: SubscriptionTier.ENTERPRISE,
      price: 29.99,
      currency: 'USD',
      billingCycle: 'monthly' as any,
      features: FEATURE_CONFIG.plans[SubscriptionTier.ENTERPRISE],
      limits: {},
      description: 'Complete solution for teams',
    },
  ];

  const getFeatureName = (featureId: string): string => {
    const feature = FEATURE_CONFIG.features[featureId as FeatureId];
    return feature?.name || featureId.replace(/_/g, ' ');
  };

  const renderPlanCard = (plan: SubscriptionPlan) => {
    const isCurrentPlan = showCurrentPlan && plan.tier === subscriptionTier;
    const isPopular = plan.isPopular;

    return (
      <View key={plan.id} style={[styles.planCard, { width: cardWidth }]}>
        {isPopular && (
          <View style={styles.popularBadge}>
            <Text style={styles.popularText}>Most Popular</Text>
          </View>
        )}

        {isCurrentPlan && (
          <View style={styles.currentBadge}>
            <Text style={styles.currentText}>Current Plan</Text>
          </View>
        )}

        <View style={styles.planHeader}>
          <Text style={styles.planName}>{plan.name}</Text>
          <View style={styles.priceContainer}>
            <Text style={styles.price}>${plan.price}</Text>
            <Text style={styles.billingCycle}>/{plan.billingCycle.replace('ly', '')}</Text>
          </View>
          <Text style={styles.planDescription}>{plan.description}</Text>
        </View>

        <View style={styles.featuresList}>
          <Text style={styles.featuresTitle}>Features:</Text>
          {plan.features.slice(0, 5).map((featureId) => (
            <View key={featureId} style={styles.featureItem}>
              <Text style={styles.checkmark}>✓</Text>
              <Text style={styles.featureText}>{getFeatureName(featureId)}</Text>
            </View>
          ))}
          {plan.features.length > 5 && (
            <Text style={styles.moreFeatures}>+{plan.features.length - 5} more features</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.selectButton, isCurrentPlan && styles.currentButton]}
          onPress={() => onSelectPlan?.(plan)}
          disabled={isCurrentPlan}>
          <Text style={[styles.selectButtonText, isCurrentPlan && styles.currentButtonText]}>
            {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>Select the plan that best fits your needs</Text>
      </View>

      <View style={styles.plansGrid}>{plans.map((plan) => renderPlanCard(plan))}</View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          All plans include our core subscription tracking features. Upgrade or downgrade at any
          time.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  plansGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.md,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    left: '50%',
    transform: [{ translateX: -50 }],
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    zIndex: 1,
  },
  popularText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '600',
  },
  currentBadge: {
    position: 'absolute',
    top: -10,
    right: spacing.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    zIndex: 1,
  },
  currentText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '600',
  },
  planHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  planName: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  price: {
    ...typography.h1,
    color: colors.primary,
    fontWeight: 'bold',
  },
  billingCycle: {
    ...typography.body,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  planDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  featuresList: {
    marginBottom: spacing.lg,
  },
  featuresTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  checkmark: {
    ...typography.body,
    color: colors.success,
    marginRight: spacing.sm,
    fontWeight: 'bold',
  },
  featureText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  moreFeatures: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  selectButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  selectButtonText: {
    ...typography.button,
    color: colors.surface,
    fontWeight: '600',
  },
  currentButton: {
    backgroundColor: colors.success,
  },
  currentButtonText: {
    color: colors.surface,
  },
  footer: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
