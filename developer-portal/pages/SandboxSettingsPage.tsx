import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';

interface VirtualBalance {
  token: string;
  amount: string;
  usdValue: number;
  icon: string;
}

interface CleanupConfig {
  autoReset: boolean;
  resetInterval: 'daily' | 'weekly' | 'monthly';
  revokeExpiredKeys: boolean;
  archiveLogs: boolean;
  nextScheduledRun: string;
}

interface LeakageStats {
  totalAttempts: number;
  blocked: number;
  warnings: number;
  lastCheck: string;
}

interface SandboxSettingsPageProps {
  environmentId?: string;
  environmentName?: string;
  onNavigate: (page: string) => void;
  onBack: () => void;
}

export const SandboxSettingsPage: React.FC<SandboxSettingsPageProps> = ({
  environmentId = 'sbx_dev_001',
  environmentName = 'Development Sandbox',
  onNavigate: _onNavigate,
  onBack,
}) => {
  const [balances, setBalances] = useState<VirtualBalance[]>([
    { token: 'USDC', amount: '10,000.00', usdValue: 10000, icon: '💵' },
    { token: 'ETH', amount: '2.5000', usdValue: 6250, icon: '🔷' },
    { token: 'DAI', amount: '5,000.00', usdValue: 5000, icon: '🟡' },
    { token: 'WBTC', amount: '0.1500', usdValue: 6750, icon: '₿' },
  ]);

  const [cleanup, setCleanup] = useState<CleanupConfig>({
    autoReset: true,
    resetInterval: 'weekly',
    revokeExpiredKeys: true,
    archiveLogs: true,
    nextScheduledRun: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const [leakageStats] = useState<LeakageStats>({
    totalAttempts: 0,
    blocked: 0,
    warnings: 0,
    lastCheck: new Date().toISOString(),
  });

  const [toppingUp, setToppingUp] = useState<string | null>(null);

  const totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);

  const handleTopUp = (token: string) => {
    if (Alert.prompt) {
      Alert.prompt(
        `Top Up ${token}`,
        'Enter virtual amount to add (sandbox only, no real cost):',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: (value?: string) => {
              if (!value || isNaN(parseFloat(value))) {
                Alert.alert('Error', 'Please enter a valid number');
                return;
              }
              setToppingUp(token);
              setTimeout(() => {
                setBalances((prev) =>
                  prev.map((b) => {
                    if (b.token === token) {
                      const addedValue = parseFloat(value);
                      const tokenPrice = b.usdValue / parseFloat(b.amount.replace(/,/g, ''));
                      const newAmount = parseFloat(b.amount.replace(/,/g, '')) + addedValue;
                      return {
                        ...b,
                        amount: newAmount.toLocaleString('en-US', {
                          minimumFractionDigits: token === 'ETH' || token === 'WBTC' ? 4 : 2,
                          maximumFractionDigits: token === 'ETH' || token === 'WBTC' ? 4 : 2,
                        }),
                        usdValue: newAmount * tokenPrice,
                      };
                    }
                    return b;
                  })
                );
                setToppingUp(null);
                Alert.alert('✅ Balance Updated', `Added ${value} ${token} to virtual balance.`);
              }, 500);
            },
          },
        ],
        'plain-text',
        '1000'
      );
    } else {
      // Fallback for environments without Alert.prompt
      setToppingUp(token);
      setTimeout(() => {
        setBalances((prev) =>
          prev.map((b) => {
            if (b.token === token) {
              const tokenPrice = b.usdValue / parseFloat(b.amount.replace(/,/g, ''));
              const newAmount = parseFloat(b.amount.replace(/,/g, '')) + 1000;
              return {
                ...b,
                amount: newAmount.toLocaleString('en-US', {
                  minimumFractionDigits: token === 'ETH' || token === 'WBTC' ? 4 : 2,
                }),
                usdValue: newAmount * tokenPrice,
              };
            }
            return b;
          })
        );
        setToppingUp(null);
        Alert.alert('✅ Balance Updated', 'Added 1,000 to virtual balance.');
      }, 500);
    }
  };

  const handleResetData = () => {
    Alert.alert(
      'Reset Sandbox Data',
      'This will clear all test subscriptions, payments, and webhooks. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Alert.alert('✅ Data Reset', 'Sandbox test data has been cleared successfully.');
          },
        },
      ]
    );
  };

  const handleForceCleanup = () => {
    Alert.alert(
      '🧹 Cleanup Complete',
      'Sandbox cleanup has been executed. Expired keys revoked, old logs archived.'
    );
  };

  const handleMigrate = () => {
    Alert.alert(
      'Migration Wizard',
      'Ready to go to production? The migration wizard will guide you through the process.',
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Start Migration',
          onPress: () => {
            // Navigation to migration page
            Alert.alert('Migration', 'Opening migration wizard...');
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>⚙️ Sandbox Settings</Text>
        <Text style={styles.subtitle}>{environmentName}</Text>
      </View>

      {/* Environment Info Card */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Environment ID</Text>
          <Text style={styles.infoValue}>{environmentId}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status</Text>
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>API Version</Text>
          <Text style={styles.infoValue}>v1</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Rate Limit</Text>
          <Text style={styles.infoValue}>60 req/min</Text>
        </View>
      </View>

      {/* Virtual Balance Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>💰 Virtual Balance</Text>
        <Text style={styles.sectionDesc}>
          Sandbox-only virtual tokens. No real cost — top up anytime.
        </Text>

        <View style={styles.totalBalance}>
          <Text style={styles.totalLabel}>Total USD Value</Text>
          <Text style={styles.totalAmount}>
            ${totalUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
        </View>

        {balances.map((balance) => (
          <View key={balance.token} style={styles.balanceRow}>
            <View style={styles.balanceLeft}>
              <Text style={styles.balanceIcon}>{balance.icon}</Text>
              <View>
                <Text style={styles.balanceToken}>{balance.token}</Text>
                <Text style={styles.balanceAmount}>{balance.amount}</Text>
              </View>
            </View>
            <View style={styles.balanceRight}>
              <Text style={styles.balanceUsd}>
                ${balance.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
              <TouchableOpacity
                style={styles.topUpButton}
                onPress={() => handleTopUp(balance.token)}
                disabled={toppingUp === balance.token}>
                {toppingUp === balance.token ? (
                  <ActivityIndicator size="small" color="#6366F1" />
                ) : (
                  <Text style={styles.topUpText}>+ Top Up</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Cleanup Configuration */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🧹 Cleanup Schedule</Text>
        <Text style={styles.sectionDesc}>Automatic data cleanup keeps your sandbox healthy.</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto Reset Test Data</Text>
            <Text style={styles.settingDesc}>Regenerate fresh test data on schedule</Text>
          </View>
          <Switch
            value={cleanup.autoReset}
            onValueChange={(v) => setCleanup((prev) => ({ ...prev, autoReset: v }))}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={cleanup.autoReset ? '#6366F1' : '#9CA3AF'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Reset Interval</Text>
            <Text style={styles.settingDesc}>How often to run cleanup</Text>
          </View>
          <View style={styles.intervalButtons}>
            {(['daily', 'weekly', 'monthly'] as const).map((interval) => (
              <TouchableOpacity
                key={interval}
                style={[
                  styles.intervalButton,
                  cleanup.resetInterval === interval && styles.intervalButtonActive,
                ]}
                onPress={() => setCleanup((prev) => ({ ...prev, resetInterval: interval }))}>
                <Text
                  style={[
                    styles.intervalText,
                    cleanup.resetInterval === interval && styles.intervalTextActive,
                  ]}>
                  {interval.charAt(0).toUpperCase() + interval.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Revoke Expired Keys</Text>
            <Text style={styles.settingDesc}>Automatically revoke expired API keys</Text>
          </View>
          <Switch
            value={cleanup.revokeExpiredKeys}
            onValueChange={(v) => setCleanup((prev) => ({ ...prev, revokeExpiredKeys: v }))}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={cleanup.revokeExpiredKeys ? '#6366F1' : '#9CA3AF'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Archive Old Logs</Text>
            <Text style={styles.settingDesc}>Archive request logs older than 30 days</Text>
          </View>
          <Switch
            value={cleanup.archiveLogs}
            onValueChange={(v) => setCleanup((prev) => ({ ...prev, archiveLogs: v }))}
            trackColor={{ false: '#D1D5DB', true: '#818CF8' }}
            thumbColor={cleanup.archiveLogs ? '#6366F1' : '#9CA3AF'}
          />
        </View>

        <View style={styles.nextRun}>
          <Text style={styles.nextRunLabel}>Next Scheduled Cleanup:</Text>
          <Text style={styles.nextRunDate}>
            {new Date(cleanup.nextScheduledRun).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
        </View>
      </View>

      {/* Leakage Prevention Stats */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🛡️ Leakage Prevention</Text>
        <Text style={styles.sectionDesc}>Monitoring for sandbox-to-production data leakage.</Text>

        <View style={styles.leakageStats}>
          <View style={styles.leakageStat}>
            <Text style={styles.leakageStatNumber}>{leakageStats.totalAttempts}</Text>
            <Text style={styles.leakageStatLabel}>Total Checks</Text>
          </View>
          <View style={styles.leakageStat}>
            <Text style={[styles.leakageStatNumber, { color: '#EF4444' }]}>
              {leakageStats.blocked}
            </Text>
            <Text style={styles.leakageStatLabel}>Blocked</Text>
          </View>
          <View style={styles.leakageStat}>
            <Text style={[styles.leakageStatNumber, { color: '#F59E0B' }]}>
              {leakageStats.warnings}
            </Text>
            <Text style={styles.leakageStatLabel}>Warnings</Text>
          </View>
        </View>

        {leakageStats.blocked === 0 && leakageStats.warnings === 0 && (
          <View style={styles.cleanBanner}>
            <Text style={styles.cleanBannerIcon}>✅</Text>
            <Text style={styles.cleanBannerText}>
              No leakage detected. Your sandbox is properly isolated.
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔧 Actions</Text>

        <TouchableOpacity style={styles.actionButton} onPress={handleResetData}>
          <Text style={styles.actionButtonIcon}>🔄</Text>
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionButtonTitle}>Reset Test Data</Text>
            <Text style={styles.actionButtonDesc}>
              Clear all mock subscriptions, payments, and webhooks
            </Text>
          </View>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleForceCleanup}>
          <Text style={styles.actionButtonIcon}>🧹</Text>
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionButtonTitle}>Run Cleanup Now</Text>
            <Text style={styles.actionButtonDesc}>
              Force immediate cleanup of expired keys and old logs
            </Text>
          </View>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleMigrate}>
          <Text style={styles.actionButtonIcon}>🚀</Text>
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionButtonTitle}>Migration Wizard</Text>
            <Text style={styles.actionButtonDesc}>
              Guided process to move from sandbox to production
            </Text>
          </View>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.dangerButton]}
          onPress={() =>
            Alert.alert(
              'Delete Sandbox?',
              'This will permanently delete your sandbox environment and all test data.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => Alert.alert('Deleted', 'Sandbox environment deleted.'),
                },
              ]
            )
          }>
          <Text style={styles.actionButtonIcon}>🗑️</Text>
          <View style={styles.actionButtonContent}>
            <Text style={[styles.actionButtonTitle, { color: '#EF4444' }]}>Delete Sandbox</Text>
            <Text style={styles.actionButtonDesc}>Permanently remove this sandbox environment</Text>
          </View>
          <Text style={[styles.actionArrow, { color: '#EF4444' }]}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  backLink: {
    color: '#6366F1',
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  activeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  totalBalance: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 13,
    color: '#C7D2FE',
    marginBottom: 4,
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  balanceRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  balanceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  balanceIcon: {
    fontSize: 24,
  },
  balanceToken: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  balanceAmount: {
    fontSize: 13,
    color: '#6B7280',
  },
  balanceRight: {
    alignItems: 'flex-end',
  },
  balanceUsd: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  topUpButton: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  topUpText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366F1',
  },
  settingRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  settingDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  intervalButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  intervalButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  intervalButtonActive: {
    backgroundColor: '#6366F1',
  },
  intervalText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },
  intervalTextActive: {
    color: '#FFFFFF',
  },
  nextRun: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  nextRunLabel: {
    fontSize: 12,
    color: '#92400E',
    marginBottom: 2,
  },
  nextRunDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#78350F',
  },
  leakageStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  leakageStat: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  leakageStatNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  leakageStatLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  cleanBanner: {
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cleanBannerIcon: {
    fontSize: 16,
  },
  cleanBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#065F46',
  },
  actionButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  actionButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  actionButtonContent: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  actionButtonDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  actionArrow: {
    fontSize: 18,
    color: '#9CA3AF',
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  bottomSpacer: {
    height: 40,
  },
});
