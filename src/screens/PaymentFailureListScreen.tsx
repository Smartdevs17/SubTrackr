import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { usePaymentFailureStore } from '../store/paymentFailureStore';
import type { PaymentFailure, EscalationLevel } from '../types/paymentFailure';

const MOCK_USER_ID = 'user-123'; // In real app, get from auth context

export default function PaymentFailureListScreen({ navigation }: any) {
  const { failures, analytics, loading, loadUnresolvedFailures, loadAnalytics, resolveFailure } =
    usePaymentFailureStore();

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unresolved'>('unresolved');

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    if (filter === 'unresolved') {
      await loadUnresolvedFailures(MOCK_USER_ID);
    }
    await loadAnalytics(MOCK_USER_ID);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleFailurePress = (failure: PaymentFailure) => {
    navigation.navigate('PaymentFailureDetail', { failureId: failure.id });
  };

  const handleResolve = async (failure: PaymentFailure) => {
    if (!failure.isResolved) {
      await resolveFailure(failure.id, 'manual_payment');
      await loadData();
    }
  };

  const renderAnalyticsSummary = () => {
    if (!analytics) return null;

    return (
      <View style={styles.analyticsCard}>
        <Text style={styles.analyticsTitle}>Payment Failures Overview</Text>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{analytics.unresolvedFailures}</Text>
            <Text style={styles.statLabel}>Unresolved</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#34C759' }]}>
              {analytics.resolutionRate.toFixed(1)}%
            </Text>
            <Text style={styles.statLabel}>Resolution Rate</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#FF3B30' }]}>
              ${analytics.revenueAtRisk.toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>At Risk</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#007AFF' }]}>
              {analytics.retrySuccessRate.toFixed(1)}%
            </Text>
            <Text style={styles.statLabel}>Retry Success</Text>
          </View>
        </View>

        {analytics.topFailureReasons.length > 0 && (
          <View style={styles.topReasonsSection}>
            <Text style={styles.sectionTitle}>Top Failure Reasons</Text>
            {analytics.topFailureReasons.slice(0, 3).map((reason, index) => (
              <View key={index} style={styles.reasonRow}>
                <Text style={styles.reasonLabel}>{formatReason(reason.reason)}</Text>
                <Text style={styles.reasonCount}>
                  {reason.count} ({reason.percentage.toFixed(1)}%)
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderFailureCard = (failure: PaymentFailure) => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(failure.failedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    return (
      <TouchableOpacity
        key={failure.id}
        style={styles.failureCard}
        onPress={() => handleFailurePress(failure)}>
        <View style={styles.failureHeader}>
          <View style={styles.failureHeaderLeft}>
            <Text style={styles.subscriptionName}>{failure.subscriptionName}</Text>
            <View style={[styles.escalationBadge, getEscalationStyle(failure.escalationLevel)]}>
              <Text style={styles.escalationText}>{failure.escalationLevel.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.amountContainer}>
            <Text style={styles.amount}>
              {failure.currency} {failure.amount.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.failureBody}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Reason:</Text>
            <Text style={styles.infoValue}>{formatReason(failure.failureReason)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Attempts:</Text>
            <Text style={styles.infoValue}>
              {failure.retryCount} / {failure.maxRetries}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Failed:</Text>
            <Text style={styles.infoValue}>
              {daysAgo === 0 ? 'Today' : `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`}
            </Text>
          </View>

          {failure.nextRetryAt && !failure.isResolved && (
            <View style={styles.nextRetryRow}>
              <Text style={styles.nextRetryLabel}>⏰ Next retry:</Text>
              <Text style={styles.nextRetryValue}>
                {new Date(failure.nextRetryAt).toLocaleString()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.failureFooter}>
          <View style={[styles.statusBadge, getStatusStyle(failure.status)]}>
            <Text style={styles.statusText}>{formatStatus(failure.status)}</Text>
          </View>

          {!failure.isResolved && (
            <TouchableOpacity
              style={styles.resolveButton}
              onPress={(e) => {
                e.stopPropagation();
                handleResolve(failure);
              }}>
              <Text style={styles.resolveButtonText}>Mark Resolved</Text>
            </TouchableOpacity>
          )}

          {failure.isResolved && (
            <View style={styles.resolvedBadge}>
              <Text style={styles.resolvedText}>
                ✓ Resolved via {formatResolutionMethod(failure.resolutionMethod)}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && failures.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading payment failures...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
      <View style={styles.header}>
        <Text style={styles.title}>Payment Failures</Text>
        <Text style={styles.subtitle}>Monitor and resolve payment issues</Text>
      </View>

      {renderAnalyticsSummary()}

      <View style={styles.filterSection}>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'unresolved' && styles.filterButtonActive]}
          onPress={() => setFilter('unresolved')}>
          <Text style={[styles.filterText, filter === 'unresolved' && styles.filterTextActive]}>
            Unresolved ({analytics?.unresolvedFailures || 0})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
          onPress={() => setFilter('all')}>
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            All ({analytics?.totalFailures || 0})
          </Text>
        </TouchableOpacity>
      </View>

      {failures.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>No Payment Failures</Text>
          <Text style={styles.emptySubtitle}>All your payments are processing successfully</Text>
        </View>
      ) : (
        <View style={styles.failuresList}>{failures.map(renderFailureCard)}</View>
      )}

      <View style={styles.bottomSpacing} />
    </ScrollView>
  );
}

function formatReason(reason: string): string {
  return reason
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatResolutionMethod(method?: string): string {
  if (!method) return 'Unknown';
  return method
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getEscalationStyle(level: EscalationLevel) {
  const styles: Record<EscalationLevel, any> = {
    low: { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' },
    medium: { backgroundColor: '#FFF3E0', borderColor: '#FF9800' },
    high: { backgroundColor: '#FFEBEE', borderColor: '#F44336' },
    critical: { backgroundColor: '#F3E5F5', borderColor: '#9C27B0' },
  };
  return styles[level];
}

function getStatusStyle(status: string) {
  const styles: Record<string, any> = {
    pending_retry: { backgroundColor: '#E3F2FD' },
    retrying: { backgroundColor: '#FFF9C4' },
    awaiting_action: { backgroundColor: '#FFEBEE' },
    suspended: { backgroundColor: '#FFCDD2' },
    resolved: { backgroundColor: '#C8E6C9' },
    cancelled: { backgroundColor: '#F5F5F5' },
  };
  return styles[status] || { backgroundColor: '#E0E0E0' };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    padding: 20,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  analyticsCard: {
    backgroundColor: '#FFF',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  analyticsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  statBox: {
    width: '48%',
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  topReasonsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  reasonLabel: {
    fontSize: 13,
    color: '#333',
  },
  reasonCount: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  filterSection: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  filterTextActive: {
    color: '#FFF',
  },
  failuresList: {
    paddingHorizontal: 16,
  },
  failureCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  failureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  failureHeaderLeft: {
    flex: 1,
  },
  subscriptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 6,
  },
  escalationBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  escalationText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF3B30',
  },
  failureBody: {
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
  },
  infoValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  nextRetryRow: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#F0F8FF',
    borderRadius: 6,
  },
  nextRetryLabel: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 2,
  },
  nextRetryValue: {
    fontSize: 12,
    color: '#333',
  },
  failureFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  resolveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#34C759',
    borderRadius: 6,
  },
  resolveButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  resolvedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  resolvedText: {
    fontSize: 11,
    color: '#34C759',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  bottomSpacing: {
    height: 40,
  },
});
