/**
 * SubscriptionDashboardScreen
 *
 * Issue #1181 — Implement responsive subscription management dashboard
 *
 * A mobile-first, cross-device dashboard that provides:
 *  - Overview cards for total active, monthly spend, upcoming renewals, and paused count
 *  - A filterable, sortable subscription list with status indicators
 *  - Plan-change and cancel quick-actions per subscription
 *  - Loading skeleton and empty states consistent with the existing design system
 *  - Responsive two-column layout on tablets / wide screens (≥ 768 px)
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { borderRadius, colors, spacing, typography } from '../utils/constants';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useSettingsStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { Subscription, BillingCycle, SubscriptionCategory } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';
import { Card } from '../components/common/Card';
import { StatsCardSkeleton, SubscriptionListSkeleton } from '../components/common/SkeletonLoader';

// ── Types ────────────────────────────────────────────────────────────────────

type DashboardNavProp = NativeStackNavigationProp<RootStackParamList>;

type SortField = 'name' | 'price' | 'nextBillingDate';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'active' | 'paused' | 'inactive';

interface OverviewMetric {
  label: string;
  value: string;
  icon: string;
  accent?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function daysUntil(date: Date): number {
  const now = Date.now();
  const target = new Date(date).getTime();
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

function billingCycleLabel(cycle: BillingCycle): string {
  switch (cycle) {
    case BillingCycle.MONTHLY:
      return '/mo';
    case BillingCycle.YEARLY:
      return '/yr';
    case BillingCycle.WEEKLY:
      return '/wk';
    default:
      return '';
  }
}

function statusColor(sub: Subscription): string {
  if (sub.isPaused) return colors.warning;
  if (sub.isActive) return colors.success;
  return colors.error;
}

function statusLabel(sub: Subscription): string {
  if (sub.isPaused) return 'Paused';
  if (sub.isActive) return 'Active';
  return 'Inactive';
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface MetricCardProps {
  metric: OverviewMetric;
  wide: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ metric, wide }) => (
  <Card
    style={[metricCardStyles.card, wide && metricCardStyles.cardWide]}
    accessibilityLabel={`${metric.label}: ${metric.value}`}>
    <Text style={metricCardStyles.icon} accessibilityElementsHidden>
      {metric.icon}
    </Text>
    <Text style={[metricCardStyles.value, metric.accent ? { color: metric.accent } : undefined]}>
      {metric.value}
    </Text>
    <Text style={metricCardStyles.label}>{metric.label}</Text>
  </Card>
);

const metricCardStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    alignItems: 'flex-start',
    padding: spacing.md,
  },
  cardWide: {
    minWidth: 160,
  },
  icon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.h2,
    color: colors.text,
    marginBottom: 2,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

// ── Filter / Sort Bar ────────────────────────────────────────────────────────

interface FilterBarProps {
  statusFilter: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  sortField: SortField;
  sortDir: SortDirection;
  onSortChange: (f: SortField) => void;
}

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'inactive', label: 'Inactive' },
];

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price' },
  { key: 'nextBillingDate', label: 'Due' },
];

const DashboardFilterBar: React.FC<FilterBarProps> = ({
  statusFilter,
  onStatusChange,
  sortField,
  sortDir,
  onSortChange,
}) => (
  <View style={filterBarStyles.container} accessibilityRole="toolbar">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={filterBarStyles.scroll}>
      {STATUS_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.key}
          style={[filterBarStyles.chip, statusFilter === opt.key && filterBarStyles.chipActive]}
          onPress={() => onStatusChange(opt.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: statusFilter === opt.key }}
          accessibilityLabel={`Filter by ${opt.label}`}>
          <Text
            style={[
              filterBarStyles.chipText,
              statusFilter === opt.key && filterBarStyles.chipTextActive,
            ]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>

    <View style={filterBarStyles.sortRow}>
      {SORT_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.key}
          style={[filterBarStyles.sortChip, sortField === opt.key && filterBarStyles.sortChipActive]}
          onPress={() => onSortChange(opt.key)}
          accessibilityRole="button"
          accessibilityLabel={`Sort by ${opt.label} ${sortField === opt.key ? sortDir : ''}`}>
          <Text
            style={[
              filterBarStyles.sortText,
              sortField === opt.key && filterBarStyles.sortTextActive,
            ]}>
            {opt.label}
            {sortField === opt.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

const filterBarStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  scroll: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: {
    borderColor: colors.accent,
  },
  sortText: {
    ...typography.small,
    color: colors.textSecondary,
  },
  sortTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
});

// ── Subscription Row ─────────────────────────────────────────────────────────

interface SubscriptionRowProps {
  sub: Subscription;
  currency: string;
  onPress: () => void;
  onCancelPress: () => void;
  onChangePlan: () => void;
  isWide: boolean;
}

const SubscriptionRow: React.FC<SubscriptionRowProps> = ({
  sub,
  currency,
  onPress,
  onCancelPress,
  onChangePlan,
  isWide,
}) => {
  const due = daysUntil(sub.nextBillingDate);
  const sc = statusColor(sub);

  return (
    <TouchableOpacity
      style={[rowStyles.container, isWide && rowStyles.containerWide]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sub.name}, ${statusLabel(sub)}, ${formatCurrency(sub.price, currency)}${billingCycleLabel(sub.billingCycle)}`}>
      {/* Status dot */}
      <View style={[rowStyles.statusDot, { backgroundColor: sc }]} accessibilityElementsHidden />

      {/* Info */}
      <View style={rowStyles.info}>
        <Text style={rowStyles.name} numberOfLines={1}>
          {sub.name}
        </Text>
        <Text style={rowStyles.meta}>
          {sub.category} · Due {due === 0 ? 'today' : `in ${due}d`}
        </Text>
      </View>

      {/* Price */}
      <Text style={rowStyles.price}>
        {formatCurrency(sub.price, currency)}
        <Text style={rowStyles.cycle}>{billingCycleLabel(sub.billingCycle)}</Text>
      </Text>

      {/* Status badge */}
      <View style={[rowStyles.badge, { backgroundColor: sc + '25' }]}>
        <Text style={[rowStyles.badgeText, { color: sc }]}>{statusLabel(sub)}</Text>
      </View>

      {/* Quick actions — only on wide layout to avoid crowding mobile */}
      {isWide && (
        <View style={rowStyles.actions}>
          <TouchableOpacity
            style={rowStyles.actionBtn}
            onPress={onChangePlan}
            accessibilityRole="button"
            accessibilityLabel={`Change plan for ${sub.name}`}>
            <Text style={rowStyles.actionText}>Change Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rowStyles.actionBtn, rowStyles.actionBtnDanger]}
            onPress={onCancelPress}
            accessibilityRole="button"
            accessibilityLabel={`Cancel ${sub.name}`}>
            <Text style={[rowStyles.actionText, { color: colors.error }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
};

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  containerWide: {
    flexWrap: 'nowrap',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 80,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  meta: {
    ...typography.small,
    color: colors.textSecondary,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  price: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'right',
  },
  cycle: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  badgeText: {
    ...typography.small,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionBtnDanger: {
    borderColor: colors.error,
  },
  actionText: {
    ...typography.small,
    color: colors.text,
    fontWeight: '600',
  },
});

// ── Empty state ───────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ onAdd: () => void }> = ({ onAdd }) => (
  <View style={emptyStyles.container} accessibilityRole="none">
    <Text style={emptyStyles.icon}>📋</Text>
    <Text style={emptyStyles.title}>No subscriptions found</Text>
    <Text style={emptyStyles.body}>
      Add your first subscription to start tracking your recurring spend.
    </Text>
    <TouchableOpacity
      style={emptyStyles.button}
      onPress={onAdd}
      accessibilityRole="button"
      accessibilityLabel="Add first subscription">
      <Text style={emptyStyles.buttonText}>Add Subscription</Text>
    </TouchableOpacity>
  </View>
);

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  icon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  buttonText: {
    ...typography.body,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});

// ── Category Breakdown ───────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  [SubscriptionCategory.STREAMING]: '📺',
  [SubscriptionCategory.SOFTWARE]: '💻',
  [SubscriptionCategory.GAMING]: '🎮',
  [SubscriptionCategory.PRODUCTIVITY]: '⚙️',
  [SubscriptionCategory.FITNESS]: '🏋️',
  [SubscriptionCategory.EDUCATION]: '📚',
  [SubscriptionCategory.FINANCE]: '💰',
  [SubscriptionCategory.OTHER]: '📦',
};

interface CategoryBreakdownProps {
  breakdown: Record<string, number>;
  total: number;
}

const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({ breakdown, total }) => {
  const entries = Object.entries(breakdown).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;

  return (
    <Card style={categoryStyles.card} accessibilityLabel="Subscription categories">
      <Text style={categoryStyles.title}>By Category</Text>
      <View style={categoryStyles.grid}>
        {entries.map(([category, count]) => (
          <View key={category} style={categoryStyles.item} accessibilityLabel={`${category}: ${count}`}>
            <Text style={categoryStyles.icon}>{CATEGORY_ICONS[category] ?? '📦'}</Text>
            <Text style={categoryStyles.count}>{count}</Text>
            <Text style={categoryStyles.label} numberOfLines={1}>
              {category}
            </Text>
            <View style={categoryStyles.barTrack}>
              <View
                style={[
                  categoryStyles.barFill,
                  { width: `${total > 0 ? (count / total) * 100 : 0}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
};

const categoryStyles = StyleSheet.create({
  card: {
    padding: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  item: {
    width: 80,
    alignItems: 'center',
  },
  icon: {
    fontSize: 22,
    marginBottom: spacing.xs,
  },
  count: {
    ...typography.h3,
    color: colors.text,
    marginBottom: 2,
  },
  label: {
    ...typography.small,
    color: colors.textSecondary,
    textTransform: 'capitalize',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  barTrack: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

const SubscriptionDashboardScreen: React.FC = () => {
  const navigation = useNavigation<DashboardNavProp>();
  const { width } = useWindowDimensions();

  // Wide layout threshold: 768 px (tablet / web)
  const isWide = width >= 768;

  const { subscriptions, stats, isLoading, deleteSubscription } = useSubscriptionStore();
  const { preferredCurrency } = useSettingsStore();
  const currency = preferredCurrency ?? 'USD';

  const themeColors = useThemeColors();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('nextBillingDate');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // ── Sort toggle ──────────────────────────────────────────────────────────
  const handleSortChange = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const displayedSubs = useMemo(() => {
    let list = [...subscriptions];

    if (statusFilter !== 'all') {
      list = list.filter((sub) => {
        if (statusFilter === 'active') return sub.isActive && !sub.isPaused;
        if (statusFilter === 'paused') return sub.isPaused === true;
        if (statusFilter === 'inactive') return !sub.isActive;
        return true;
      });
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'price') {
        cmp = a.price - b.price;
      } else {
        cmp = new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [subscriptions, statusFilter, sortField, sortDir]);

  // ── Overview metrics ──────────────────────────────────────────────────────
  const upcomingCount = useMemo(
    () => subscriptions.filter((s) => s.isActive && daysUntil(s.nextBillingDate) <= 7).length,
    [subscriptions]
  );
  const pausedCount = useMemo(
    () => subscriptions.filter((s) => s.isPaused).length,
    [subscriptions]
  );

  const metrics: OverviewMetric[] = [
    {
      label: 'Active',
      value: String(stats.totalActive),
      icon: '✅',
      accent: themeColors.success,
    },
    {
      label: 'Monthly Spend',
      value: `${currency} ${stats.totalMonthlySpend.toFixed(2)}`,
      icon: '💳',
    },
    {
      label: 'Due in 7d',
      value: String(upcomingCount),
      icon: '⏰',
      accent: upcomingCount > 0 ? themeColors.warning : undefined,
    },
    {
      label: 'Paused',
      value: String(pausedCount),
      icon: '⏸️',
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Subscription }) => (
      <SubscriptionRow
        key={item.id}
        sub={item}
        currency={currency}
        isWide={isWide}
        onPress={() => navigation.navigate('SubscriptionDetail', { id: item.id })}
        onChangePlan={() => navigation.navigate('ChangePlan', { subscriptionId: item.id })}
        onCancelPress={() =>
          navigation.navigate('CancellationFlow', { subscriptionId: item.id })
        }
      />
    ),
    [currency, isWide, navigation]
  );

  const keyExtractor = useCallback((item: Subscription) => item.id, []);

  return (
    <SafeAreaView
      style={[screenStyles.root, { backgroundColor: themeColors.background.primary }]}
      accessibilityLabel="Subscription dashboard"
      testID="subscription-dashboard-screen">
      {/* ── Header ── */}
      <View
        style={[
          screenStyles.header,
          isWide && screenStyles.headerWide,
          { borderBottomColor: themeColors.border },
        ]}>
        <View>
          <Text style={[screenStyles.title, { color: themeColors.text }]} accessibilityRole="header">
            Subscription Dashboard
          </Text>
          <Text style={[screenStyles.subtitle, { color: themeColors.textSecondary }]}>
            {subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''} tracked
          </Text>
        </View>
        <TouchableOpacity
          style={[screenStyles.addBtn, { backgroundColor: themeColors.primary }]}
          onPress={() => navigation.navigate('AddSubscription')}
          accessibilityRole="button"
          accessibilityLabel="Add new subscription">
          <Text style={[screenStyles.addBtnText, { color: themeColors.onPrimary }]}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayedSubs}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        testID="subscription-dashboard-list"
        accessibilityLabel="Subscription list"
        ListHeaderComponent={
          <>
            {/* ── Metric overview ── */}
            {isLoading ? (
              <StatsCardSkeleton />
            ) : (
              <View
                style={[
                  screenStyles.metricsRow,
                  isWide && screenStyles.metricsRowWide,
                ]}
                accessibilityRole="summary">
                {metrics.map((m) => (
                  <MetricCard key={m.label} metric={m} wide={isWide} />
                ))}
              </View>
            )}

            {/* ── Category breakdown ── */}
            {!isLoading && subscriptions.length > 0 && (
              <View style={screenStyles.sectionPad}>
                <CategoryBreakdown
                  breakdown={stats.categoryBreakdown as Record<string, number>}
                  total={subscriptions.length}
                />
              </View>
            )}

            {/* ── Platform badge (web vs native) ── */}
            {Platform.OS === 'web' && (
              <View style={screenStyles.webBadge}>
                <Text style={screenStyles.webBadgeText}>
                  🖥️ Web — wide layout and keyboard navigation enabled
                </Text>
              </View>
            )}

            {/* ── Filter / sort bar ── */}
            <DashboardFilterBar
              statusFilter={statusFilter}
              onStatusChange={setStatusFilter}
              sortField={sortField}
              sortDir={sortDir}
              onSortChange={handleSortChange}
            />

            {/* ── Section title ── */}
            <View style={screenStyles.sectionHeader}>
              <Text
                style={[screenStyles.sectionTitle, { color: themeColors.text }]}
                accessibilityRole="header">
                Subscriptions
              </Text>
              {displayedSubs.length !== subscriptions.length && (
                <Text style={[screenStyles.sectionMeta, { color: themeColors.textSecondary }]}>
                  {displayedSubs.length} of {subscriptions.length}
                </Text>
              )}
            </View>

            {/* Loading skeleton list */}
            {isLoading && <SubscriptionListSkeleton count={4} />}
          </>
        }
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState onAdd={() => navigation.navigate('AddSubscription')} />
          ) : null
        }
        contentContainerStyle={
          displayedSubs.length === 0 ? screenStyles.listEmpty : undefined
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const screenStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerWide: {
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.h2,
    marginBottom: 2,
  },
  subtitle: {
    ...typography.caption,
  },
  addBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  addBtnText: {
    ...typography.body,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.md,
  },
  metricsRowWide: {
    flexWrap: 'nowrap',
  },
  sectionPad: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  webBadge: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.primary + '20',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  webBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
  },
  sectionMeta: {
    ...typography.caption,
  },
  listEmpty: {
    flexGrow: 1,
  },
});

export default SubscriptionDashboardScreen;
