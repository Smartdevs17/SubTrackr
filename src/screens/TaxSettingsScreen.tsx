import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { FormScreen } from '../components/common/ScreenTemplates';
import { useStore } from '../store';
import { colors, spacing, typography } from '../utils/constants';

const TaxSettingsScreen: React.FC = () => {
  const { config, calculations, reports, remittances, calculateTax, createReport } = useStore();

  const latestRemittance = remittances[remittances.length - 1];
  const totalCollected = useMemo(
    () => calculations.reduce((sum, calculation) => sum + calculation.tax, 0),
    [calculations]
  );

  const handleSampleCalculation = () => {
    calculateTax({
      subscriptionId: `sub-${calculations.length + 1}`,
      customerId: 'customer-1',
      region: 'US-CA',
      amount: 99,
      transactionDate: new Date(),
    });
  };

  const handleReport = () => {
    createReport('US-CA', new Date('2026-05-01T00:00:00.000Z'), new Date('2026-05-31T23:59:59.999Z'));
  };

  return (
    <FormScreen
      title="Tax Settings"
      subtitle="Rates, exemptions, reports, and remittance schedules"
      analyticsName="TaxSettings"
      rightAction={<Button title="Calculate" size="small" onPress={handleSampleCalculation} />}
      testID="tax-settings-screen">
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Configured regions</Text>
        {config.ratesByRegion.map((rate) => (
          <Text key={`${rate.region}-${rate.taxType}`} style={styles.row}>
            {rate.region}: {rate.taxType} at {(rate.rateBps / 100).toFixed(2)}%
          </Text>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Collection summary</Text>
        <Text style={styles.metric}>Transactions: {calculations.length}</Text>
        <Text style={styles.metric}>Tax collected: ${totalCollected.toFixed(2)}</Text>
        <Button title="Create US-CA report" variant="outline" onPress={handleReport} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Remittance</Text>
        <Text style={styles.row}>Schedule: {config.remittanceSchedule}</Text>
        <Text style={styles.row}>Reports created: {reports.length}</Text>
        {latestRemittance ? (
          <Text style={styles.row}>
            Next due: ${latestRemittance.amountDue.toFixed(2)} on{' '}
            {latestRemittance.dueDate.toLocaleDateString()}
          </Text>
        ) : (
          <Text style={styles.row}>Create a report to generate a remittance schedule.</Text>
        )}
      </Card>
    </FormScreen>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  row: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  metric: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
});

export default TaxSettingsScreen;
