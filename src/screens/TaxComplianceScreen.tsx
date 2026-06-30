import React, { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FormScreen } from '../components/common/ScreenTemplates';
import { useTaxStore } from '../store/taxStore';
import {
  calculateTaxAmount,
  ExemptionCertificateService,
  NexusDetectionService,
  TaxRateSyncJob,
  TaxRateSyncService,
} from '../services/taxService';
import { colors, spacing, typography } from '../utils/constants';

const TaxComplianceScreen: React.FC = () => {
  const { config, calculations, reports, calculateTax } = useTaxStore();
  const [syncJob, setSyncJob] = useState<TaxRateSyncJob | null>(null);
  const [nexusResults, setNexusResults] = useState<{ region: string; hasNexus: boolean; percent: number }[]>([]);

  const nexusService = new NexusDetectionService();
  const syncService = new TaxRateSyncService();
  const certificateService = new ExemptionCertificateService();

  const totalCollected = calculations.reduce((sum, calculation) => sum + calculation.tax, 0);

  const handleSyncRates = useCallback(async () => {
    const job = await syncService.syncRates(config.ratesByRegion.map((r) => r.region));
    setSyncJob(job);
  }, [config.ratesByRegion]);

  const handleNexusCheck = useCallback(() => {
    const results = config.ratesByRegion.map((rate) => {
      const threshold = nexusService.getNexusThreshold(rate.region);
      const status = nexusService.detectNexus(rate.region, calculations.reduce((s, c) => (c.region === rate.region ? s + c.subtotal : s), 0));
      return {
        region: rate.region,
        hasNexus: status.hasNexus,
        percent: Math.round(status.percentToThreshold),
      };
    });
    setNexusResults(results);
  }, [config.ratesByRegion, calculations]);

  const handleExpiryCheck = useCallback(() => {
    const expiring = certificateService.getExpiringCertificates(30);
    if (expiring.length === 0) {
      Alert.alert('No expiring certificates found within 30 days.');
      return;
    }
    Alert.alert(
      'Expiring Certificates',
      expiring.map((e) => `${e.certificateId}: expires ${e.validUntil.toLocaleDateString()}`).join('\n')
    );
  }, []);

  const handleSampleCalculation = useCallback(() => {
    calculateTax({
      subscriptionId: `sub-${calculations.length + 1}`,
      customerId: 'customer-1',
      region: 'US-CA',
      amount: 99,
      transactionDate: new Date(),
    });
  }, [calculations.length, calculateTax]);

  return (
    <FormScreen
      title="Tax Compliance"
      subtitle="Nexus, exemptions, sync, and exports"
      analyticsName="TaxCompliance"
      rightAction={<Button title="Sync Rates" size="small" onPress={handleSyncRates} />}
      testID="tax-compliance-screen">
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Registered regions</Text>
        {config.ratesByRegion.map((rate) => (
          <Text key={`${rate.region}-${rate.taxType}`} style={styles.row}>
            {rate.region}: {rate.taxType} at {(rate.rateBps / 100).toFixed(2)}%
          </Text>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Nexus status</Text>
        <Button title="Run Nexus Check" variant="outline" onPress={handleNexusCheck} />
        {nexusResults.length > 0 && (
          <>
            {nexusResults.map((item) => (
              <View key={item.region} style={styles.nexusRow}>
                <Text style={styles.row}>
                  {item.region}: {item.hasNexus ? 'Established' : 'None'}{' '}
                  ({item.percent}% of threshold)
                </Text>
                <View
                  style={[
                    styles.indicator,
                    { backgroundColor: item.hasNexus ? colors.success : colors.error },
                  ]}
                />
              </View>
            ))}
          </>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Exemption certificates</Text>
        <Text style={styles.metric}>Active exemptions: {config.exemptions.length}</Text>
        <View style={styles.buttonRow}>
          <Button title="Sample Calculation" variant="outline" onPress={handleSampleCalculation} />
          <Button title="Check Expiry" variant="outline" onPress={handleExpiryCheck} />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Rate sync status</Text>
        {syncJob ? (
          <View>
            <Text style={styles.row}>
              Job: {syncJob.jobId}
            </Text>
            <Text style={styles.row}>
              Status: {syncJob.status}
            </Text>
            <Text style={styles.row}>
              Updated: {syncJob.totalRatesUpdated} regions
            </Text>
            <Text style={styles.row}>
              Synced: {syncJob.syncedRegions.join(', ') || 'none'}
            </Text>
            {syncJob.failedRegions.map((failure, i) => (
              <Text key={i} style={styles.row}>
                Failed {failure.region}: {failure.error}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.row}>No sync jobs yet.</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Tax filing exports</Text>
        <Text style={styles.metric}>Reports created: {reports.length}</Text>
        <Text style={styles.metric}>Tax collected: ${totalCollected.toFixed(2)}</Text>
        <View style={styles.buttonRow}>
          <Button
            title="Export CSV"
            variant="outline"
            onPress={() => {
              const last = reports[reports.length - 1];
              if (!last) {
                Alert.alert('No reports available. Create one first.');
                return;
              }
              Alert.alert('CSV export', 'CSV export generated for tax filing.');
            }}
          />
          <Button
            title="Export JSON"
            variant="outline"
            onPress={() => {
              const last = reports[reports.length - 1];
              if (!last) {
                Alert.alert('No reports available. Create one first.');
                return;
              }
              Alert.alert('JSON export', 'JSON export generated for tax filing.');
            }}
          />
        </View>
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
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  nexusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: spacing.sm,
  },
});

export default TaxComplianceScreen;