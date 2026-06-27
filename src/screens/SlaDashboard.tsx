import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useStore } from '../store';
import { SlaAvailabilityState } from '../types/sla';
import { SLA_DEFAULTS } from '../services/slaService';

const STATE_OPTIONS: { label: string; value: SlaAvailabilityState; description: string }[] = [
  { label: 'Healthy', value: 'healthy', description: 'Full availability' },
  { label: 'Partial', value: 'partial_outage', description: 'Degraded service' },
  { label: 'Outage', value: 'full_outage', description: 'Full downtime' },
  { label: 'Maintenance', value: 'maintenance', description: 'Planned maintenance' },
];

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const SlaDashboard: React.FC = () => {
  const {
    configs,
    statuses,
    breaches,
    report,
    configureSla,
    trackServiceAvailability,
    refreshReport,
  } = useStore();
  const [merchantId, setMerchantId] = useState('merchant-demo');
  const [uptimeTarget, setUptimeTarget] = useState(String(SLA_DEFAULTS.uptimeTarget));
  const [measurementInterval, setMeasurementInterval] = useState(
    String(SLA_DEFAULTS.measurementInterval)
  );
  const [durationSeconds, setDurationSeconds] = useState('3600');
  const [state, setState] = useState<SlaAvailabilityState>('healthy');
  const [note, setNote] = useState('');

  const merchantStatus = useMemo(() => statuses[merchantId] ?? null, [merchantId, statuses]);
  const merchantConfig = useMemo(() => configs[merchantId] ?? null, [merchantId, configs]);
  const merchantBreaches = useMemo(
    () => breaches.filter((breach) => breach.merchantId === merchantId),
    [breaches, merchantId]
  );

  const onConfigure = () => {
    void configureSla(merchantId.trim(), {
      uptimeTarget: Number(uptimeTarget),
      measurementInterval: Number(measurementInterval),
    });
  };

  const onRecordAvailability = () => {
    void trackServiceAvailability(merchantId.trim(), {
      durationSeconds: Number(durationSeconds),
      state,
      note: note.trim() || undefined,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Merchant SLA</Text>
          <Text style={styles.title}>Availability monitoring and compliance reporting</Text>
          <Text style={styles.subtitle}>
            Configure targets, track outages, and review breach credits in one place.
          </Text>
        </View>

        <View style={styles.summaryGrid}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Average Uptime</Text>
            <Text style={styles.summaryValue}>{formatPercent(report.summary.averageUptime)}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Open Breaches</Text>
            <Text style={styles.summaryValue}>{report.summary.breachCount}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Credits Issued</Text>
            <Text style={styles.summaryValue}>{report.summary.totalCreditsIssued}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Compliant Merchants</Text>
            <Text style={styles.summaryValue}>
              {report.summary.compliantMerchants}/{report.summary.totalMerchants}
            </Text>
          </Card>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Configure SLA</Text>
          <TextInput
            style={styles.input}
            value={merchantId}
            onChangeText={setMerchantId}
            placeholder="Merchant ID"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />
          <View style={styles.inlineInputs}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={uptimeTarget}
              onChangeText={setUptimeTarget}
              placeholder="Uptime target"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={measurementInterval}
              onChangeText={setMeasurementInterval}
              placeholder="Interval (secs)"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={onConfigure}>
            <Text style={styles.primaryButtonText}>Save SLA</Text>
          </TouchableOpacity>
          {merchantConfig && (
            <Text style={styles.helperText}>
              Target {merchantConfig.uptimeTarget}% over {merchantConfig.measurementInterval}{' '}
              seconds
            </Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Service Availability</Text>
          <View style={styles.pillGrid}>
            {STATE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.statePill, state === option.value && styles.statePillActive]}
                onPress={() => setState(option.value)}>
                <Text
                  style={[
                    styles.statePillLabel,
                    state === option.value && styles.statePillLabelActive,
                  ]}>
                  {option.label}
                </Text>
                <Text style={styles.statePillDescription}>{option.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={durationSeconds}
            onChangeText={setDurationSeconds}
            placeholder="Duration in seconds"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Optional note"
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity style={styles.secondaryButton} onPress={onRecordAvailability}>
            <Text style={styles.secondaryButtonText}>Record Availability</Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.summaryGrid}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Current Uptime</Text>
            <Text style={styles.summaryValue}>
              {merchantStatus ? formatPercent(merchantStatus.uptimePercentage) : '100.00%'}
            </Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Status</Text>
            <Text style={styles.summaryValue}>
              {merchantStatus ? (merchantStatus.compliant ? 'Compliant' : 'Breached') : 'Idle'}
            </Text>
          </Card>
        </View>

        <Card style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Merchant Status</Text>
            <TouchableOpacity onPress={refreshReport}>
              <Text style={styles.linkText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {merchantStatus ? (
            <View style={styles.statusPanel}>
              <Text style={styles.statusLine}>
                Target {merchantStatus.uptimeTarget}% over {merchantStatus.measurementInterval}s
              </Text>
              <Text style={styles.statusLine}>
                Observed {merchantStatus.observedSeconds.toFixed(0)}s with{' '}
                {merchantStatus.downtimeSeconds.toFixed(0)}s downtime
              </Text>
              <Text style={styles.statusLine}>
                Partial outages {merchantStatus.partialOutageSeconds.toFixed(0)}s, maintenance{' '}
                {merchantStatus.maintenanceSeconds.toFixed(0)}s
              </Text>
              <Text style={styles.statusLine}>Credits: {merchantStatus.creditBalance}</Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>
              Configure a merchant SLA to see the live status panel.
            </Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Breaches</Text>
          {merchantBreaches.length > 0 ? (
            merchantBreaches.map((breach) => (
              <View key={breach.id} style={styles.breachRow}>
                <View style={styles.breachHeader}>
                  <Text style={styles.breachTitle}>Breach {breach.id.slice(-6)}</Text>
                  <Text style={styles.breachCredit}>{breach.creditAmount}</Text>
                </View>
                <Text style={styles.breachMeta}>
                  Uptime {formatPercent(breach.uptimePercentage)} vs target {breach.uptimeTarget}%
                </Text>
                <Text style={styles.breachMeta}>
                  Downtime {breach.downtimeSeconds.toFixed(0)}s, detected{' '}
                  {new Date(breach.detectedAt).toLocaleString()}
                </Text>
                <Text style={styles.breachMeta}>
                  {breach.resolvedAt
                    ? `Resolved ${new Date(breach.resolvedAt).toLocaleString()}`
                    : 'Open breach'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No breaches recorded for this merchant yet.</Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Reporting Snapshot</Text>
          <Text style={styles.helperText}>
            Partial outages: {report.summary.partialOutageEvents} | Scheduled maintenance:{' '}
            {report.summary.maintenanceEvents}
          </Text>
          <Text style={styles.helperText}>
            Known merchants: {Object.keys(report.configs).length} | Open breaches:{' '}
            {report.summary.breachCount}
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    marginBottom: spacing.sm,
  },
  kicker: {
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontSize: typography.small.fontSize,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  summaryCard: {
    flexGrow: 1,
    minWidth: '47%',
  },
  summaryLabel: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    ...typography.h2,
    color: colors.text,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineInput: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: typography.small.fontSize,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statePill: {
    flexBasis: '48%',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    gap: spacing.xs,
  },
  statePillActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  statePillLabel: {
    color: colors.text,
    fontWeight: '700',
  },
  statePillLabelActive: {
    color: colors.accent,
  },
  statePillDescription: {
    color: colors.textSecondary,
    fontSize: typography.small.fontSize,
  },
  statusPanel: {
    gap: spacing.xs,
  },
  statusLine: {
    color: colors.text,
    fontSize: typography.body.fontSize,
  },
  breachRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  breachHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breachTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  breachCredit: {
    color: colors.warning,
    fontWeight: '700',
  },
  breachMeta: {
    color: colors.textSecondary,
    fontSize: typography.small.fontSize,
  },
  linkText: {
    color: colors.accent,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textSecondary,
  },
});

export default SlaDashboard;
