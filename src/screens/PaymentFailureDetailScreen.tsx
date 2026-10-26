import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { usePaymentFailureStore } from '../store/paymentFailureStore';

export default function PaymentFailureDetailScreen({ route, navigation }: any) {
  const { failureId } = route.params;
  const {
    selectedFailure,
    notifications,
    retries,
    loading,
    loadFailureById,
    loadNotifications,
    loadRetries,
    resolveFailure,
    scheduleRetry,
  } = usePaymentFailureStore();

  useEffect(() => {
    loadData();
  }, [failureId]);

  const loadData = async () => {
    await loadFailureById(failureId);
    await loadNotifications(failureId);
    await loadRetries(failureId);
  };

  const handleResolve = async (
    resolutionMethod: import('../types/paymentFailure').ResolutionMethod
  ) => {
    if (selectedFailure) {
      await resolveFailure(selectedFailure.id, resolutionMethod);
      navigation.goBack();
    }
  };

  const handleManualRetry = async () => {
    if (selectedFailure) {
      await scheduleRetry(selectedFailure);
      await loadData();
    }
  };

  if (loading || !selectedFailure) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading details...</Text>
      </View>
    );
  }

  const failure = selectedFailure;

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.title}>{failure.subscriptionName}</Text>
      <Text style={styles.amount}>
        {failure.currency} {failure.amount.toFixed(2)}
      </Text>

      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, getStatusColor(failure.status)]}>
          <Text style={styles.statusText}>{formatStatus(failure.status)}</Text>
        </View>
        <View style={[styles.escalationBadge, getEscalationColor(failure.escalationLevel)]}>
          <Text style={styles.escalationText}>{failure.escalationLevel.toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );

  const renderFailureDetails = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Failure Details</Text>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Reason:</Text>
        <Text style={styles.detailValue}>{formatReason(failure.failureReason)}</Text>
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Error Code:</Text>
        <Text style={styles.detailValue}>{failure.failureCode}</Text>
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Message:</Text>
        <Text style={styles.detailValue}>{failure.failureMessage}</Text>
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Failed At:</Text>
        <Text style={styles.detailValue}>{new Date(failure.failedAt).toLocaleString()}</Text>
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Retry Attempts:</Text>
        <Text style={styles.detailValue}>
          {failure.retryCount} / {failure.maxRetries}
        </Text>
      </View>

      {failure.nextRetryAt && !failure.isResolved && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Next Retry:</Text>
          <Text style={[styles.detailValue, { color: '#007AFF', fontWeight: '600' }]}>
            {new Date(failure.nextRetryAt).toLocaleString()}
          </Text>
        </View>
      )}

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Payment Method:</Text>
        <Text style={styles.detailValue}>
          {formatPaymentMethod(failure.paymentMethodType)}{' '}
          {failure.paymentMethodLast4 ? `•••• ${failure.paymentMethodLast4}` : ''}
        </Text>
      </View>
    </View>
  );

  const renderResolutionDetails = () => {
    if (!failure.isResolved) return null;

    return (
      <View style={[styles.section, styles.resolvedSection]}>
        <Text style={styles.sectionTitle}>✓ Resolution Details</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Method:</Text>
          <Text style={styles.detailValue}>{formatResolutionMethod(failure.resolutionMethod)}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Resolved At:</Text>
          <Text style={styles.detailValue}>
            {failure.resolvedAt ? new Date(failure.resolvedAt).toLocaleString() : 'N/A'}
          </Text>
        </View>
      </View>
    );
  };

  const renderRetryHistory = () => {
    if (retries.length === 0) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Retry History ({retries.length})</Text>

        {retries.map((retry, index) => (
          <View key={retry.id} style={styles.retryCard}>
            <View style={styles.retryHeader}>
              <Text style={styles.retryAttempt}>Attempt #{retry.retryAttempt}</Text>
              <View style={[styles.retryStatusBadge, getRetryStatusColor(retry.status)]}>
                <Text style={styles.retryStatusText}>{formatStatus(retry.status)}</Text>
              </View>
            </View>

            <View style={styles.retryDetails}>
              <Text style={styles.retryDetailText}>
                Scheduled: {new Date(retry.scheduledAt).toLocaleString()}
              </Text>

              {retry.executedAt && (
                <Text style={styles.retryDetailText}>
                  Executed: {new Date(retry.executedAt).toLocaleString()}
                </Text>
              )}

              {retry.useAlternatePaymentMethod && (
                <Text style={[styles.retryDetailText, { color: '#007AFF' }]}>
                  ℹ️ Used alternate payment method
                </Text>
              )}

              {retry.result && (
                <View style={styles.retryResult}>
                  <Text
                    style={[
                      styles.retryResultText,
                      { color: retry.result.success ? '#34C759' : '#FF3B30' },
                    ]}>
                    {retry.result.success ? '✓ Success' : '✗ Failed'}
                    {retry.result.failureReason && `: ${retry.result.failureReason}`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderNotifications = () => {
    if (notifications.length === 0) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications Sent ({notifications.length})</Text>

        {notifications.map((notification) => (
          <View key={notification.id} style={styles.notificationCard}>
            <View style={styles.notificationHeader}>
              <Text style={styles.notificationType}>
                {formatNotificationType(notification.type)}
              </Text>
              <View style={styles.channelBadges}>
                <View style={styles.channelBadge}>
                  <Text style={styles.channelText}>{getChannelIcon(notification.channel)}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.notificationTitle}>{notification.title}</Text>
            <Text style={styles.notificationMessage}>{notification.message}</Text>

            <View style={styles.notificationFooter}>
              <Text style={styles.notificationDate}>
                {new Date(notification.sentAt).toLocaleString()}
              </Text>

              <View style={[styles.deliveryBadge, getDeliveryStatusColor(notification.status)]}>
                <Text style={styles.deliveryText}>{formatStatus(notification.status)}</Text>
              </View>
            </View>

            {notification.readAt && (
              <Text style={styles.notificationMeta}>
                📖 Read: {new Date(notification.readAt).toLocaleString()}
              </Text>
            )}

            {notification.clickedAt && (
              <Text style={styles.notificationMeta}>
                👆 Clicked: {new Date(notification.clickedAt).toLocaleString()}
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderActions = () => {
    if (failure.isResolved) return null;

    return (
      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleResolve('payment_method_updated')}>
          <Text style={styles.actionButtonText}>💳 Update Payment Method</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleResolve('manual_payment')}>
          <Text style={styles.actionButtonText}>💰 Manual Payment Made</Text>
        </TouchableOpacity>

        {failure.retryCount < failure.maxRetries && (
          <TouchableOpacity
            style={[styles.actionButton, styles.retryButton]}
            onPress={handleManualRetry}>
            <Text style={[styles.actionButtonText, { color: '#007AFF' }]}>🔄 Retry Now</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={() => handleResolve('subscription_cancelled')}>
          <Text style={[styles.actionButtonText, { color: '#FF3B30' }]}>✕ Cancel Subscription</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      {renderHeader()}
      {renderFailureDetails()}
      {renderResolutionDetails()}
      {renderActions()}
      {renderRetryHistory()}
      {renderNotifications()}
      <View style={styles.bottomSpacing} />
    </ScrollView>
  );
}

// Helper functions
function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatReason(reason: string): string {
  return reason
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatResolutionMethod(method?: string): string {
  if (!method) return 'Unknown';
  return method
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatPaymentMethod(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatNotificationType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getChannelIcon(channel: string): string {
  const icons: Record<string, string> = {
    email: '📧',
    push: '🔔',
    sms: '💬',
    in_app: '📱',
  };
  return icons[channel] || '📬';
}

function getStatusColor(status: string) {
  const colors: Record<string, any> = {
    pending_retry: { backgroundColor: '#E3F2FD' },
    retrying: { backgroundColor: '#FFF9C4' },
    awaiting_action: { backgroundColor: '#FFEBEE' },
    suspended: { backgroundColor: '#FFCDD2' },
    resolved: { backgroundColor: '#C8E6C9' },
  };
  return colors[status] || { backgroundColor: '#E0E0E0' };
}

function getEscalationColor(level: string) {
  const colors: Record<string, any> = {
    low: { backgroundColor: '#E8F5E9' },
    medium: { backgroundColor: '#FFF3E0' },
    high: { backgroundColor: '#FFEBEE' },
    critical: { backgroundColor: '#F3E5F5' },
  };
  return colors[level] || { backgroundColor: '#E0E0E0' };
}

function getRetryStatusColor(status: string) {
  const colors: Record<string, any> = {
    scheduled: { backgroundColor: '#E3F2FD' },
    executing: { backgroundColor: '#FFF9C4' },
    succeeded: { backgroundColor: '#C8E6C9' },
    failed: { backgroundColor: '#FFCDD2' },
    skipped: { backgroundColor: '#F5F5F5' },
  };
  return colors[status] || { backgroundColor: '#E0E0E0' };
}

function getDeliveryStatusColor(status: string) {
  const colors: Record<string, any> = {
    sent: { backgroundColor: '#E3F2FD' },
    delivered: { backgroundColor: '#C8E6C9' },
    failed: { backgroundColor: '#FFCDD2' },
    bounced: { backgroundColor: '#FFEBEE' },
  };
  return colors[status] || { backgroundColor: '#E0E0E0' };
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
    backgroundColor: '#FFF',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 8,
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  escalationBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  escalationText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  section: {
    backgroundColor: '#FFF',
    marginTop: 16,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  resolvedSection: {
    backgroundColor: '#E8F5E9',
  },
  actionsSection: {
    backgroundColor: '#FFF',
    marginTop: 16,
    padding: 20,
  },
  actionButton: {
    backgroundColor: '#F8F9FA',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  cancelButton: {
    backgroundColor: '#FFEBEE',
    borderColor: '#FF3B30',
  },
  retryCard: {
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  retryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  retryAttempt: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  retryStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  retryStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
  },
  retryDetails: {
    marginTop: 4,
  },
  retryDetailText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 3,
  },
  retryResult: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  retryResultText: {
    fontSize: 13,
    fontWeight: '600',
  },
  notificationCard: {
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  notificationType: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
  },
  channelBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  channelBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelText: {
    fontSize: 12,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  notificationMessage: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  notificationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notificationDate: {
    fontSize: 11,
    color: '#999',
  },
  deliveryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  deliveryText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
  },
  notificationMeta: {
    fontSize: 11,
    color: '#007AFF',
    marginTop: 4,
  },
  bottomSpacing: {
    height: 40,
  },
});
