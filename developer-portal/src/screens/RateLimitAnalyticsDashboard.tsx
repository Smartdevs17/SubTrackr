/**
 * RateLimitAnalyticsDashboard — developer portal screen displaying rate-limit
 * analytics: hit rate, throttled keys, per-tier breakdown, and hourly trends.
 *
 * Accessibility compliant (WCAG 2.1 AA):
 *   - All progress indicators have accessibilityRole="progressbar"
 *   - Colour is not the sole indicator of state (text labels added)
 *   - Keyboard navigable (all interactive elements are TouchableOpacity)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TierBreakdown {
  requests: number;
  hits: number;
  hitRate: number;
}

interface ThrottledEntry {
  key: string;
  hits: number;
}

export interface RateLimitAnalyticsData {
  totalRequests: number;
  rateLimitHits: number;
  hitRate: number;
  topThrottledKeys: ThrottledEntry[];
  topThrottledEndpoints: ThrottledEntry[];
  byTier: Record<string, TierBreakdown>;
}

export interface HourlyDataPoint {
  hour: string;
  requests: number;
  hits: number;
}

export interface RateLimitAnalyticsDashboardProps {
  /** Fetch analytics from the API. */
  onFetchAnalytics: () => Promise<RateLimitAnalyticsData>;
  /** Optional hourly trend data. */
  hourlyData?: HourlyDataPoint[];
  /** Optional period selector (default: '24h'). */
  defaultPeriod?: '24h' | '7d' | '30d';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <View
      style={statStyles.card}
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={[statStyles.value, accent ? { color: accent } : {}]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {sub && <Text style={statStyles.sub}>{sub}</Text>}
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    color: '#6B7280',
  },
  sub: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
});

function TierRow({ tier, data }: { tier: string; data: TierBreakdown }) {
  const pct = Math.min(100, Math.round(data.hitRate * 100));
  const color = pct >= 20 ? '#EF4444' : pct >= 5 ? '#F59E0B' : '#22C55E';
  const label = pct >= 20 ? 'High' : pct >= 5 ? 'Medium' : 'Low';

  return (
    <View style={tierStyles.row} accessibilityRole="listitem">
      <View style={tierStyles.left}>
        <Text style={tierStyles.tier}>{tier}</Text>
        <Text style={tierStyles.reqs}>{data.requests.toLocaleString()} requests</Text>
      </View>
      <View style={tierStyles.right}>
        <View style={tierStyles.badgeRow}>
          <View style={[tierStyles.badge, { backgroundColor: `${color}20`, borderColor: color }]}>
            <Text style={[tierStyles.badgeText, { color }]}>{label}</Text>
          </View>
          <Text style={tierStyles.pct}>{pct}% throttled</Text>
        </View>
        <View
          style={tierStyles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          accessibilityLabel={`${tier} throttle rate ${pct}%`}>
          <View style={[tierStyles.fill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={tierStyles.hits}>{data.hits.toLocaleString()} hits</Text>
      </View>
    </View>
  );
}

const tierStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    alignItems: 'flex-start',
  },
  left: { flex: 1, paddingRight: 8 },
  tier: { fontSize: 14, fontWeight: '600', color: '#111827', textTransform: 'capitalize' },
  reqs: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  right: { flex: 1, alignItems: 'flex-end' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  pct: { fontSize: 12, color: '#374151' },
  track: {
    width: '100%',
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 2,
  },
  fill: { height: '100%', borderRadius: 3 },
  hits: { fontSize: 11, color: '#9CA3AF' },
});

function ThrottledList({ title, entries }: { title: string; entries: ThrottledEntry[] }) {
  if (entries.length === 0) {
    return (
      <View style={listStyles.empty}>
        <Text style={listStyles.emptyText}>No throttled {title.toLowerCase()} in this period.</Text>
      </View>
    );
  }
  const max = entries[0]?.hits ?? 1;
  return (
    <View accessibilityRole="list" accessibilityLabel={title}>
      {entries.map((e, i) => {
        const pct = Math.round((e.hits / max) * 100);
        return (
          <View key={e.key} style={listStyles.row} accessibilityRole="listitem">
            <Text style={listStyles.rank} accessibilityElementsHidden>
              #{i + 1}
            </Text>
            <View style={listStyles.middle}>
              <Text style={listStyles.key} numberOfLines={1}>
                {e.key}
              </Text>
              <View
                style={listStyles.track}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: pct }}>
                <View style={[listStyles.fill, { width: `${pct}%` }]} />
              </View>
            </View>
            <Text style={listStyles.hits}>{e.hits.toLocaleString()}</Text>
          </View>
        );
      })}
    </View>
  );
}

const listStyles = StyleSheet.create({
  empty: { paddingVertical: 12 },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rank: { width: 28, fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  middle: { flex: 1, marginHorizontal: 8 },
  key: { fontSize: 12, color: '#374151', fontFamily: 'monospace', marginBottom: 4 },
  track: { height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#EF4444', borderRadius: 2 },
  hits: { width: 48, fontSize: 12, fontWeight: '600', color: '#111827', textAlign: 'right' },
});

function TrendChart({ data }: { data: HourlyDataPoint[] }) {
  const maxReqs = Math.max(...data.map((d) => d.requests), 1);
  return (
    <View
      style={chartStyles.container}
      accessibilityRole="image"
      accessibilityLabel="Hourly request and throttle trend chart">
      {data.map((d, i) => {
        const reqH = Math.max(4, (d.requests / maxReqs) * 100);
        const hitH = Math.max(0, (d.hits / maxReqs) * 100);
        return (
          <View key={i} style={chartStyles.col}>
            <View style={chartStyles.barWrap}>
              <View style={[chartStyles.barReq, { height: reqH }]} />
              {d.hits > 0 && <View style={[chartStyles.barHit, { height: hitH }]} />}
            </View>
            {i % 4 === 0 && <Text style={chartStyles.label}>{d.hour}</Text>}
          </View>
        );
      })}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 8 },
  col: { flex: 1, alignItems: 'center' },
  barWrap: { height: 100, justifyContent: 'flex-end', width: '80%', position: 'relative' },
  barReq: { backgroundColor: '#BFDBFE', borderRadius: 2, width: '100%' },
  barHit: {
    backgroundColor: '#EF4444',
    borderRadius: 2,
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  label: { fontSize: 9, color: '#9CA3AF', marginTop: 4 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const PERIODS = ['24h', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

export const RateLimitAnalyticsDashboard: React.FC<RateLimitAnalyticsDashboardProps> = ({
  onFetchAnalytics,
  hourlyData = [],
  defaultPeriod = '24h',
}) => {
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [analytics, setAnalytics] = useState<RateLimitAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'keys' | 'endpoints'>('keys');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await onFetchAnalytics();
        setAnalytics(data);
        AccessibilityInfo.announceForAccessibility('Rate limit analytics updated.');
      } catch {
        setError('Failed to load rate limit analytics. Please try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onFetchAnalytics]
  );

  useEffect(() => {
    void load();
  }, [period, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  if (loading && !analytics) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading analytics…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => void load()}
          accessibilityRole="button">
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const a = analytics!;
  const hitPct = ((a.hitRate ?? 0) * 100).toFixed(1);

  const tierOrder = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'];
  const sortedTiers = Object.entries(a.byTier).sort(
    ([a], [b]) => tierOrder.indexOf(a) - tierOrder.indexOf(b)
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Rate Limit Analytics</Text>
        <Text style={styles.subtitle}>
          Monitor throttled requests and quota usage across your API.
        </Text>
      </View>

      {/* Period selector */}
      <View
        style={styles.periodRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Select time period">
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
            accessibilityRole="radio"
            accessibilityState={{ selected: period === p }}
            accessibilityLabel={`Period: ${p}`}>
            <Text style={[styles.periodBtnText, period === p && styles.periodBtnTextActive]}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats grid */}
      <View style={styles.grid}>
        <StatCard label="Total Requests" value={a.totalRequests.toLocaleString()} sub={period} />
        <StatCard
          label="Rate Limit Hits"
          value={a.rateLimitHits.toLocaleString()}
          accent={a.rateLimitHits > 0 ? '#EF4444' : undefined}
        />
        <StatCard
          label="Throttle Rate"
          value={`${hitPct}%`}
          sub={a.rateLimitHits > 0 ? 'action needed' : 'healthy'}
          accent={parseFloat(hitPct) >= 5 ? '#EF4444' : '#22C55E'}
        />
        <StatCard label="Tier Count" value={`${sortedTiers.length}`} sub="active tiers" />
      </View>

      {/* Trend chart */}
      {hourlyData.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Requests vs. Throttles (hourly)</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#BFDBFE' }]} />
            <Text style={styles.legendText}>Requests</Text>
            <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
            <Text style={styles.legendText}>Throttled</Text>
          </View>
          <TrendChart data={hourlyData} />
        </View>
      )}

      {/* Tier breakdown */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>By Subscription Tier</Text>
        <View accessibilityRole="list">
          {sortedTiers.map(([tier, data]) => (
            <TierRow key={tier} tier={tier} data={data} />
          ))}
          {sortedTiers.length === 0 && (
            <Text style={styles.emptyText}>No tier data available.</Text>
          )}
        </View>
      </View>

      {/* Throttled keys / endpoints */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {activeTab === 'keys' ? 'Top Throttled API Keys' : 'Top Throttled Endpoints'}
        </Text>

        <View style={styles.tabRow} accessibilityRole="tablist">
          {(['keys', 'endpoints'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, activeTab === t && styles.tabActive]}
              onPress={() => setActiveTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === t }}
              accessibilityLabel={`Tab: ${t === 'keys' ? 'Top throttled keys' : 'Top throttled endpoints'}`}>
              <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
                {t === 'keys' ? 'API Keys' : 'Endpoints'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ThrottledList
          title={activeTab === 'keys' ? 'keys' : 'endpoints'}
          entries={activeTab === 'keys' ? a.topThrottledKeys : a.topThrottledEndpoints}
        />
      </View>

      {/* Guidance */}
      <View style={[styles.card, styles.guideCard]}>
        <Text style={styles.guideTitle}>💡 Tips to Reduce Throttling</Text>
        <Text style={styles.guideText}>
          • Implement exponential back-off when you receive a 429 response.{'\n'}• Cache API
          responses where possible to reduce request volume.{'\n'}• Use webhooks instead of polling
          for event-driven use cases.{'\n'}• Upgrade to a higher tier if you consistently hit hourly
          limits.{'\n'}• Add trusted service accounts to the bypass list via the Configuration
          panel.
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
  errorText: {
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  periodRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    padding: 12,
    gap: 8,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  periodBtnActive: {
    backgroundColor: '#3B82F6',
  },
  periodBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  periodBtnTextActive: {
    color: '#FFFFFF',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: '#6B7280',
    marginRight: 8,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#1D4ED8',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 12,
  },
  guideCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    marginBottom: 32,
  },
  guideTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 8,
  },
  guideText: {
    fontSize: 13,
    color: '#15803D',
    lineHeight: 22,
  },
});

export default RateLimitAnalyticsDashboard;
