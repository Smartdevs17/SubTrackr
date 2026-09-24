/**
 * Geographic Revenue Breakdown Dashboard
 *
 * Displays revenue breakdown by country and region with
 * visual charts and summary metrics.
 *
 * Closes #1149
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  FlatList,
} from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import {
  GeographicRevenueResult,
  GeographicSummaryResult,
} from '../../backend/analytics/query/geographicRevenueQueryHandler';

// Mock data — in production, fetched via GeographicRevenueQueryHandler
const mockSummary: GeographicSummaryResult = {
  totalMRR: 100000,
  totalARR: 1200000,
  totalSubscribers: 1000,
  countryCount: 15,
  topCountry: 'United States',
  topCountryMRR: 50000,
  avgGrowthRate: 8.5,
  regions: [
    { region: 'North America', mrr: 60000, share: 60, subscriberCount: 600 },
    { region: 'Europe', mrr: 25000, share: 25, subscriberCount: 250 },
    { region: 'Asia Pacific', mrr: 10000, share: 10, subscriberCount: 100 },
    { region: 'Other', mrr: 5000, share: 5, subscriberCount: 50 },
  ],
  refreshedAt: new Date('2026-09-24'),
};

const mockCountries: GeographicRevenueResult[] = [
  { country: 'United States', countryCode: 'US', region: 'North America', mrr: 50000, arr: 600000, subscriberCount: 500, arpu: 100, revenueShare: 50, growthRate: 12.5, churnRate: 3.2, refreshedAt: new Date() },
  { country: 'Germany', countryCode: 'DE', region: 'Europe', mrr: 18000, arr: 216000, subscriberCount: 180, arpu: 100, revenueShare: 18, growthRate: 8.0, churnRate: 2.5, refreshedAt: new Date() },
  { country: 'United Kingdom', countryCode: 'GB', region: 'Europe', mrr: 12000, arr: 144000, subscriberCount: 120, arpu: 100, revenueShare: 12, growthRate: 6.5, churnRate: 4.0, refreshedAt: new Date() },
  { country: 'Japan', countryCode: 'JP', region: 'Asia Pacific', mrr: 8000, arr: 96000, subscriberCount: 80, arpu: 100, revenueShare: 8, growthRate: 15.0, churnRate: 1.8, refreshedAt: new Date() },
  { country: 'Canada', countryCode: 'CA', region: 'North America', mrr: 6000, arr: 72000, subscriberCount: 60, arpu: 100, revenueShare: 6, growthRate: 10.0, churnRate: 3.5, refreshedAt: new Date() },
  { country: 'Australia', countryCode: 'AU', region: 'Asia Pacific', mrr: 4000, arr: 48000, subscriberCount: 40, arpu: 100, revenueShare: 4, growthRate: 7.0, churnRate: 2.8, refreshedAt: new Date() },
  { country: 'France', countryCode: 'FR', region: 'Europe', mrr: 2000, arr: 24000, subscriberCount: 20, arpu: 100, revenueShare: 2, growthRate: 4.0, churnRate: 5.0, refreshedAt: new Date() },
];

const GeographicRevenueScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<GeographicSummaryResult | null>(null);
  const [countries, setCountries] = useState<GeographicRevenueResult[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      setSummary(mockSummary);
      setCountries(mockCountries);
    } catch (error) {
      console.error('Failed to fetch geographic revenue:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading || !summary) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading geographic revenue...</Text>
      </View>
    );
  }

  const formatCurrency = (value: number) =>
    value >= 1000000
      ? '$' + (value / 1000000).toFixed(1) + 'M'
      : '$' + value.toLocaleString('en-US');

  const getRegionColor = (index: number) => {
    const palette = ['#6C5CE7', '#00B894', '#74B9FF', '#FDCB6E', '#E17055'];
    return palette[index % palette.length];
  };

  const getGrowthColor = (rate: number) => (rate >= 0 ? '#27AE60' : '#E74C3C');

  const renderCountryRow = ({ item, index }: { item: GeographicRevenueResult; index: number }) => (
    <Card style={styles.countryCard}>
      <View style={styles.countryHeader}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{index + 1}</Text>
        </View>
        <View style={styles.countryInfo}>
          <Text style={styles.countryName}>{item.country}</Text>
          <Text style={styles.countryRegion}>{item.region}</Text>
        </View>
        <View style={styles.countryRevenue}>
          <Text style={styles.revenueValue}>{formatCurrency(item.mrr)}</Text>
          <Text style={styles.revenueShare}>{item.revenueShare.toFixed(1)}% share</Text>
        </View>
      </View>

      <View style={styles.countryMetrics}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Subscribers</Text>
          <Text style={styles.metricValue}>{item.subscriberCount}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>ARPU</Text>
          <Text style={styles.metricValue}>{formatCurrency(item.arpu)}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Growth</Text>
          <Text style={[styles.metricValue, { color: getGrowthColor(item.growthRate) }]}>
            {item.growthRate >= 0 ? '+' : ''}{item.growthRate.toFixed(1)}%
          </Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Churn</Text>
          <Text style={[styles.metricValue, { color: '#E74C3C' }]}>
            {item.churnRate.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Revenue share bar */}
      <View style={styles.shareBarContainer}>
        <View style={[styles.shareBar, { width: `${item.revenueShare}%` }]} />
      </View>
    </Card>
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Geographic Revenue</Text>
        <Text style={styles.subtitle}>Revenue breakdown by country and region</Text>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total MRR</Text>
          <Text style={styles.summaryValue}>{formatCurrency(summary.totalMRR)}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total ARR</Text>
          <Text style={styles.summaryValue}>{formatCurrency(summary.totalARR)}</Text>
        </Card>
      </View>

      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Countries</Text>
          <Text style={styles.summaryValue}>{summary.countryCount}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg Growth</Text>
          <Text style={[styles.summaryValue, { color: getGrowthColor(summary.avgGrowthRate) }]}>
            {summary.avgGrowthRate >= 0 ? '+' : ''}{summary.avgGrowthRate.toFixed(1)}%
          </Text>
        </Card>
      </View>

      {/* Top country highlight */}
      <Card style={styles.topCountryCard}>
        <Text style={styles.topCountryLabel}>Top Revenue Country</Text>
        <Text style={styles.topCountryName}>{summary.topCountry}</Text>
        <Text style={styles.topCountryValue}>{formatCurrency(summary.topCountryMRR)}/mo</Text>
      </Card>

      {/* Regional breakdown */}
      <Text style={styles.sectionTitle}>Regional Breakdown</Text>
      <Card style={styles.regionCard}>
        {summary.regions.map((region, index) => (
          <View key={region.region} style={styles.regionRow}>
            <View style={styles.regionLabelRow}>
              <View style={[styles.regionDot, { backgroundColor: getRegionColor(index) }]} />
              <Text style={styles.regionName}>{region.region}</Text>
              <Text style={styles.regionShare}>{region.share.toFixed(1)}%</Text>
            </View>
            <View style={styles.regionBarContainer}>
              <View
                style={[
                  styles.regionBar,
                  { width: `${region.share}%`, backgroundColor: getRegionColor(index) },
                ]}
              />
            </View>
            <Text style={styles.regionMrr}>
              {formatCurrency(region.mrr)} · {region.subscriberCount} subs
            </Text>
          </View>
        ))}
      </Card>

      {/* Country list */}
      <Text style={styles.sectionTitle}>Country Rankings</Text>
      <FlatList
        data={countries}
        renderItem={renderCountryRow}
        keyExtractor={(item) => item.countryCode}
        scrollEnabled={false}
        contentContainerStyle={styles.listContainer}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Last refreshed: {summary.refreshedAt.toLocaleDateString()}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 16 },
  header: { padding: spacing.xl, paddingTop: 60, backgroundColor: colors.surface },
  title: { fontSize: 28, fontWeight: 'bold', color: colors.text },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginTop: 4 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.md },
  summaryCard: { flex: 1, padding: spacing.md, alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: colors.text },
  topCountryCard: { margin: spacing.lg, padding: spacing.xl, alignItems: 'center' },
  topCountryLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  topCountryName: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  topCountryValue: { fontSize: 18, color: colors.primary, fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  regionCard: { marginHorizontal: spacing.lg, padding: spacing.md },
  regionRow: { marginBottom: spacing.md },
  regionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  regionDot: { width: 10, height: 10, borderRadius: 5 },
  regionName: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  regionShare: { fontSize: 14, fontWeight: 'bold', color: colors.primary },
  regionBarContainer: { width: '100%', height: 12, backgroundColor: colors.border, borderRadius: 6, overflow: 'hidden' },
  regionBar: { height: '100%', borderRadius: 6 },
  regionMrr: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  listContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  countryCard: { marginBottom: spacing.md, padding: spacing.md },
  countryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  rankBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  rankText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  countryInfo: { flex: 1, marginLeft: spacing.sm },
  countryName: { fontSize: 16, fontWeight: '600', color: colors.text },
  countryRegion: { fontSize: 12, color: colors.textSecondary },
  countryRevenue: { alignItems: 'flex-end' },
  revenueValue: { fontSize: 16, fontWeight: 'bold', color: colors.text },
  revenueShare: { fontSize: 12, color: colors.textSecondary },
  countryMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  metricItem: { alignItems: 'center' },
  metricLabel: { fontSize: 10, color: colors.textSecondary, marginBottom: 2 },
  metricValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  shareBarContainer: { width: '100%', height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: spacing.md, overflow: 'hidden' },
  shareBar: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
  footer: { padding: spacing.lg, alignItems: 'center', marginBottom: spacing.xxl },
  footerText: { fontSize: 12, color: colors.textSecondary },
});

export default GeographicRevenueScreen;
