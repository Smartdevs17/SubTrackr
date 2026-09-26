import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useInvoiceStore } from '../store/invoiceStore';
import { useTheme } from '../theme/useTheme';

const { width } = Dimensions.get('window');

export default function InvoiceAnalyticsScreen() {
  const { theme } = useTheme();
  const { analytics, isLoading, loadAnalytics } = useInvoiceStore();

  useEffect(() => {
    loadAnalytics();
  }, []);

  if (isLoading || !analytics) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const MetricCard = ({ title, value, subtitle, color }: any) => (
    <View style={[styles.metricCard, { backgroundColor: theme.colors.card }]}>
      <Text style={[styles.metricTitle, { color: theme.colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.metricValue, { color: color || theme.colors.text }]}>{value}</Text>
      {subtitle && <Text style={[styles.metricSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );

  const StatusCard = ({ status, count, color }: any) => (
    <View style={[styles.statusCard, { backgroundColor: theme.colors.card }]}>
      <View style={[styles.statusIndicator, { backgroundColor: color }]} />
      <View style={styles.statusContent}>
        <Text style={[styles.statusLabel, { color: theme.colors.text }]}>{status}</Text>
        <Text style={[styles.statusCount, { color: theme.colors.text }]}>{count}</Text>
      </View>
    </View>
  );

  const statusColors = {
    draft: '#3B82F6',
    pending: '#F59E0B',
    paid: '#10B981',
    overdue: '#EF4444',
    cancelled: '#6B7280',
    refunded: '#8B5CF6',
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Overview</Text>
        <View style={styles.metricsGrid}>
          <MetricCard
            title="Total Revenue"
            value={`$${analytics.totalRevenue.toFixed(2)}`}
            subtitle={`${analytics.paidInvoices} paid invoices`}
            color="#10B981"
          />
          <MetricCard
            title="Total Invoices"
            value={analytics.totalInvoices}
            subtitle="All time"
          />
          <MetricCard
            title="Average Amount"
            value={`$${analytics.averageInvoiceAmount.toFixed(2)}`}
            subtitle="Per invoice"
          />
          <MetricCard
            title="Pending"
            value={analytics.pendingInvoices}
            subtitle="Awaiting payment"
            color="#F59E0B"
          />
          <MetricCard
            title="Overdue"
            value={analytics.overdueInvoices}
            subtitle="Needs attention"
            color="#EF4444"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Status Breakdown</Text>
        <View style={styles.statusGrid}>
          {Object.entries(analytics.statusBreakdown).map(([status, count]) => (
            <StatusCard
              key={status}
              status={status.charAt(0).toUpperCase() + status.slice(1)}
              count={count}
              color={statusColors[status as keyof typeof statusColors]}
            />
          ))}
        </View>
      </View>

      {analytics.paymentMethodBreakdown && Object.keys(analytics.paymentMethodBreakdown).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Payment Methods</Text>
          {Object.entries(analytics.paymentMethodBreakdown).map(([method, count]) => (
            <View key={method} style={[styles.paymentMethodRow, { backgroundColor: theme.colors.card }]}>
              <Text style={[styles.paymentMethodLabel, { color: theme.colors.text }]}>
                {method || 'Not specified'}
              </Text>
              <Text style={[styles.paymentMethodCount, { color: theme.colors.textSecondary }]}>
                {count} invoices
              </Text>
            </View>
          ))}
        </View>
      )}

      {analytics.topSubscriptions.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Top Subscriptions</Text>
          {analytics.topSubscriptions.map((sub, index) => (
            <View key={sub.subscriptionId} style={[styles.topSubCard, { backgroundColor: theme.colors.card }]}>
              <View style={styles.topSubRank}>
                <Text style={[styles.topSubRankText, { color: theme.colors.primary }]}>
                  #{index + 1}
                </Text>
              </View>
              <View style={styles.topSubContent}>
                <Text style={[styles.topSubName, { color: theme.colors.text }]}>
                  {sub.subscriptionName}
                </Text>
                <Text style={[styles.topSubRevenue, { color: theme.colors.textSecondary }]}>
                  ${sub.revenue.toFixed(2)} revenue • {sub.invoiceCount} invoices
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {analytics.revenueByMonth && Object.keys(analytics.revenueByMonth).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Monthly Revenue</Text>
          {Object.entries(analytics.revenueByMonth)
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 6)
            .map(([month, revenue]) => (
              <View key={month} style={[styles.revenueRow, { backgroundColor: theme.colors.card }]}>
                <Text style={[styles.revenueMonth, { color: theme.colors.text }]}>{month}</Text>
                <Text style={[styles.revenueAmount, { color: theme.colors.primary }]}>
                  ${revenue.toFixed(2)}
                </Text>
              </View>
            ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    padding: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: (width - 44) / 2,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  metricTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  metricSubtitle: {
    fontSize: 12,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statusCard: {
    width: (width - 44) / 2,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusIndicator: {
    width: 8,
    height: 40,
    borderRadius: 4,
    marginRight: 12,
  },
  statusContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  statusCount: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  paymentMethodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  paymentMethodLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  paymentMethodCount: {
    fontSize: 14,
  },
  topSubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  topSubRank: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topSubRankText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  topSubContent: {
    flex: 1,
  },
  topSubName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  topSubRevenue: {
    fontSize: 14,
  },
  revenueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  revenueMonth: {
    fontSize: 16,
    fontWeight: '500',
  },
  revenueAmount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});
