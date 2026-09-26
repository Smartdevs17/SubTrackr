/**
 * PaymentMethodManager
 *
 * Full-screen UI for managing payment methods and their fallback chains.
 * Tabs:
 *   methods  – list / add / edit / remove payment methods
 *   chains   – configure ordered fallback chains per subscription
 *   analytics– success rates, failure reasons and volume
 *   alerts   – expiry warnings
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
  SafeAreaView,
} from 'react-native';
import { useWalletStore } from '../../store/walletStore';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  FallbackChain,
  PaymentMethodExpiryAlert,
  PaymentMethodAnalytics,
} from '../../types/wallet';
import type { ManagerTab, PaymentMethodFormState, PaymentMethodManagerProps } from '../../types/paymentMethod';

// ── Colour palette (matches existing app theme) ────────────────────────────

const COLORS = {
  primary: '#6366F1',
  primaryLight: '#818CF8',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#94A3B8',
  surface: '#1E293B',
  surfaceLight: '#334155',
  background: '#0F172A',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  border: '#334155',
  white: '#FFFFFF',
} as const;

const PRIORITY_COLOR: Record<PaymentPriority, string> = {
  [PaymentPriority.PRIMARY]: COLORS.success,
  [PaymentPriority.BACKUP]: COLORS.warning,
  [PaymentPriority.FALLBACK]: COLORS.muted,
};

const PRIORITY_LABEL: Record<PaymentPriority, string> = {
  [PaymentPriority.PRIMARY]: 'Primary',
  [PaymentPriority.BACKUP]: 'Backup',
  [PaymentPriority.FALLBACK]: 'Fallback',
};

// ── Helper components ──────────────────────────────────────────────────────

interface PillProps {
  label: string;
  color?: string;
  small?: boolean;
}
const Pill: React.FC<PillProps> = ({ label, color = COLORS.primary, small = false }) => (
  <View style={[styles.pill, { borderColor: color }, small && styles.pillSmall]}>
    <Text style={[styles.pillText, { color }, small && styles.pillTextSmall]}>{label}</Text>
  </View>
);

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}
const SectionHeader: React.FC<SectionHeaderProps> = ({ title, action }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label}>
        <Text style={styles.sectionAction}>{action.label}</Text>
      </TouchableOpacity>
    )}
  </View>
);

// ── Tab bar ────────────────────────────────────────────────────────────────

const TABS: { id: ManagerTab; label: string }[] = [
  { id: 'methods', label: 'Methods' },
  { id: 'chains', label: 'Chains' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'alerts', label: 'Alerts' },
];

interface TabBarProps {
  active: ManagerTab;
  onChange: (tab: ManagerTab) => void;
  alertCount: number;
}
const TabBar: React.FC<TabBarProps> = ({ active, onChange, alertCount }) => (
  <View style={styles.tabBar}>
    {TABS.map((tab) => {
      const isActive = tab.id === active;
      const badge = tab.id === 'alerts' && alertCount > 0 ? alertCount : 0;
      return (
        <TouchableOpacity
          key={tab.id}
          style={[styles.tab, isActive && styles.tabActive]}
          onPress={() => onChange(tab.id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={`${tab.label}${badge ? `, ${badge} alerts` : ''}`}
        >
          <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
          {badge > 0 && (
            <View style={styles.badge} accessibilityLabel={`${badge} alerts`}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    })}
  </View>
);

// ── Payment method card ────────────────────────────────────────────────────

interface MethodCardProps {
  method: PaymentMethod;
  onEdit: (method: PaymentMethod) => void;
  onRemove: (id: string) => void;
  onVerify: (id: string) => void;
  onSetPriority: (id: string, priority: PaymentPriority) => void;
}
const MethodCard: React.FC<MethodCardProps> = ({
  method,
  onEdit,
  onRemove,
  onVerify,
  onSetPriority,
}) => {
  const expiryText = useMemo(() => {
    if (!method.expiresAt) return null;
    const days = Math.ceil((method.expiresAt.getTime() - Date.now()) / 86_400_000);
    if (days <= 0) return `Expired ${Math.abs(days)}d ago`;
    if (days <= 7) return `Expires in ${days}d (critical)`;
    if (days <= 30) return `Expires in ${days}d`;
    return null;
  }, [method.expiresAt]);

  const expiryColor =
    expiryText?.includes('Expired') || expiryText?.includes('critical')
      ? COLORS.danger
      : COLORS.warning;

  return (
    <View
      style={[styles.card, !method.isActive && styles.cardInactive]}
      accessibilityRole="none"
      accessible={false}
    >
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{method.label}</Text>
          {!method.isActive && <Pill label="Inactive" color={COLORS.muted} small />}
          {method.isVerified ? (
            <Pill label="Verified" color={COLORS.success} small />
          ) : (
            <Pill label="Unverified" color={COLORS.warning} small />
          )}
        </View>
        <Pill
          label={PRIORITY_LABEL[method.priority]}
          color={PRIORITY_COLOR[method.priority]}
          small
        />
      </View>

      {/* Details */}
      <View style={styles.cardDetails}>
        <Text style={styles.cardDetail}>
          <Text style={styles.cardDetailLabel}>Token: </Text>
          {method.tokenType}
        </Text>
        <Text style={styles.cardDetail}>
          <Text style={styles.cardDetailLabel}>Chain: </Text>
          {method.chainId}
        </Text>
        {method.maxSpendPerInterval ? (
          <Text style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>Max spend: </Text>
            {method.maxSpendPerInterval}
          </Text>
        ) : null}
        {method.lastUsedAt && (
          <Text style={styles.cardDetail}>
            <Text style={styles.cardDetailLabel}>Last used: </Text>
            {method.lastUsedAt.toLocaleDateString()}
          </Text>
        )}
      </View>

      {expiryText && (
        <Text style={[styles.expiryText, { color: expiryColor }]} accessibilityRole="text">
          ⚠ {expiryText}
        </Text>
      )}

      {/* Priority quick-select */}
      <View style={styles.priorityRow}>
        <Text style={styles.priorityLabel}>Priority:</Text>
        {Object.values(PaymentPriority).map((p) => (
          <TouchableOpacity
            key={p}
            style={[
              styles.priorityBtn,
              method.priority === p && { backgroundColor: PRIORITY_COLOR[p] },
            ]}
            onPress={() => onSetPriority(method.id, p)}
            accessibilityRole="radio"
            accessibilityState={{ checked: method.priority === p }}
            accessibilityLabel={`Set priority to ${PRIORITY_LABEL[p]}`}
          >
            <Text
              style={[
                styles.priorityBtnText,
                method.priority === p && styles.priorityBtnTextActive,
              ]}
            >
              {PRIORITY_LABEL[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onEdit(method)}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${method.label}`}
        >
          <Text style={styles.actionBtnText}>Edit</Text>
        </TouchableOpacity>
        {!method.isVerified && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnVerify]}
            onPress={() => onVerify(method.id)}
            accessibilityRole="button"
            accessibilityLabel={`Verify ${method.label}`}
          >
            <Text style={[styles.actionBtnText, { color: COLORS.warning }]}>Verify</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnDanger]}
          onPress={() =>
            Alert.alert('Remove Method', `Remove "${method.label}"?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => onRemove(method.id) },
            ])
          }
          accessibilityRole="button"
          accessibilityLabel={`Remove ${method.label}`}
        >
          <Text style={[styles.actionBtnText, { color: COLORS.danger }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Add / Edit form ────────────────────────────────────────────────────────

interface MethodFormValues {
  label: string;
  tokenType: TokenType;
  tokenAddress: string;
  chainId: string;
  priority: PaymentPriority;
  maxSpendPerInterval: string;
}

const EMPTY_FORM: MethodFormValues = {
  label: '',
  tokenType: TokenType.NATIVE,
  tokenAddress: '0x0000000000000000000000000000000000000000',
  chainId: '1',
  priority: PaymentPriority.PRIMARY,
  maxSpendPerInterval: '100',
};

interface MethodFormProps {
  initial?: Partial<MethodFormValues>;
  onSubmit: (values: MethodFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}
const MethodForm: React.FC<MethodFormProps> = ({
  initial,
  onSubmit,
  onCancel,
  isLoading,
}) => {
  const [values, setValues] = useState<MethodFormValues>({ ...EMPTY_FORM, ...initial });
  const set = (key: keyof MethodFormValues, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>{initial ? 'Edit Method' : 'Add Payment Method'}</Text>

      <Text style={styles.fieldLabel}>Label *</Text>
      <TextInput
        style={styles.input}
        value={values.label}
        onChangeText={(v) => set('label', v)}
        placeholder="e.g. My ETH wallet"
        placeholderTextColor={COLORS.muted}
        accessibilityLabel="Label"
      />

      <Text style={styles.fieldLabel}>Token Type *</Text>
      <View style={styles.segmented}>
        {Object.values(TokenType).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.segment, values.tokenType === t && styles.segmentActive]}
            onPress={() => set('tokenType', t)}
            accessibilityRole="radio"
            accessibilityState={{ checked: values.tokenType === t }}
            accessibilityLabel={t}
          >
            <Text style={[styles.segmentText, values.tokenType === t && styles.segmentTextActive]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {values.tokenType !== TokenType.NATIVE && (
        <>
          <Text style={styles.fieldLabel}>Token Address *</Text>
          <TextInput
            style={styles.input}
            value={values.tokenAddress}
            onChangeText={(v) => set('tokenAddress', v)}
            placeholder="0x..."
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            accessibilityLabel="Token address"
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Chain ID *</Text>
      <TextInput
        style={styles.input}
        value={values.chainId}
        onChangeText={(v) => set('chainId', v)}
        placeholder="1"
        placeholderTextColor={COLORS.muted}
        keyboardType="number-pad"
        accessibilityLabel="Chain ID"
      />

      <Text style={styles.fieldLabel}>Priority *</Text>
      <View style={styles.segmented}>
        {Object.values(PaymentPriority).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.segment, values.priority === p && styles.segmentActive]}
            onPress={() => set('priority', p)}
            accessibilityRole="radio"
            accessibilityState={{ checked: values.priority === p }}
            accessibilityLabel={PRIORITY_LABEL[p]}
          >
            <Text
              style={[styles.segmentText, values.priority === p && styles.segmentTextActive]}
            >
              {PRIORITY_LABEL[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Max spend per interval *</Text>
      <TextInput
        style={styles.input}
        value={values.maxSpendPerInterval}
        onChangeText={(v) => set('maxSpendPerInterval', v)}
        placeholder="100"
        placeholderTextColor={COLORS.muted}
        keyboardType="decimal-pad"
        accessibilityLabel="Max spend per interval"
      />

      <View style={styles.formActions}>
        <TouchableOpacity
          style={[styles.formBtn, styles.formBtnCancel]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          disabled={isLoading}
        >
          <Text style={styles.formBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.formBtn, styles.formBtnSubmit, isLoading && styles.formBtnDisabled]}
          onPress={() => onSubmit(values)}
          accessibilityRole="button"
          accessibilityLabel="Save payment method"
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={[styles.formBtnText, { color: COLORS.white }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Methods tab ────────────────────────────────────────────────────────────

interface MethodsTabProps {
  methods: PaymentMethod[];
  isLoading: boolean;
  onAdd: (values: MethodFormValues) => Promise<void>;
  onEdit: (id: string, updates: Partial<PaymentMethod>) => Promise<void>;
  onRemove: (id: string) => void;
  onVerify: (id: string) => void;
  onSetPriority: (id: string, priority: PaymentPriority) => void;
}

const MethodsTab: React.FC<MethodsTabProps> = ({
  methods,
  isLoading,
  onAdd,
  onEdit,
  onRemove,
  onVerify,
  onSetPriority,
}) => {
  const [formState, setFormState] = useState<PaymentMethodFormState>({ editingId: null, isOpen: false });
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);

  const openAdd = () => {
    setEditingMethod(null);
    setFormState({ editingId: null, isOpen: true });
  };

  const openEdit = (method: PaymentMethod) => {
    setEditingMethod(method);
    setFormState({ editingId: method.id, isOpen: true });
  };

  const closeForm = () => {
    setFormState({ editingId: null, isOpen: false });
    setEditingMethod(null);
  };

  const handleSubmit = useCallback(
    async (values: MethodFormValues) => {
      if (formState.editingId) {
        await onEdit(formState.editingId, {
          label: values.label,
          priority: values.priority,
          maxSpendPerInterval: values.maxSpendPerInterval,
        });
      } else {
        await onAdd(values);
      }
      closeForm();
    },
    [formState.editingId, onAdd, onEdit]
  );

  const byPriority = useMemo(() => {
    const order: Record<PaymentPriority, number> = {
      [PaymentPriority.PRIMARY]: 0,
      [PaymentPriority.BACKUP]: 1,
      [PaymentPriority.FALLBACK]: 2,
    };
    return [...methods].sort((a, b) => order[a.priority] - order[b.priority]);
  }, [methods]);

  if (formState.isOpen) {
    const initial = editingMethod
      ? {
          label: editingMethod.label,
          tokenType: editingMethod.tokenType,
          tokenAddress: editingMethod.tokenAddress,
          chainId: String(editingMethod.chainId),
          priority: editingMethod.priority,
          maxSpendPerInterval: editingMethod.maxSpendPerInterval,
        }
      : undefined;
    return (
      <ScrollView style={styles.tabContent} keyboardShouldPersistTaps="handled">
        <MethodForm
          initial={initial}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          isLoading={isLoading}
        />
      </ScrollView>
    );
  }

  return (
    <View style={styles.tabContent}>
      <SectionHeader
        title={`Payment Methods (${methods.length})`}
        action={{ label: '+ Add', onPress: openAdd }}
      />
      {methods.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No payment methods yet.</Text>
          <TouchableOpacity
            style={styles.emptyStateBtn}
            onPress={openAdd}
            accessibilityRole="button"
            accessibilityLabel="Add your first payment method"
          >
            <Text style={styles.emptyStateBtnText}>Add your first method</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={byPriority}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MethodCard
              method={item}
              onEdit={openEdit}
              onRemove={onRemove}
              onVerify={onVerify}
              onSetPriority={onSetPriority}
            />
          )}
          contentContainerStyle={styles.listContent}
          scrollEnabled={false}
        />
      )}
    </View>
  );
};

// ── Chains tab ─────────────────────────────────────────────────────────────

interface ChainsTabProps {
  chains: FallbackChain[];
  methods: PaymentMethod[];
  onCreateChain: (name: string, methodIds: string[]) => void;
  onDeleteChain: (id: string) => void;
  onReorderChain: (id: string, methodIds: string[]) => void;
}

const ChainsTab: React.FC<ChainsTabProps> = ({
  chains,
  methods,
  onCreateChain,
  onDeleteChain,
  onReorderChain,
}) => {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleMethod = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleCreate = () => {
    if (!newName.trim()) {
      Alert.alert('Validation', 'Chain name is required.');
      return;
    }
    if (selectedIds.length === 0) {
      Alert.alert('Validation', 'Select at least one method.');
      return;
    }
    onCreateChain(newName.trim(), selectedIds);
    setNewName('');
    setSelectedIds([]);
    setShowNewForm(false);
  };

  const methodById = useMemo(
    () => new Map(methods.map((m) => [m.id, m])),
    [methods]
  );

  return (
    <ScrollView style={styles.tabContent}>
      <SectionHeader
        title={`Fallback Chains (${chains.length})`}
        action={!showNewForm ? { label: '+ New', onPress: () => setShowNewForm(true) } : undefined}
      />

      {showNewForm && (
        <View style={styles.card}>
          <Text style={styles.formTitle}>New Fallback Chain</Text>

          <Text style={styles.fieldLabel}>Name *</Text>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Default chain"
            placeholderTextColor={COLORS.muted}
            accessibilityLabel="Chain name"
          />

          <Text style={styles.fieldLabel}>Select methods (in fallback order)</Text>
          {methods.length === 0 ? (
            <Text style={styles.textMuted}>Add payment methods first.</Text>
          ) : (
            methods.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.checkRow,
                  selectedIds.includes(m.id) && styles.checkRowSelected,
                ]}
                onPress={() => toggleMethod(m.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedIds.includes(m.id) }}
                accessibilityLabel={m.label}
              >
                <View
                  style={[
                    styles.checkbox,
                    selectedIds.includes(m.id) && styles.checkboxChecked,
                  ]}
                />
                <View style={styles.checkRowContent}>
                  <Text style={styles.checkRowLabel}>{m.label}</Text>
                  <Text style={styles.checkRowSub}>
                    {m.tokenType} · {PRIORITY_LABEL[m.priority]}
                  </Text>
                </View>
                {selectedIds.includes(m.id) && (
                  <Text style={styles.checkOrder}>{selectedIds.indexOf(m.id) + 1}</Text>
                )}
              </TouchableOpacity>
            ))
          )}

          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.formBtn, styles.formBtnCancel]}
              onPress={() => { setShowNewForm(false); setNewName(''); setSelectedIds([]); }}
              accessibilityRole="button"
              accessibilityLabel="Cancel new chain"
            >
              <Text style={styles.formBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.formBtn, styles.formBtnSubmit]}
              onPress={handleCreate}
              accessibilityRole="button"
              accessibilityLabel="Create chain"
            >
              <Text style={[styles.formBtnText, { color: COLORS.white }]}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {chains.length === 0 && !showNewForm ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No fallback chains configured.</Text>
          <Text style={styles.textMuted}>
            Chains let you specify the exact order methods are tried for each charge.
          </Text>
        </View>
      ) : (
        chains.map((chain) => {
          const resolvedMethods = chain.methodIds
            .map((id) => methodById.get(id))
            .filter((m): m is PaymentMethod => m !== undefined);

          return (
            <View key={chain.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{chain.name}</Text>
                {!chain.isActive && <Pill label="Inactive" color={COLORS.muted} small />}
              </View>
              {chain.subscriptionId && (
                <Text style={styles.cardDetail}>
                  <Text style={styles.cardDetailLabel}>Subscription: </Text>
                  {chain.subscriptionId}
                </Text>
              )}
              <Text style={styles.fieldLabel}>Order:</Text>
              {resolvedMethods.map((m, idx) => (
                <View key={m.id} style={styles.chainMethodRow}>
                  <Text style={styles.chainPosition}>{idx + 1}</Text>
                  <View style={styles.chainMethodInfo}>
                    <Text style={styles.chainMethodLabel}>{m.label}</Text>
                    <Text style={styles.chainMethodSub}>
                      {m.tokenType} · {PRIORITY_LABEL[m.priority]}
                      {!m.isActive ? ' · Inactive' : ''}
                      {!m.isVerified ? ' · Unverified' : ''}
                    </Text>
                  </View>
                </View>
              ))}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  onPress={() =>
                    Alert.alert('Delete Chain', `Delete "${chain.name}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => onDeleteChain(chain.id),
                      },
                    ])
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Delete chain ${chain.name}`}
                >
                  <Text style={[styles.actionBtnText, { color: COLORS.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

// ── Analytics tab ──────────────────────────────────────────────────────────

interface AnalyticsTabProps {
  analytics: PaymentMethodAnalytics;
}
const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ analytics }) => {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <ScrollView style={styles.tabContent}>
      <SectionHeader title="Payment Analytics" />

      {/* Overview */}
      <View style={styles.statsRow}>
        {[
          { label: 'Total attempts', value: String(analytics.totalAttempts) },
          { label: 'Success rate', value: pct(analytics.successRate) },
          { label: 'Fallback rate', value: pct(analytics.fallbackRate) },
          { label: 'Active methods', value: String(analytics.activeMethods) },
        ].map(({ label, value }) => (
          <View key={label} style={styles.statCard}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Per-method breakdown */}
      <SectionHeader title="By Method" />
      {analytics.byMethod.length === 0 ? (
        <Text style={styles.textMuted}>No payment attempts recorded yet.</Text>
      ) : (
        analytics.byMethod.map((entry) => (
          <View key={entry.methodId} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{entry.label}</Text>
              <Text style={[
                styles.cardDetail,
                { color: entry.successRate >= 0.8 ? COLORS.success : COLORS.danger }
              ]}>
                {pct(entry.successRate)}
              </Text>
            </View>
            <View style={styles.analyticsRow}>
              <Text style={styles.cardDetail}>
                {entry.successes} / {entry.attempts} attempts
              </Text>
              <Text style={styles.cardDetail}>Vol: {entry.volume.toFixed(4)}</Text>
            </View>
            {entry.topFailureReason && (
              <Text style={[styles.cardDetail, { color: COLORS.danger }]} numberOfLines={2}>
                Top failure: {entry.topFailureReason}
              </Text>
            )}
          </View>
        ))
      )}

      {/* Failure reasons */}
      {analytics.failureReasons.length > 0 && (
        <>
          <SectionHeader title="Failure Reasons" />
          {analytics.failureReasons.map(({ reason, count }) => (
            <View key={reason} style={styles.failureRow}>
              <Text style={styles.failureReason} numberOfLines={2}>{reason}</Text>
              <Text style={styles.failureCount}>{count}×</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
};

// ── Alerts tab ─────────────────────────────────────────────────────────────

interface AlertsTabProps {
  alerts: PaymentMethodExpiryAlert[];
  onDeactivateExpired: () => void;
}
const AlertsTab: React.FC<AlertsTabProps> = ({ alerts, onDeactivateExpired }) => {
  const severityColor: Record<PaymentMethodExpiryAlert['severity'], string> = {
    expired: COLORS.danger,
    critical: COLORS.danger,
    warning: COLORS.warning,
  };

  const hasExpired = alerts.some((a) => a.severity === 'expired');

  return (
    <ScrollView style={styles.tabContent}>
      <SectionHeader title={`Expiry Alerts (${alerts.length})`} />

      {hasExpired && (
        <TouchableOpacity
          style={styles.deactivateBtn}
          onPress={() =>
            Alert.alert(
              'Deactivate Expired Methods',
              'This will mark all expired methods as inactive.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Deactivate', style: 'destructive', onPress: onDeactivateExpired },
              ]
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Deactivate all expired methods"
        >
          <Text style={styles.deactivateBtnText}>Deactivate all expired</Text>
        </TouchableOpacity>
      )}

      {alerts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>✓ No expiry alerts.</Text>
          <Text style={styles.textMuted}>All your payment methods are in good standing.</Text>
        </View>
      ) : (
        alerts.map((alert) => (
          <View
            key={alert.methodId}
            style={[styles.card, styles.alertCard, { borderLeftColor: severityColor[alert.severity] }]}
            accessibilityRole="alert"
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{alert.label}</Text>
              <Pill
                label={alert.severity.toUpperCase()}
                color={severityColor[alert.severity]}
                small
              />
            </View>
            <Text style={[styles.cardDetail, { color: severityColor[alert.severity] }]}>
              {alert.message}
            </Text>
            {alert.inActiveChain && (
              <Text style={[styles.cardDetail, { color: COLORS.danger }]}>
                ⚠ Still in an active fallback chain
              </Text>
            )}
            <Text style={styles.textMuted}>
              Expires: {alert.expiresAt.toLocaleDateString()}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
};

// ── Root component ─────────────────────────────────────────────────────────

export const PaymentMethodManager: React.FC<PaymentMethodManagerProps> = ({
  initialTab = 'methods',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ManagerTab>(initialTab);

  // Store selectors
  const paymentMethods = useWalletStore((s) => s.paymentMethods);
  const fallbackChains = useWalletStore((s) => s.fallbackChains);
  const isLoading = useWalletStore((s) => s.isLoading);
  const error = useWalletStore((s) => s.error);

  const addPaymentMethod = useWalletStore((s) => s.addPaymentMethod);
  const removePaymentMethod = useWalletStore((s) => s.removePaymentMethod);
  const updatePaymentMethod = useWalletStore((s) => s.updatePaymentMethod);
  const verifyPaymentMethod = useWalletStore((s) => s.verifyPaymentMethod);
  const setPaymentMethodPriority = useWalletStore((s) => s.setPaymentMethodPriority);
  const createFallbackChain = useWalletStore((s) => s.createFallbackChain);
  const deleteFallbackChain = useWalletStore((s) => s.deleteFallbackChain);
  const reorderFallbackChain = useWalletStore((s) => s.reorderFallbackChain);
  const expiryAlerts = useWalletStore((s) => s.expiryAlerts);
  const deactivateExpiredMethods = useWalletStore((s) => s.deactivateExpiredMethods);
  const paymentAnalytics = useWalletStore((s) => s.paymentAnalytics);

  // Derived
  const alerts = useMemo(() => expiryAlerts(), [expiryAlerts, paymentMethods, fallbackChains]);
  const analytics = useMemo(
    () => paymentAnalytics(),
    [paymentAnalytics, paymentMethods]
  );

  // Handlers
  const handleAdd = useCallback(
    async (values: MethodFormValues) => {
      try {
        await addPaymentMethod({
          tokenType: values.tokenType,
          tokenAddress: values.tokenAddress,
          chainId: Number(values.chainId),
          label: values.label,
          priority: values.priority,
          maxSpendPerInterval: values.maxSpendPerInterval,
        });
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to add method');
      }
    },
    [addPaymentMethod]
  );

  const handleEdit = useCallback(
    async (id: string, updates: Partial<PaymentMethod>) => {
      try {
        await updatePaymentMethod(id, updates);
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update method');
      }
    },
    [updatePaymentMethod]
  );

  const handleRemove = useCallback(
    (id: string) => {
      removePaymentMethod(id).catch((e: unknown) =>
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to remove method')
      );
    },
    [removePaymentMethod]
  );

  const handleVerify = useCallback(
    (id: string) => {
      verifyPaymentMethod(id).catch((e: unknown) =>
        Alert.alert('Verification failed', e instanceof Error ? e.message : 'Could not verify')
      );
    },
    [verifyPaymentMethod]
  );

  const handleSetPriority = useCallback(
    (id: string, priority: PaymentPriority) => {
      setPaymentMethodPriority(id, priority).catch((e: unknown) =>
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to set priority')
      );
    },
    [setPaymentMethodPriority]
  );

  const handleCreateChain = useCallback(
    (name: string, methodIds: string[]) => {
      try {
        createFallbackChain(name, methodIds);
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create chain');
      }
    },
    [createFallbackChain]
  );

  const handleDeactivateExpired = useCallback(() => {
    const count = deactivateExpiredMethods();
    Alert.alert('Done', `${count} expired method(s) deactivated.`);
  }, [deactivateExpiredMethods]);

  return (
    <SafeAreaView style={styles.root} accessibilityRole="none">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close payment method manager"
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Global error banner */}
      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay} accessibilityLiveRegion="polite">
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      )}

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} alertCount={alerts.length} />

      {/* Tab content */}
      {activeTab === 'methods' && (
        <MethodsTab
          methods={paymentMethods}
          isLoading={isLoading}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onVerify={handleVerify}
          onSetPriority={handleSetPriority}
        />
      )}
      {activeTab === 'chains' && (
        <ChainsTab
          chains={fallbackChains}
          methods={paymentMethods}
          onCreateChain={handleCreateChain}
          onDeleteChain={deleteFallbackChain}
          onReorderChain={reorderFallbackChain}
        />
      )}
      {activeTab === 'analytics' && <AnalyticsTab analytics={analytics} />}
      {activeTab === 'alerts' && (
        <AlertsTab alerts={alerts} onDeactivateExpired={handleDeactivateExpired} />
      )}
    </SafeAreaView>
  );
};

export default PaymentMethodManager;

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    fontSize: 18,
    color: COLORS.muted,
  },
  errorBanner: {
    backgroundColor: COLORS.danger,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: COLORS.white,
    fontSize: 13,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  tabLabel: {
    fontSize: 13,
    color: COLORS.muted,
  },
  tabLabelActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
  },
  // Generic layout
  tabContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionAction: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  // Cards
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardInactive: {
    opacity: 0.55,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 1,
  },
  cardDetails: {
    gap: 2,
    marginBottom: 6,
  },
  cardDetail: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  cardDetailLabel: {
    fontWeight: '600',
    color: COLORS.muted,
  },
  expiryText: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnVerify: {
    borderColor: COLORS.warning,
  },
  actionBtnDanger: {
    borderColor: COLORS.danger,
  },
  actionBtnText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  // Priority row
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  priorityLabel: {
    fontSize: 11,
    color: COLORS.muted,
    marginRight: 2,
  },
  priorityBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  priorityBtnText: {
    fontSize: 11,
    color: COLORS.muted,
  },
  priorityBtnTextActive: {
    color: COLORS.white,
    fontWeight: '600',
  },
  // Pill
  pill: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillSmall: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pillTextSmall: {
    fontSize: 10,
  },
  // Forms
  form: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
  },
  segmentActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  segmentText: {
    fontSize: 12,
    color: COLORS.muted,
  },
  segmentTextActive: {
    color: COLORS.white,
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    justifyContent: 'flex-end',
  },
  formBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  formBtnCancel: {
    backgroundColor: COLORS.surfaceLight,
  },
  formBtnSubmit: {
    backgroundColor: COLORS.primary,
  },
  formBtnDisabled: {
    opacity: 0.5,
  },
  formBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyStateText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  emptyStateBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  emptyStateBtnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 14,
  },
  textMuted: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  // Chains
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    gap: 10,
    marginVertical: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  checkRowSelected: {
    backgroundColor: COLORS.surfaceLight,
    borderColor: COLORS.primary,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.muted,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkRowContent: {
    flex: 1,
  },
  checkRowLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  checkRowSub: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 1,
  },
  checkOrder: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    minWidth: 18,
    textAlign: 'right',
  },
  chainMethodRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginVertical: 3,
  },
  chainPosition: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primaryLight,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
    overflow: 'hidden',
  },
  chainMethodInfo: {
    flex: 1,
  },
  chainMethodLabel: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  chainMethodSub: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 1,
  },
  // Analytics
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  analyticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  failureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  failureReason: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  failureCount: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.danger,
  },
  // Alerts
  alertCard: {
    borderLeftWidth: 3,
  },
  deactivateBtn: {
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  deactivateBtnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 14,
  },
});
