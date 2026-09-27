import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { usePlanStore } from '../store/planStore';
import { useTheme } from '../theme/useTheme';
import type { SubscriptionPlan } from '../types/plan';

export default function PlanComparisonScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { plans, comparison, isLoading, loadPlans, comparePlans } = usePlanStore();
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);

  useEffect(() => {
    loadPlans();
  }, []);

  const togglePlanSelection = (planId: string) => {
    setSelectedPlans(prev => 
      prev.includes(planId) ? prev.filter(id => id !== planId) : [...prev, planId]
    );
  };

  const handleCompare = async () => {
    if (selectedPlans.length < 2) {
      alert('Please select at least 2 plans to compare');
      return;
    }
    await comparePlans(selectedPlans);
    navigation.navigate('PlanComparisonDetail');
  };

  const renderPlanCard = (plan: SubscriptionPlan) => {
    const isSelected = selectedPlans.includes(plan.id);
    
    return (
      <TouchableOpacity
        key={plan.id}
        style={[
          styles.planCard,
          { backgroundColor: theme.colors.card },
          isSelected && { borderColor: theme.colors.primary, borderWidth: 2 },
          plan.isPopular && styles.popularCard,
        ]}
        onPress={() => togglePlanSelection(plan.id)}
      >
        {plan.isPopular && (
          <View style={[styles.popularBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.popularText}>POPULAR</Text>
          </View>
        )}
        
        <Text style={[styles.planName, { color: theme.colors.text }]}>{plan.name}</Text>
        <Text style={[styles.planDescription, { color: theme.colors.textSecondary }]}>
          {plan.description}
        </Text>
        
        <View style={styles.priceContainer}>
          <Text style={[styles.currency, { color: theme.colors.text }]}>{plan.currency}</Text>
          <Text style={[styles.price, { color: theme.colors.text }]}>{plan.price.toFixed(2)}</Text>
          <Text style={[styles.cycle, { color: theme.colors.textSecondary }]}>/{plan.billingCycle}</Text>
        </View>

        {plan.discount && (
          <View style={[styles.discountBadge, { backgroundColor: '#10B981' }]}>
            <Text style={styles.discountText}>Save {plan.discount.percentage}%</Text>
          </View>
        )}

        <View style={styles.features}>
          {plan.features.slice(0, 3).map(feature => (
            <View key={feature.id} style={styles.featureRow}>
              <Text style={[styles.featureIcon, { color: feature.included ? '#10B981' : '#EF4444' }]}>
                {feature.included ? '✓' : '✗'}
              </Text>
              <Text style={[styles.featureName, { color: theme.colors.text }]}>
                {feature.name}
              </Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.selectButton,
            { backgroundColor: isSelected ? theme.colors.primary : theme.colors.card, borderColor: theme.colors.primary },
          ]}
          onPress={() => togglePlanSelection(plan.id)}
        >
          <Text style={[styles.selectButtonText, { color: isSelected ? '#FFFFFF' : theme.colors.primary }]}>
            {isSelected ? 'Selected' : 'Select'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (isLoading && plans.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Compare Plans</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          Select 2 or more plans to compare
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.plansScroll}>
        <View style={styles.plansContainer}>
          {plans.map(renderPlanCard)}
        </View>
      </ScrollView>

      {selectedPlans.length >= 2 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.compareButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleCompare}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.compareButtonText}>
                Compare {selectedPlans.length} Plans
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 14 },
  plansScroll: { flex: 1 },
  plansContainer: { flexDirection: 'row', padding: 16, gap: 16 },
  planCard: { width: 280, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  popularCard: { transform: [{ scale: 1.05 }] },
  popularBadge: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  popularText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  planName: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  planDescription: { fontSize: 14, marginBottom: 16, minHeight: 40 },
  priceContainer: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 12 },
  currency: { fontSize: 16, fontWeight: '600', marginRight: 4 },
  price: { fontSize: 36, fontWeight: 'bold' },
  cycle: { fontSize: 14, marginLeft: 4 },
  discountBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 16 },
  discountText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  features: { marginBottom: 20, gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center' },
  featureIcon: { fontSize: 16, marginRight: 8, fontWeight: 'bold' },
  featureName: { fontSize: 14, flex: 1 },
  selectButton: { paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 2 },
  selectButtonText: { fontSize: 16, fontWeight: '600' },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  compareButton: { paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  compareButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
});
