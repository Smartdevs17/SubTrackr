import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
} from 'react-native';
import {
  usePaymentStore,
  PaymentMethod,
  PaymentPriority,
  FallbackChain,
  ExpiryAlert,
} from '../stores/paymentStore';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { spacing, typography, borderRadius } from '../../src/utils/constants';

const PRIORITY_OPTIONS: PaymentPriority[] = ['primary', 'backup', 'fallback'];

const PRIORITY_COLORS: Record<PaymentPriority, string> = {
  primary: '#22c55e',
  backup: '#f59e0b',
  fallback: '#6b7280',
};

const SEVERITY_COLORS: Record<ExpiryAlert['severity'], string> = {
  expired: '#ef4444',
  critical: '#f59e0b',
  warning: '#6b7280',
};

const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

export const PaymentMethodsScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    methods,
    attemptLog,
    chains,
    addMethod,
    removeMethod,
    verifyMethod,
    setPriority,
    deactivateExpired,
    createChain,
    deleteChain,
    reorderChain,
    validateChain,
    resolveChainMethods,
    getExpiryAlerts,
    getAnalytics,
  } = usePaymentStore();

  const [label, setLabel] = useState('');
  const [tokenType, setTokenType] = useState('USDC');
  const [tokenAddress, setTokenAddress] = useState('');
  const [priority, setPriorityState] = useState<PaymentPriority>('primary');
  const [maxSpend, setMaxSpend] = useState('');
  const [chainName, setChainName] = useState('');
  const [chainSelection, setChainSelection] = useState<string[]>([]);

  const alerts = useMemo(() => getExpiryAlerts(), [methods, chains, getExpiryAlerts]);
  const analytics = useMemo(
    () => getAnalytics(),
    [methods, attemptLog, getAnalytics]
  );

  const handleAdd = useCallback(() => {
    if (!label.trim() || !tokenAddress.trim()) {
      Alert.alert('Validation', 'Label and token address are required');
      return;
    }
    try {
      addMethod({
        label: label.trim(),
        tokenType: tokenType.trim() || 'USDC',
        tokenAddress: tokenAddress.trim(),
        chainId: 1,
        priority,
        maxSpendPerInterval: parseFloat(maxSpend) || 0,
        autoRechargeThreshold: 0,
        autoRechargeAmount: 0,
        expiresAt: null,
      });
      setLabel('');
      setTokenAddress('');
      setMaxSpend('');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }, [label, tokenType, tokenAddress, priority, maxSpend, addMethod]);

  const toggleChainSelection = useCallback((id: string) => {
    setChainSelection((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    );
  }, []);

  const handleCreateChain = useCallback(() => {
    try {
      createChain(chainName.trim() || `Chain ${chains.length + 1}`, chainSelection);
      setChainName('');
      setChainSelection([]);
    } catch (e) {
      Alert.alert('Cannot create chain', (e as Error).message);
    }
  }, [chainName, chainSelection, chains.length, createChain]);

  /** Move a method one place earlier in its chain. */
  const promoteInChain = useCallback(
    (chain: FallbackChain, index: number) => {
      if (index === 0) return;
      const next = [...chain.methodIds];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      reorderChain(chain.id, next);
    },
    [reorderChain]
  );

  const renderMethod = ({ item }: { item: PaymentMethod }) => (
    <Card style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <View>
          <Text style={styles.methodLabel}>{item.label}</Text>
          <Text style={styles.methodToken}>{item.tokenType}</Text>
        </View>
        <View style={styles.methodBadges}>
          <View
            style={[
              styles.priorityBadge,
              { backgroundColor: PRIORITY_COLORS[item.priority] + '30' },
            ]}>
            <Text style={[styles.priorityText, { color: PRIORITY_COLORS[item.priority] }]}>
              {item.priority}
            </Text>
          </View>
          {item.isVerified && (
            <Text style={[styles.verifiedBadge, { color: colors.status.success }]}>Verified</Text>
          )}
        </View>
      </View>
      {item.expiresAt !== null && (
        <Text style={styles.expiry}>Expires: {new Date(item.expiresAt).toLocaleDateString()}</Text>
      )}
      <View style={styles.methodActions}>
        {!item.isVerified && (
          <Button title="Verify" onPress={() => verifyMethod(item.id)} variant="secondary" />
        )}
        <Button
          title="Set Primary"
          onPress={() => setPriority(item.id, 'primary')}
          variant="secondary"
          disabled={item.priority === 'primary'}
        />
        <Button
          title="Remove"
          onPress={() => {
            Alert.alert('Remove Method', 'Remove this payment method?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => removeMethod(item.id),
              },
            ]);
          }}
          variant="secondary"
        />
      </View>
    </Card>
  );

  const activeMethods = methods.filter((m) => m.isActive);

  const renderChain = (chain: FallbackChain) => {
    const validation = validateChain(chain);
    const usable = resolveChainMethods(chain);
    const labels = new Map(methods.map((m) => [m.id, m.label]));

    return (
      <Card key={chain.id} style={styles.chainCard}>
        <View style={styles.methodHeader}>
          <View>
            <Text style={styles.methodLabel}>{chain.name}</Text>
            <Text style={styles.methodToken}>
              {chain.subscriptionId ? `Subscription ${chain.subscriptionId}` : 'All subscriptions'}{' '}
              · {usable.length}/{chain.methodIds.length} usable
            </Text>
          </View>
          <Button title="Delete" onPress={() => deleteChain(chain.id)} variant="secondary" />
        </View>

        {chain.methodIds.map((methodId, index) => (
          <View key={methodId} style={styles.chainStep}>
            <Text style={styles.chainStepText}>
              {index + 1}. {labels.get(methodId) ?? methodId}
            </Text>
            <TouchableOpacity
              onPress={() => promoteInChain(chain, index)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel={`Move ${labels.get(methodId) ?? methodId} earlier`}>
              <Text style={[styles.chainMove, index === 0 && styles.chainMoveDisabled]}>
                Move up
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {validation.warnings.map((warning) => (
          <Text key={warning} style={[styles.alertText, { color: colors.status.warning }]}>
            {warning}
          </Text>
        ))}
        {validation.errors.map((error) => (
          <Text key={error} style={[styles.alertText, { color: colors.status.error }]}>
            {error}
          </Text>
        ))}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Add Payment Method</Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="Label (e.g. Primary USDC)"
            placeholderTextColor={colors.textSecondary}
          />
          <TextInput
            style={styles.input}
            value={tokenType}
            onChangeText={setTokenType}
            placeholder="Token type (USDC, XLM, ETH...)"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.input}
            value={tokenAddress}
            onChangeText={setTokenAddress}
            placeholder="Token address / wallet"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={maxSpend}
            onChangeText={setMaxSpend}
            placeholder="Max spend per interval (0 = unlimited)"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />
          <Text style={styles.fieldLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITY_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.priorityOption, priority === p && styles.priorityOptionActive]}
                onPress={() => setPriorityState(p)}>
                <Text
                  style={[
                    styles.priorityOptionText,
                    priority === p && styles.priorityOptionTextActive,
                  ]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button title="Add Method" onPress={handleAdd} />
        </Card>

        {alerts.length > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.status.warning }]}>
              Expiry Alerts ({alerts.length})
            </Text>
            {alerts.map((alert) => (
              <Text
                key={alert.methodId}
                style={[styles.alertText, { color: SEVERITY_COLORS[alert.severity] }]}>
                {alert.message}
              </Text>
            ))}
            <Button
              title="Deactivate Expired"
              onPress={() => {
                const count = deactivateExpired();
                Alert.alert('Done', `Deactivated ${count} expired method(s)`);
              }}
              variant="secondary"
            />
          </Card>
        )}

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Fallback Chains ({chains.length})</Text>
          <Text style={styles.hint}>
            A chain is tried in order until one method succeeds. Without a chain, charges follow the
            priority ordering.
          </Text>
          <TextInput
            style={styles.input}
            value={chainName}
            onChangeText={setChainName}
            placeholder="Chain name"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={styles.fieldLabel}>
            Methods in order ({chainSelection.length} selected)
          </Text>
          {activeMethods.map((method) => {
            const position = chainSelection.indexOf(method.id);
            const selected = position >= 0;
            return (
              <TouchableOpacity
                key={method.id}
                style={[styles.selectRow, selected && styles.selectRowActive]}
                onPress={() => toggleChainSelection(method.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${method.label} ${
                  selected ? 'from' : 'to'
                } the chain`}>
                <Text style={styles.selectRowText}>
                  {selected ? `${position + 1}. ` : ''}
                  {method.label}
                </Text>
                <Text style={styles.selectRowToken}>{method.tokenType}</Text>
              </TouchableOpacity>
            );
          })}
          <Button
            title="Create Chain"
            onPress={handleCreateChain}
            disabled={chainSelection.length === 0}
          />
          {chains.map(renderChain)}
        </Card>

        {analytics.totalAttempts > 0 && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Payment Analytics</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{analytics.totalAttempts}</Text>
                <Text style={styles.statLabel}>Attempts</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: colors.status.success }]}>
                  {formatPercent(analytics.successRate)}
                </Text>
                <Text style={styles.statLabel}>Success</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{formatPercent(analytics.fallbackRate)}</Text>
                <Text style={styles.statLabel}>Via fallback</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{analytics.expiringMethods}</Text>
                <Text style={styles.statLabel}>Expiring</Text>
              </View>
            </View>

            {analytics.byMethod.map((stat) => (
              <View key={stat.methodId} style={styles.attemptRow}>
                <Text style={styles.attemptLabel}>{stat.label}</Text>
                <Text style={styles.attemptStatus}>
                  {formatPercent(stat.successRate)} of {stat.attempts}
                  {stat.topFailureReason ? ` · ${stat.topFailureReason}` : ''}
                </Text>
              </View>
            ))}

            {analytics.failureReasons.length > 0 && (
              <Text style={styles.hint}>
                Top failures:{' '}
                {analytics.failureReasons
                  .slice(0, 3)
                  .map(({ reason, count }) => `${reason} (${count})`)
                  .join(', ')}
              </Text>
            )}
          </Card>
        )}

        <View style={styles.methodsSection}>
          <Text style={styles.sectionTitle}>Payment Methods ({activeMethods.length})</Text>
          {activeMethods.length === 0 ? (
            <Text style={styles.emptyText}>No payment methods added yet</Text>
          ) : (
            <FlatList
              data={activeMethods}
              keyExtractor={(item) => item.id}
              renderItem={renderMethod}
              scrollEnabled={false}
            />
          )}
        </View>

        {attemptLog.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Recent Attempts</Text>
            {attemptLog
              .slice(-5)
              .reverse()
              .map((attempt, index) => (
                <View key={index} style={styles.attemptRow}>
                  <Text style={styles.attemptLabel}>
                    {methods.find((m) => m.id === attempt.methodId)?.label ?? attempt.methodId}
                    {attempt.chainPosition !== undefined ? ` · step ${attempt.chainPosition + 1}` : ''}
                  </Text>
                  <Text
                    style={[
                      styles.attemptStatus,
                      { color: attempt.success ? colors.status.success : colors.status.error },
                    ]}>
                    {attempt.success ? 'Success' : (attempt.failureReason ?? 'Failed')}
                  </Text>
                </View>
              ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    card: { margin: spacing.lg, marginBottom: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
    input: {
      ...typography.body,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      color: colors.text.primary,
      backgroundColor: colors.surface,
      marginBottom: spacing.md,
    },
    fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    priorityRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    priorityOption: {
      flex: 1,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border.default,
      alignItems: 'center',
    },
    priorityOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    priorityOptionText: { ...typography.caption, color: colors.text.primary },
    priorityOptionTextActive: { color: colors.text.inverse, fontWeight: '600' },
    methodsSection: { padding: spacing.lg, paddingTop: 0 },
    methodCard: { marginBottom: spacing.md },
    methodHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    methodLabel: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    methodToken: { ...typography.caption, color: colors.textSecondary },
    methodBadges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    priorityBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    priorityText: { ...typography.caption, fontWeight: '600' },
    verifiedBadge: { ...typography.caption, fontWeight: '600' },
    expiry: { ...typography.caption, color: colors.status.warning, marginBottom: spacing.sm },
    methodActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
      marginTop: spacing.sm,
    },
    alertText: { ...typography.caption, marginBottom: spacing.xs },
    selectRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border.default,
      marginBottom: spacing.xs,
    },
    selectRowActive: { borderColor: colors.primary },
    selectRowText: { ...typography.body, color: colors.text.primary },
    selectRowToken: { ...typography.caption, color: colors.textSecondary },
    chainCard: { marginTop: spacing.md },
    chainStep: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    chainStepText: { ...typography.caption, color: colors.text.primary },
    chainMove: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    chainMoveDisabled: { color: colors.textSecondary },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    statBox: { alignItems: 'center', flex: 1 },
    statValue: { ...typography.h3, color: colors.text.primary },
    statLabel: { ...typography.caption, color: colors.textSecondary },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    attemptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    attemptLabel: { ...typography.caption, color: colors.text.primary },
    attemptStatus: { ...typography.caption, fontWeight: '600' },
  });
}

export default PaymentMethodsScreen;
