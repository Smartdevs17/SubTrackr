import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import {
  PricingService,
  PriceRecommendation,
  ABTestScenario,
} from '../../backend/services/pricingService';

const PricingOptimizationScreen = () => {
  const [loading, setLoading] = useState(true);
  const [recommendation, setRecommendation] = useState<PriceRecommendation | null>(null);
  const [abTests, setAbTests] = useState<ABTestScenario[]>([]);
  const [activeTest, setActiveTest] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const rec = await PricingService.calculateOptimalPrice('sub_123', {
        current_price: 14.99,
        competitor_avg: 12.99,
        current_demand: 1.2,
        usage_data: {
          retention_rate: 0.85,
          sessions_per_week: 10,
        },
      });
      const tests = await PricingService.getPriceRecommendations('plan_gold');
      setRecommendation(rec);
      setAbTests(tests);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderMetric = (label: string, value: string | number, subtext?: string) => (
    <View style={styles.metricContainer}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {subtext && <Text style={styles.metricSubtext}>{subtext}</Text>}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pricing Optimization</Text>
        <Text style={styles.subtitle}>AI-Powered Revenue Maximization</Text>
      </View>

      <Card style={styles.mainCard}>
        <Text style={styles.cardTitle}>Optimal Price Recommendation</Text>
        <View style={styles.priceRow}>
          <Text style={styles.currentPrice}>$14.99</Text>
          <Text style={styles.arrow}>→</Text>
          <Text style={styles.optimalPrice}>${recommendation?.optimalPrice}</Text>
        </View>
        <View
          style={[
            styles.badge,
            {
              backgroundColor:
                recommendation?.recommendation === 'Increase' ? '#E6F4EA' : '#FCE8E6',
            },
          ]}>
          <Text
            style={[
              styles.badgeText,
              { color: recommendation?.recommendation === 'Increase' ? '#1E8E3E' : '#D93025' },
            ]}>
            {recommendation?.recommendation} Recommendation
          </Text>
        </View>

        <View style={styles.factorsGrid}>
          {renderMetric('Demand Factor', `${recommendation?.factors.demandImpact}x`, 'High Demand')}
          {renderMetric(
            'Comp. Avg',
            `$${recommendation?.factors.competitorBenchmark}`,
            'Market Bench'
          )}
          {renderMetric('WTP Est.', `$${recommendation?.factors.willingnessToPay}`, 'User Value')}
        </View>
      </Card>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>A/B Testing Strategies</Text>
        {abTests.map((test, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.testCard, activeTest === test.tier && styles.activeTestCard]}
            onPress={() => setActiveTest(test.tier)}>
            <View style={styles.testHeader}>
              <Text style={styles.testTier}>{test.tier}</Text>
              <Text style={styles.testPrice}>${test.price}</Text>
            </View>
            <Text style={styles.testReasoning}>{test.reasoning}</Text>
            {activeTest === test.tier && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>ACTIVE TEST</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Demand Forecast</Text>
        <Card style={styles.chartPlaceholder}>
          <View style={styles.barChart}>
            {[40, 60, 45, 90, 75, 80, 95].map((h, i) => (
              <View key={i} style={[styles.bar, { height: h }]} />
            ))}
          </View>
          <View style={styles.chartLabels}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
              <Text key={i} style={styles.chartLabel}>
                {l}
              </Text>
            ))}
          </View>
        </Card>
      </View>

      <Button title="Apply Recommended Pricing" onPress={() => {}} style={styles.applyButton} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: spacing.xl,
    paddingTop: 60,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  mainCard: {
    margin: spacing.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  currentPrice: {
    fontSize: 24,
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  arrow: {
    fontSize: 24,
    marginHorizontal: spacing.md,
    color: colors.textSecondary,
  },
  optimalPrice: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.primary,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    marginBottom: spacing.xl,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  factorsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  metricContainer: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  metricSubtext: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.md,
  },
  testCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeTestCard: {
    borderColor: colors.primary,
    backgroundColor: '#F8F9FF',
  },
  testHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  testTier: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  testPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  testReasoning: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  activeBadge: {
    position: 'absolute',
    top: -8,
    right: 12,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  chartPlaceholder: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    width: '100%',
    height: 100,
  },
  bar: {
    width: 20,
    backgroundColor: colors.primary,
    borderRadius: 4,
    opacity: 0.7,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: spacing.md,
  },
  chartLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  applyButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
});

export default PricingOptimizationScreen;
