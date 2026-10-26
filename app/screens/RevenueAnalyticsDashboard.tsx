/**
 * Revenue Analytics Dashboard Screen
 *
 * Displays MRR, ARR, and churn analytics with charts.
 * Closes #1141
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3001";

interface MrrSnapshot {
  date: string;
  mrr: number;
  newMrr: number;
  churnedMrr: number;
  netNewMrr: number;
}

interface ChurnSnapshot {
  period: string;
  customerChurnRate: number;
  revenueChurnRate: number;
  customersLost: number;
  revenueLost: number;
  totalCustomers: number;
}

interface RevenueDashboardData {
  currentMrr: number;
  currentArr: number;
  mrrHistory: MrrSnapshot[];
  churnHistory: ChurnSnapshot[];
  averageChurnRate: number;
  mrrGrowthRate: number;
  netRevenueRetention: number;
  generatedAt: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function MetricCard({ label, value, subtitle, color = "#4F46E5" }: {
  label: string; value: string; subtitle?: string; color?: string;
}) {
  return (
    <View style={[styles.metricCard, { borderLeftColor: color }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.metricSubtitle}>{subtitle}</Text>}
    </View>
  );
}

function MrrChart({ data }: { data: MrrSnapshot[] }) {
  if (data.length === 0) return <Text style={styles.emptyText}>No MRR data available</Text>;
  const maxMrr = Math.max(...data.map((d) => d.mrr), 1);
  const chartWidth = Dimensions.get("window").width - 64;

  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>MRR History (Monthly)</Text>
      <View style={styles.barChart}>
        {data.map((item, idx) => {
          const barHeight = Math.max((item.mrr / maxMrr) * 120, 4);
          return (
            <View key={idx} style={styles.barColumn}>
              <View style={[styles.bar, { height: barHeight }]} />
              <Text style={styles.barLabel}>{item.date.slice(5)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ChurnTable({ data }: { data: ChurnSnapshot[] }) {
  const renderRow = ({ item }: { item: ChurnSnapshot }) => (
    <View style={styles.tableRow}>
      <Text style={styles.tableCell}>{item.period}</Text>
      <Text style={styles.tableCell}>{item.customerChurnRate.toFixed(2)}%</Text>
      <Text style={styles.tableCell}>{item.revenueChurnRate.toFixed(2)}%</Text>
      <Text style={styles.tableCell}>{item.customersLost}</Text>
      <Text style={styles.tableCell}>{formatCurrency(item.revenueLost)}</Text>
    </View>
  );

  return (
    <View style={styles.tableContainer}>
      <Text style={styles.chartTitle}>Churn History</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCell, styles.tableHeaderText]}>Period</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText]}>Cust %</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText]}>Rev %</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText]}>Lost</Text>
        <Text style={[styles.tableCell, styles.tableHeaderText]}>Rev Lost</Text>
      </View>
      <FlatList
        data={data}
        renderItem={renderRow}
        keyExtractor={(_, idx) => String(idx)}
        scrollEnabled={false}
      />
    </View>
  );
}

export default function RevenueAnalyticsDashboard() {
  const [data, setData] = useState<RevenueDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE}/analytics/revenue?months=${months}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.success) {
        setData(json.data);
      } else {
        throw new Error(json.error ?? "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [months]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>Loading revenue analytics…</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Revenue Analytics Dashboard</Text>

      {data && (
        <>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Current MRR"
              value={formatCurrency(data.currentMrr)}
              subtitle={`Growth: ${data.mrrGrowthRate.toFixed(1)}%`}
              color="#4F46E5"
            />
            <MetricCard
              label="Current ARR"
              value={formatCurrency(data.currentArr)}
              color="#059669"
            />
          </View>

          <View style={styles.metricsRow}>
            <MetricCard
              label="Avg Churn Rate"
              value={`${data.averageChurnRate.toFixed(2)}%`}
              color="#DC2626"
            />
            <MetricCard
              label="Net Revenue Retention"
              value={`${data.netRevenueRetention.toFixed(1)}%`}
              color="#7C3AED"
            />
          </View>

          <MrrChart data={data.mrrHistory} />
          <ChurnTable data={data.churnHistory} />

          <Text style={styles.footerText}>
            Generated: {new Date(data.generatedAt).toLocaleString()}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F9FAFB" },
  title: { fontSize: 24, fontWeight: "700", color: "#111827", padding: 16 },
  loadingText: { marginTop: 12, color: "#6B7280", fontSize: 14 },
  errorText: { color: "#DC2626", fontSize: 14, textAlign: "center", padding: 20 },
  metricsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 12 },
  metricCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  metricLabel: { fontSize: 12, color: "#6B7280", marginBottom: 4 },
  metricValue: { fontSize: 22, fontWeight: "700" },
  metricSubtitle: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  chartContainer: { backgroundColor: "#FFFFFF", borderRadius: 12, margin: 16, padding: 16, elevation: 2 },
  chartTitle: { fontSize: 16, fontWeight: "600", color: "#111827", marginBottom: 12 },
  barChart: { flexDirection: "row", alignItems: "flex-end", height: 150, gap: 4 },
  barColumn: { flex: 1, alignItems: "center" },
  bar: { width: "80%", backgroundColor: "#4F46E5", borderRadius: 4, minHeight: 4 },
  barLabel: { fontSize: 8, color: "#6B7280", marginTop: 4 },
  tableContainer: { backgroundColor: "#FFFFFF", borderRadius: 12, margin: 16, padding: 16, elevation: 2 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingBottom: 8 },
  tableHeaderText: { fontWeight: "600", color: "#374151" },
  tableRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#F3F4F6" },
  tableCell: { flex: 1, fontSize: 12, color: "#4B5563" },
  emptyText: { color: "#9CA3AF", textAlign: "center", padding: 20 },
  footerText: { textAlign: "center", color: "#9CA3AF", fontSize: 11, paddingBottom: 24 },
});
