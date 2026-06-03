import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';

interface DashboardStats {
  totalRequests: number;
  activeEnvironments: number;
  activeApiKeys: number;
  errorRate: number;
}

interface RecentActivity {
  id: string;
  type: string;
  description: string;
  timestamp: Date;
}

interface EnvironmentCard {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  requestCount: number;
  errorRate: number;
}

interface DashboardPageProps {
  onNavigate: (page: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<DashboardStats>({
    totalRequests: 0,
    activeEnvironments: 0,
    activeApiKeys: 0,
    errorRate: 0,
  });
  const [environments, setEnvironments] = useState<EnvironmentCard[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setStats({
      totalRequests: 12500,
      activeEnvironments: 2,
      activeApiKeys: 5,
      errorRate: 2.3,
    });

    setEnvironments([
      {
        id: '1',
        name: 'Development Sandbox',
        status: 'active',
        requestCount: 8500,
        errorRate: 1.5,
      },
      {
        id: '2',
        name: 'Staging Environment',
        status: 'active',
        requestCount: 4000,
        errorRate: 3.2,
      },
    ]);

    setRecentActivity([
      {
        id: '1',
        type: 'api_key_created',
        description: 'New API key "Production Key" created',
        timestamp: new Date(Date.now() - 3600000),
      },
      {
        id: '2',
        type: 'request_made',
        description: '1,250 API requests processed',
        timestamp: new Date(Date.now() - 7200000),
      },
      {
        id: '3',
        type: 'environment_created',
        description: 'Staging environment created',
        timestamp: new Date(Date.now() - 86400000),
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const getActivityIcon = (type: string): string => {
    switch (type) {
      case 'api_key_created':
        return '🔑';
      case 'environment_created':
        return '🌍';
      case 'request_made':
        return '📡';
      case 'error_occurred':
        return '⚠️';
      case 'webhook_triggered':
        return '🔔';
      default:
        return '📋';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return '#22C55E';
      case 'suspended':
        return '#F59E0B';
      case 'deleted':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.header}>
        <Text style={styles.title}>Developer Dashboard</Text>
        <Text style={styles.subtitle}>Manage your sandbox environments and API integrations</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalRequests.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Total Requests</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.activeEnvironments}</Text>
          <Text style={styles.statLabel}>Environments</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.activeApiKeys}</Text>
          <Text style={styles.statLabel}>API Keys</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: stats.errorRate > 5 ? '#EF4444' : '#22C55E' }]}>
            {stats.errorRate}%
          </Text>
          <Text style={styles.statLabel}>Error Rate</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => onNavigate('api-keys')}>
            <Text style={styles.quickActionIcon}>🔑</Text>
            <Text style={styles.quickActionText}>Create API Key</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => onNavigate('environments')}>
            <Text style={styles.quickActionIcon}>🌍</Text>
            <Text style={styles.quickActionText}>New Environment</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => onNavigate('docs')}>
            <Text style={styles.quickActionIcon}>📚</Text>
            <Text style={styles.quickActionText}>View Docs</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => onNavigate('usage')}>
            <Text style={styles.quickActionIcon}>📊</Text>
            <Text style={styles.quickActionText}>Usage Stats</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Environments</Text>
          <TouchableOpacity onPress={() => onNavigate('environments')}>
            <Text style={styles.seeAllText}>See All</Text>
          </TouchableOpacity>
        </View>
        {environments.map((env) => (
          <TouchableOpacity key={env.id} style={styles.envCard}>
            <View style={styles.envHeader}>
              <Text style={styles.envName}>{env.name}</Text>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(env.status) + '20' },
                ]}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(env.status) }]} />
                <Text style={[styles.statusText, { color: getStatusColor(env.status) }]}>
                  {env.status}
                </Text>
              </View>
            </View>
            <View style={styles.envStats}>
              <Text style={styles.envStat}>{env.requestCount.toLocaleString()} requests</Text>
              <Text style={styles.envStat}>{env.errorRate}% errors</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
        </View>
        {recentActivity.map((activity) => (
          <View key={activity.id} style={styles.activityItem}>
            <Text style={styles.activityIcon}>{getActivityIcon(activity.type)}</Text>
            <View style={styles.activityContent}>
              <Text style={styles.activityDescription}>{activity.description}</Text>
              <Text style={styles.activityTime}>{activity.timestamp.toLocaleString()}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  seeAllText: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  quickActionButton: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  envCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  envHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  envName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  envStats: {
    flexDirection: 'row',
    gap: 16,
  },
  envStat: {
    fontSize: 14,
    color: '#6B7280',
  },
  activityItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  activityIcon: {
    fontSize: 20,
    marginRight: 12,
    width: 32,
    textAlign: 'center',
  },
  activityContent: {
    flex: 1,
  },
  activityDescription: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});

export default DashboardPage;
