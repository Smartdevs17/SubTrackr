/**
 * RateLimitConfigPanel — developer portal component for configuring per-key
 * and per-user rate limits.
 *
 * Features:
 *   - View current tier limits
 *   - Set custom hourly / daily / monthly / burst / concurrent limits per key
 *   - Manage bypass list (trusted keys and user IDs)
 *   - Live status display (remaining quota)
 *   - Accessibility: all interactive elements have aria labels and are keyboard navigable
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyRateLimitConfig {
  apiKey: string;
  hourlyLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  burstLimit?: number;
  concurrentLimit?: number;
}

export interface BypassEntry {
  type: 'key' | 'user';
  value: string;
}

export interface RateLimitStatus {
  limits: {
    hourlyLimit: number;
    dailyLimit: number;
    monthlyLimit: number;
    burstLimit: number;
    concurrentLimit: number;
  };
  current: {
    hourly: number;
    daily: number;
    monthly: number;
    burstTokens: number;
  };
  remaining: {
    hourly: number;
    daily: number;
    monthly: number;
    burstTokens: number;
  };
  resetAt: {
    hourly: number;
    daily: number;
    monthly: number;
  };
}

export interface RateLimitConfigPanelProps {
  /** The API key whose limits are being configured. */
  apiKey: string;
  /** Current rate-limit status for the key (from the API). */
  status?: RateLimitStatus | null;
  /** Bypass entries currently in the service. */
  bypassEntries?: BypassEntry[];
  /** Whether the key is currently bypassed. */
  isBypassed?: boolean;
  /** Called when the user saves a custom config. */
  onSaveConfig: (config: KeyRateLimitConfig) => Promise<void>;
  /** Called to add or remove a bypass entry. */
  onBypassChange: (entry: BypassEntry, action: 'add' | 'remove') => Promise<void>;
  /** Called to toggle bypass for this specific key. */
  onToggleBypass?: (apiKey: string, bypass: boolean) => Promise<void>;
  /** Whether the panel is in a loading state. */
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parseOptInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function formatReset(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.ceil(diff / 3_600_000);
  return `${hrs}h`;
}

function UsageBar({ current, limit, label }: { current: number; limit: number; label: string }) {
  const pct = Math.min(100, limit > 0 ? (current / limit) * 100 : 0);
  const color = pct >= 90 ? '#EF4444' : pct >= 75 ? '#F59E0B' : '#22C55E';
  return (
    <View
      style={barStyles.wrapper}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={barStyles.row}>
        <Text style={barStyles.label}>{label}</Text>
        <Text style={barStyles.counts}>
          {current.toLocaleString()} / {limit.toLocaleString()}
        </Text>
      </View>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={barStyles.pct}>{pct.toFixed(1)}%</Text>
    </View>
  );
}

const barStyles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 13, color: '#374151', fontWeight: '500' },
  counts: { fontSize: 13, color: '#6B7280' },
  track: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const RateLimitConfigPanel: React.FC<RateLimitConfigPanelProps> = ({
  apiKey,
  status,
  bypassEntries = [],
  isBypassed = false,
  onSaveConfig,
  onBypassChange,
  onToggleBypass,
  loading = false,
}) => {
  const [hourly, setHourly] = useState('');
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [burst, setBurst] = useState('');
  const [concurrent, setConcurrent] = useState('');
  const [saving, setSaving] = useState(false);

  const [bypassType, setBypassType] = useState<'key' | 'user'>('key');
  const [bypassValue, setBypassValue] = useState('');
  const [bypassLoading, setBypassLoading] = useState(false);

  const handleSave = useCallback(async () => {
    const config: KeyRateLimitConfig = {
      apiKey,
      hourlyLimit: parseOptInt(hourly),
      dailyLimit: parseOptInt(daily),
      monthlyLimit: parseOptInt(monthly),
      burstLimit: parseOptInt(burst),
      concurrentLimit: parseOptInt(concurrent),
    };

    // Validate: daily must be ≥ hourly if both specified
    if (config.hourlyLimit && config.dailyLimit && config.dailyLimit < config.hourlyLimit) {
      Alert.alert('Validation Error', 'Daily limit must be greater than or equal to hourly limit.');
      return;
    }

    setSaving(true);
    try {
      await onSaveConfig(config);
      Alert.alert('Saved', 'Rate limit configuration updated successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save rate limit configuration.');
    } finally {
      setSaving(false);
    }
  }, [apiKey, hourly, daily, monthly, burst, concurrent, onSaveConfig]);

  const handleAddBypass = useCallback(async () => {
    if (!bypassValue.trim()) {
      Alert.alert('Validation Error', 'Please enter a key or user ID to bypass.');
      return;
    }
    setBypassLoading(true);
    try {
      await onBypassChange({ type: bypassType, value: bypassValue.trim() }, 'add');
      setBypassValue('');
    } catch {
      Alert.alert('Error', 'Failed to add bypass entry.');
    } finally {
      setBypassLoading(false);
    }
  }, [bypassType, bypassValue, onBypassChange]);

  const handleRemoveBypass = useCallback(
    async (entry: BypassEntry) => {
      setBypassLoading(true);
      try {
        await onBypassChange(entry, 'remove');
      } catch {
        Alert.alert('Error', 'Failed to remove bypass entry.');
      } finally {
        setBypassLoading(false);
      }
    },
    [onBypassChange]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading rate limit configuration…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* ------------------------------------------------------------------ */}
      {/* Live Status                                                          */}
      {/* ------------------------------------------------------------------ */}
      {status && (
        <View style={styles.card} accessibilityLabel="Current rate limit usage">
          <Text style={styles.cardTitle}>Current Usage</Text>
          <UsageBar
            label="Hourly"
            current={status.current.hourly}
            limit={status.limits.hourlyLimit}
          />
          <UsageBar label="Daily" current={status.current.daily} limit={status.limits.dailyLimit} />
          <UsageBar
            label="Monthly"
            current={status.current.monthly}
            limit={status.limits.monthlyLimit}
          />
          <UsageBar
            label="Burst tokens"
            current={status.limits.burstLimit - status.current.burstTokens}
            limit={status.limits.burstLimit}
          />

          <View style={styles.resetRow}>
            <Text style={styles.resetLabel}>Hourly reset:</Text>
            <Text style={styles.resetValue}>{formatReset(status.resetAt.hourly)}</Text>
            <Text style={styles.resetLabel}>Daily reset:</Text>
            <Text style={styles.resetValue}>{formatReset(status.resetAt.daily)}</Text>
            <Text style={styles.resetLabel}>Monthly reset:</Text>
            <Text style={styles.resetValue}>{formatReset(status.resetAt.monthly)}</Text>
          </View>
        </View>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Bypass toggle for this key                                           */}
      {/* ------------------------------------------------------------------ */}
      {onToggleBypass && (
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Bypass Rate Limiting</Text>
              <Text style={styles.toggleHint}>
                Trusted service accounts can skip all rate checks.
              </Text>
            </View>
            <Switch
              value={isBypassed}
              onValueChange={(v) => onToggleBypass(apiKey, v)}
              trackColor={{ false: '#D1D5DB', true: '#3B82F6' }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Toggle rate limit bypass for this key"
            />
          </View>
          {isBypassed && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                ⚠️ This key bypasses all rate limits. Use only for trusted internal services.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Custom Limits                                                        */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Custom Limits</Text>
        <Text style={styles.cardSubtitle}>
          Override the tier defaults for this specific API key. Leave blank to use tier defaults.
        </Text>

        {[
          {
            label: 'Hourly limit',
            value: hourly,
            setter: setHourly,
            placeholder: `e.g. ${status?.limits.hourlyLimit ?? 100}`,
          },
          {
            label: 'Daily limit',
            value: daily,
            setter: setDaily,
            placeholder: `e.g. ${status?.limits.dailyLimit ?? 2400}`,
          },
          {
            label: 'Monthly limit',
            value: monthly,
            setter: setMonthly,
            placeholder: `e.g. ${status?.limits.monthlyLimit ?? 72000}`,
          },
          {
            label: 'Burst limit',
            value: burst,
            setter: setBurst,
            placeholder: `e.g. ${status?.limits.burstLimit ?? 20}`,
          },
          {
            label: 'Concurrent limit',
            value: concurrent,
            setter: setConcurrent,
            placeholder: `e.g. ${status?.limits.concurrentLimit ?? 5}`,
          },
        ].map(({ label, value, setter, placeholder }) => (
          <View key={label} style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setter}
              keyboardType="number-pad"
              placeholder={placeholder}
              placeholderTextColor="#9CA3AF"
              accessibilityLabel={label}
            />
          </View>
        ))}

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save custom rate limit configuration">
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Save Configuration</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Bypass List Management                                               */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bypass List</Text>
        <Text style={styles.cardSubtitle}>
          Keys and user IDs in this list skip rate limiting entirely.
        </Text>

        {/* Type selector */}
        <View style={styles.typeSelector}>
          {(['key', 'user'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeBtn, bypassType === t && styles.typeBtnActive]}
              onPress={() => setBypassType(t)}
              accessibilityRole="radio"
              accessibilityState={{ selected: bypassType === t }}
              accessibilityLabel={`Bypass type: ${t === 'key' ? 'API key' : 'User ID'}`}>
              <Text style={[styles.typeBtnText, bypassType === t && styles.typeBtnTextActive]}>
                {t === 'key' ? 'API Key' : 'User ID'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.addBypassRow}>
          <TextInput
            style={[styles.input, styles.bypassInput]}
            value={bypassValue}
            onChangeText={setBypassValue}
            placeholder={bypassType === 'key' ? 'Enter API key…' : 'Enter user ID…'}
            placeholderTextColor="#9CA3AF"
            accessibilityLabel={`${bypassType === 'key' ? 'API key' : 'User ID'} to add to bypass list`}
          />
          <TouchableOpacity
            style={[styles.addBtn, bypassLoading && styles.buttonDisabled]}
            onPress={handleAddBypass}
            disabled={bypassLoading}
            accessibilityRole="button"
            accessibilityLabel="Add to bypass list">
            {bypassLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.addBtnText}>Add</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing bypass entries */}
        {bypassEntries.length === 0 ? (
          <Text style={styles.emptyText}>No bypass entries configured.</Text>
        ) : (
          bypassEntries.map((entry, idx) => (
            <View key={`${entry.type}-${entry.value}-${idx}`} style={styles.bypassItem}>
              <View style={styles.bypassBadge}>
                <Text style={styles.bypassBadgeText}>{entry.type === 'key' ? 'KEY' : 'USER'}</Text>
              </View>
              <Text style={styles.bypassValue} numberOfLines={1}>
                {entry.value}
              </Text>
              <TouchableOpacity
                onPress={() => handleRemoveBypass(entry)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entry.value} from bypass list`}
                style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Info: what do these limits mean                                      */}
      {/* ------------------------------------------------------------------ */}
      <View style={[styles.card, styles.infoCard]}>
        <Text style={styles.infoTitle}>ℹ️ About Rate Limits</Text>
        <Text style={styles.infoText}>
          <Text style={styles.bold}>Hourly limit:</Text> Maximum requests in a rolling 60-minute
          window.{'\n'}
          <Text style={styles.bold}>Daily limit:</Text> Maximum requests in a rolling 24-hour
          window.{'\n'}
          <Text style={styles.bold}>Monthly limit:</Text> Maximum requests in a rolling 30-day
          window.{'\n'}
          <Text style={styles.bold}>Burst limit:</Text> Token bucket size for short-lived request
          spikes.{'\n'}
          <Text style={styles.bold}>Concurrent limit:</Text> Max simultaneous in-flight requests.
          {'\n\n'}
          Per-user limits aggregate across all API keys owned by the same user account and are set
          to 5× the per-key hourly limit.
        </Text>
      </View>
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  button: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  resetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 8,
  },
  resetLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  resetValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    marginRight: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  toggleHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  warningText: {
    fontSize: 13,
    color: '#92400E',
  },
  typeSelector: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  typeBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  typeBtnTextActive: {
    color: '#3B82F6',
  },
  addBypassRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  bypassInput: {
    flex: 1,
  },
  addBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  bypassItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  bypassBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  bypassBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
    letterSpacing: 0.5,
  },
  bypassValue: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    fontFamily: 'monospace',
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 8,
  },
  infoCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 20,
  },
  bold: {
    fontWeight: '700',
  },
});

export default RateLimitConfigPanel;
