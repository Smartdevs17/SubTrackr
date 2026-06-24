import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { PredictionService, ChurnPrediction } from '../../backend/services/predictionService';

const ChurnPredictionScreen = () => {
  const [loading, setLoading] = useState(true);
  const [prediction, setPrediction] = useState<ChurnPrediction | null>(null);

  useEffect(() => {
    fetchPrediction();
  }, []);

  const fetchPrediction = async () => {
    setLoading(true);
    try {
      const mockData = {
        recentPaymentFailures: 2,
        baselineLoginsPerMonth: 20,
        recentLogins: 10,
        openSupportTickets: 1,
        priceSensitivityIndex: 0.8,
      };
      const res = await PredictionService.predictChurn('0xUSER123', mockData);
      setPrediction(res);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'High':
        return '#D93025';
      case 'Medium':
        return '#F29900';
      case 'Low':
        return '#1E8E3E';
      default:
        return colors.textSecondary;
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Retention & Churn Risk</Text>
        <Text style={styles.subtitle}>ML-Powered Subscriber Insights</Text>
      </View>

      {prediction && (
        <>
          <Card style={styles.mainCard}>
            <Text style={styles.cardTitle}>Churn Risk Level</Text>
            <Text style={[styles.riskLevel, { color: getRiskColor(prediction.riskLevel) }]}>
              {prediction.riskLevel}
            </Text>
            <Text style={styles.probabilityText}>
              Probability: {(prediction.churnProbability * 100).toFixed(1)}%
            </Text>

            <View style={styles.actionContainer}>
              <Text style={styles.actionLabel}>Recommended Action:</Text>
              <Text style={styles.actionText}>{prediction.recommendedAction}</Text>
            </View>
          </Card>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Key Risk Factors</Text>
            {prediction.riskFactors.map((factor, index) => (
              <Card key={index} style={styles.factorCard}>
                <View style={styles.factorRow}>
                  <Text style={styles.factorName}>
                    {factor.factor
                      .split('_')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ')}
                  </Text>
                  <Text style={styles.factorImpact}>
                    Impact: {(factor.impact * 100).toFixed(0)}%
                  </Text>
                </View>
                {/* Progress bar to represent impact visually */}
                <View style={styles.progressBackground}>
                  <View style={[styles.progressFill, { width: `${factor.impact * 100}%` }]} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

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
    marginBottom: spacing.sm,
  },
  riskLevel: {
    fontSize: 42,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  probabilityText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  actionContainer: {
    backgroundColor: '#F8F9FF',
    padding: spacing.md,
    borderRadius: 8,
    width: '100%',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  actionLabel: {
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  actionText: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.md,
  },
  factorCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  factorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  factorName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  factorImpact: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: 'bold',
  },
  progressBackground: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
});

export default ChurnPredictionScreen;
