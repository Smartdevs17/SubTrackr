import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { spacing, typography, borderRadius } from '../utils/constants';
import { Card } from '../components/common/Card';
import { useThemeColors } from '../hooks/useThemeColors';
import { useSubscriptionStore } from '../store';

const ChurnPredictionScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { subscriptions } = useSubscriptionStore();
  const [predictions, setPredictions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const activeSubs = subscriptions.filter((s) => s.isActive);

  const fetchPredictions = async () => {
    setLoading(true);
    try {
      // Simulate API call to backend which calls ML service
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockPredictions = activeSubs.map((s) => {
        const risk = Math.random();
        let level = 'Low';
        if (risk > 0.7) level = 'High';
        else if (risk > 0.4) level = 'Medium';

        return {
          id: s.id,
          name: s.name,
          churnProbability: risk,
          riskLevel: level,
          recommendedAction: level === 'High' ? 'Apply 10% Discount' : 'No action needed',
        };
      });
      setPredictions(mockPredictions);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPredictions();
  }, [activeSubs.length]);

  const handleRunInterventions = async () => {
    Alert.alert('Interventions Started', 'Automated interventions are running in the background.');
    // In a real scenario, this calls a backend endpoint to trigger InterventionService
  };

  const highRisk = predictions.filter((p) => p.riskLevel === 'High').length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Churn Analytics</Text>
          <Text style={styles.subtitle}>ML-Powered Churn Prediction Dashboard</Text>
        </View>

        <View style={styles.summaryContainer}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Analyzed</Text>
            <Text style={styles.summaryValue}>{predictions.length}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>High Risk</Text>
            <Text style={[styles.summaryValue, { color: colors.status.error }]}>{highRisk}</Text>
          </Card>
        </View>

        <TouchableOpacity style={styles.actionButton} onPress={handleRunInterventions}>
          <Text style={styles.actionButtonText}>Run Automated Interventions</Text>
        </TouchableOpacity>

        <Card style={styles.listCard}>
          <Text style={styles.chartTitle}>Subscriber Risk Scoring</Text>
          {loading ? (
            <Text style={styles.noDataText}>Analyzing data...</Text>
          ) : predictions.length > 0 ? (
            predictions.map((p) => (
              <View key={p.id} style={styles.projectionItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectionLabel}>{p.name}</Text>
                  <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                    Action: {p.recommendedAction}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={[
                      styles.projectionValue,
                      p.riskLevel === 'High'
                        ? { color: colors.status.error }
                        : p.riskLevel === 'Medium'
                          ? { color: colors.status.warning }
                          : { color: colors.status.success },
                    ]}>
                    {p.riskLevel} ({(p.churnProbability * 100).toFixed(1)}%)
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noDataText}>No active subscriptions to analyze.</Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: any) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    header: { padding: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary },
    summaryContainer: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    summaryCard: { flex: 1, alignItems: 'center' },
    summaryLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    summaryValue: { ...typography.h2, color: colors.text.primary },
    actionButton: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      backgroundColor: colors.primary,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    actionButtonText: {
      ...typography.button,
      color: colors.text.inverse,
    },
    listCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
    chartTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    projectionItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    projectionLabel: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    projectionValue: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    noDataText: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
  });
}

export default ChurnPredictionScreen;
