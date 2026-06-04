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
import { usePaymentStore, PaymentMethod, PaymentPriority } from '../stores/paymentStore';
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

export const PaymentMethodsScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    methods,
    attemptLog,
    addMethod,
    removeMethod,
    verifyMethod,
    setPriority,
    getExpiringMethods,
    deactivateExpired,
  } = usePaymentStore();

  const [label, setLabel] = useState('');
  const [tokenType, setTokenType] = useState('USDC');
  const [tokenAddress, setTokenAddress] = useState('');
  const [priority, setPriorityState] = useState<PaymentPriority>('primary');
  const [maxSpend, setMaxSpend] = useState('');

  const expiringMethods = useMemo(() => getExpiringMethods(), [methods, getExpiringMethods]);

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
        <Text style={styles.expiry}>
          Expires: {new Date(item.expiresAt).toLocaleDateString()}
        </Text>
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

        {expiringMethods.length > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.status.warning }]}>
              Expiring Soon ({expiringMethods.length})
            </Text>
            {expiringMethods.map((m) => (
              <Text key={m.id} style={styles.expiringItem}>
                {m.label} — expires{' '}
                {m.expiresAt !== null ? new Date(m.expiresAt).toLocaleDateString() : ''}
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

        <View style={styles.methodsSection}>
          <Text style={styles.sectionTitle}>
            Payment Methods ({activeMethods.length})
          </Text>
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
                  </Text>
                  <Text
                    style={[
                      styles.attemptStatus,
                      { color: attempt.success ? colors.status.success : colors.status.error },
                    ]}>
                    {attempt.success ? 'Success' : attempt.failureReason ?? 'Failed'}
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
    sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    input: {
      ...typography.body,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      color: colors.text,
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
      borderColor: colors.border,
      alignItems: 'center',
    },
    priorityOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    priorityOptionText: { ...typography.caption, color: colors.text },
    priorityOptionTextActive: { color: colors.text, fontWeight: '600' },
    methodsSection: { padding: spacing.lg, paddingTop: 0 },
    methodCard: { marginBottom: spacing.md },
    methodHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    methodLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
    methodToken: { ...typography.caption, color: colors.textSecondary },
    methodBadges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    priorityBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: borderRadius.sm },
    priorityText: { ...typography.caption, fontWeight: '600' },
    verifiedBadge: { ...typography.caption, fontWeight: '600' },
    expiry: { ...typography.caption, color: colors.status.warning, marginBottom: spacing.sm },
    methodActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
      marginTop: spacing.sm,
    },
    expiringItem: { ...typography.body, color: colors.text, marginBottom: spacing.xs },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    attemptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    attemptLabel: { ...typography.caption, color: colors.text },
    attemptStatus: { ...typography.caption, fontWeight: '600' },
  });
}

export default PaymentMethodsScreen;
