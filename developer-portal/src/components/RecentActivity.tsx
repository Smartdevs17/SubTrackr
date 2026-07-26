import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { UsageRecord } from '../../../src/types/developerPortal';

interface RecentActivityProps {
  activities: UsageRecord[];
  onActivityPress: (activity: UsageRecord) => void;
}

export const RecentActivity: React.FC<RecentActivityProps> = ({ activities, onActivityPress }) => {
  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return '#4CAF50';
    if (statusCode >= 400 && statusCode < 500) return '#FF9800';
    return '#F44336';
  };

  const formatTime = (timestamp: string | Date) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.container}>
      {activities.map((activity) => (
        <TouchableOpacity
          key={activity.id}
          style={styles.activityCard}
          onPress={() => onActivityPress(activity)}>
          <View style={styles.activityHeader}>
            <View style={styles.methodBadge}>
              <Text style={styles.methodText}>{activity.method}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(activity.statusCode) },
              ]}>
              <Text style={styles.statusText}>{activity.statusCode}</Text>
            </View>
          </View>
          <Text style={styles.endpoint}>{activity.endpoint}</Text>
          <View style={styles.activityFooter}>
            <Text style={styles.time}>{formatTime(activity.timestamp)}</Text>
            <Text style={styles.responseTime}>{activity.responseTime}ms</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  activityCard: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  methodBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  methodText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  endpoint: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    marginBottom: 8,
  },
  activityFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 12,
    color: '#666',
  },
  responseTime: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
});
