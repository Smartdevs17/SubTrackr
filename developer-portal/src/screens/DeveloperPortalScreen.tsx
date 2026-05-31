import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useDeveloperPortalStore } from '../../../src/store/developerPortalStore';
import { ApiKeyPermission } from '../../../src/types/developerPortal';
import { DashboardCard } from '../components/DashboardCard';
import { QuickActionCard } from '../components/QuickActionCard';
import { OnboardingProgress } from '../components/OnboardingProgress';
import { UsageChart } from '../components/UsageChart';
import { RecentActivity } from '../components/RecentActivity';

const DeveloperPortalScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const {
    developer,
    apiKeys,
    usageStats,
    recentUsage,
    onboardingSteps,
    isLoading,
    error,
    fetchDeveloper,
    fetchApiKeys,
    fetchUsageStats,
    fetchRecentUsage,
    fetchOnboardingSteps,
    createApiKey,
    clearError,
  } = useDeveloperPortalStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (developer) {
      loadDashboardData();
    }
  }, [developer]);

  const loadDashboardData = async () => {
    if (!developer) return;

    try {
      await Promise.all([
        fetchApiKeys(developer.id),
        fetchUsageStats(developer.id, {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: new Date(),
        }),
        fetchRecentUsage(developer.id, 20),
        fetchOnboardingSteps(developer.id),
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const handleQuickCreateApiKey = async () => {
    if (!developer) return;

    Alert.prompt('Create API Key', 'Enter a name for your new API key', async (name) => {
      if (name && name.trim()) {
        try {
          const newKey = await createApiKey(developer.id, name.trim(), [
            ApiKeyPermission.READ,
            ApiKeyPermission.WRITE,
          ]);
          Alert.alert(
            'API Key Created',
            `Your new API key has been created:\n\n${newKey.key}\n\nCopy it now - it won't be shown again.`,
            [
              {
                text: 'View All Keys',
                onPress: () => navigation.navigate('ApiKeyManagement'),
              },
              { text: 'OK' },
            ]
          );
        } catch (err) {
          Alert.alert('Error', 'Failed to create API key');
        }
      }
    });
  };

  if (!developer) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>Welcome to Developer Portal</Text>
          <Text style={styles.subtitle}>Please register to access the developer portal</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('DeveloperRegistration')}>
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const activeKeys = apiKeys.filter((k) => k.status === 'active').length;
  const totalCalls = usageStats?.totalCalls || 0;
  const successRate = usageStats
    ? Math.round((usageStats.successfulCalls / Math.max(usageStats.totalCalls, 1)) * 100)
    : 0;
  const avgResponseTime = usageStats?.averageResponseTime || 0;

  const completedSteps = onboardingSteps.filter((s) => s.isCompleted).length;
  const onboardingProgress =
    onboardingSteps.length > 0 ? Math.round((completedSteps / onboardingSteps.length) * 100) : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshing={refreshing}
        onRefresh={handleRefresh}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Developer Portal</Text>
            <Text style={styles.subtitle}>Welcome back, {developer.name}</Text>
          </View>
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>{developer.tier.toUpperCase()}</Text>
          </View>
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error.message}</Text>
            <TouchableOpacity onPress={clearError}>
              <Text style={styles.errorDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Onboarding Progress */}
        {onboardingProgress < 100 && (
          <OnboardingProgress
            progress={onboardingProgress}
            completedSteps={completedSteps}
            totalSteps={onboardingSteps.length}
            onViewDetails={() => navigation.navigate('Onboarding')}
          />
        )}

        {/* Stats Overview */}
        <View style={styles.statsGrid}>
          <DashboardCard
            title="API Keys"
            value={activeKeys.toString()}
            subtitle={`${apiKeys.length} total`}
            icon="🔑"
            onPress={() => navigation.navigate('ApiKeyManagement')}
          />
          <DashboardCard
            title="API Calls"
            value={totalCalls.toLocaleString()}
            subtitle="Last 30 days"
            icon="📊"
            onPress={() => navigation.navigate('UsageAnalytics')}
          />
          <DashboardCard
            title="Success Rate"
            value={`${successRate}%`}
            subtitle={`${usageStats?.failedCalls || 0} errors`}
            icon="✓"
            trend={successRate >= 95 ? 'up' : successRate >= 80 ? 'neutral' : 'down'}
          />
          <DashboardCard
            title="Avg Response"
            value={`${avgResponseTime}ms`}
            subtitle="Response time"
            icon="⚡"
            trend={avgResponseTime < 200 ? 'up' : avgResponseTime < 500 ? 'neutral' : 'down'}
          />
        </View>

        {/* Usage Chart */}
        {usageStats && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>API Usage Trends</Text>
            <UsageChart
              data={usageStats.requestsByDay}
              period="30d"
              onPeriodChange={(period) => console.log('Period changed:', period)}
            />
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActionsGrid}>
            <QuickActionCard
              icon="🔑"
              title="Generate API Key"
              description="Create a new API key"
              onPress={handleQuickCreateApiKey}
            />
            <QuickActionCard
              icon="📖"
              title="Documentation"
              description="Browse API docs"
              onPress={() => navigation.navigate('Documentation')}
            />
            <QuickActionCard
              icon="🧪"
              title="Test Endpoint"
              description="Try API calls"
              onPress={() => navigation.navigate('ApiTester')}
            />
            <QuickActionCard
              icon="🔔"
              title="Webhooks"
              description="Configure webhooks"
              onPress={() => navigation.navigate('WebhookSettings')}
            />
            <QuickActionCard
              icon="📥"
              title="Download SDK"
              description="Get client libraries"
              onPress={() => navigation.navigate('SdkDownload')}
            />
            <QuickActionCard
              icon="📋"
              title="Changelog"
              description="View updates"
              onPress={() => navigation.navigate('Changelog')}
            />
          </View>
        </View>

        {/* Recent Activity */}
        {recentUsage.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <TouchableOpacity onPress={() => navigation.navigate('UsageAnalytics')}>
                <Text style={styles.sectionLink}>View All →</Text>
              </TouchableOpacity>
            </View>
            <RecentActivity
              activities={recentUsage.slice(0, 10)}
              onActivityPress={(activity) => console.log('Activity:', activity)}
            />
          </View>
        )}

        {/* Resources */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resources</Text>
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={() => navigation.navigate('IntegrationGuides')}>
            <Text style={styles.resourceIcon}>📚</Text>
            <View style={styles.resourceContent}>
              <Text style={styles.resourceTitle}>Integration Guides</Text>
              <Text style={styles.resourceDescription}>
                Step-by-step guides for common integrations
              </Text>
            </View>
            <Text style={styles.resourceArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={() => navigation.navigate('ApiReference')}>
            <Text style={styles.resourceIcon}>📖</Text>
            <View style={styles.resourceContent}>
              <Text style={styles.resourceTitle}>API Reference</Text>
              <Text style={styles.resourceDescription}>
                Complete API documentation with examples
              </Text>
            </View>
            <Text style={styles.resourceArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={() => navigation.navigate('Support')}>
            <Text style={styles.resourceIcon}>💬</Text>
            <View style={styles.resourceContent}>
              <Text style={styles.resourceTitle}>Developer Support</Text>
              <Text style={styles.resourceDescription}>Get help from our developer community</Text>
            </View>
            <Text style={styles.resourceArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  tierBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  tierText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#FF3B30',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorText: {
    color: '#FFF',
    fontSize: 14,
    flex: 1,
  },
  errorDismiss: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    paddingLeft: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
  },
  sectionLink: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  resourceCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  resourceIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  resourceContent: {
    flex: 1,
  },
  resourceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  resourceDescription: {
    fontSize: 14,
    color: '#666',
  },
  resourceArrow: {
    fontSize: 20,
    color: '#007AFF',
    marginLeft: 8,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default DeveloperPortalScreen;
