import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { useCreditStore, type AccountCredit, type CreditLot } from '../stores/creditStore';

type Tab = 'balance' | 'analytics' | 'history' | 'wallets';

const colorScheme = {
  bg: '#f7fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  primary: '#1d4ed8',
  credit: '#15803d',
  debit: '#b91c1c',
  warning: '#c2410c',
  text: '#0f172a',
  textMuted: '#475569',
};

const currency = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 0 });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScheme.bg },
  scrollContent: { padding: 16, gap: 12 },
  heroCard: {
    backgroundColor: colorScheme.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colorScheme.border,
  },
  heroLabel: { color: colorScheme.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  heroBalance: { color: colorScheme.text, fontSize: 36, fontWeight: '800', marginTop: 4 },
  heroSub: { color: colorScheme.textMuted, fontSize: 13, marginTop: 6 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colorScheme.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colorScheme.border,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colorScheme.primary, borderColor: colorScheme.primary },
  tabLabel: { color: colorScheme.text, fontWeight: '600' },
  tabLabelActive: { color: '#fff' },
  card: {
    backgroundColor: colorScheme.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colorScheme.border,
    gap: 12,
  },
  cardTitle: { fontWeight: '700', fontSize: 16, color: colorScheme.text },
  cardSubtitle: { color: colorScheme.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderColor: colorScheme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colorScheme.text,
    backgroundColor: '#fff',
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colorScheme.primary,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontWeight: '600' },
  buttonGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colorScheme.border,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonGhostLabel: { color: colorScheme.text, fontWeight: '600' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colorScheme.border,
  },
  itemAmount: { fontWeight: '600' },
  credit: { color: colorScheme.credit },
  debit: { color: colorScheme.debit },
  muted: { color: colorScheme.textMuted },
  expiryPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: {
    flexBasis: '48%',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colorScheme.border,
    padding: 12,
  },
  statLabel: { color: colorScheme.textMuted, fontSize: 12 },
  statValue: { color: colorScheme.text, fontSize: 18, fontWeight: '700', marginTop: 2 },
  chartBar: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  chartFill: {
    height: '100%',
    backgroundColor: colorScheme.primary,
  },
});

const BucketBar: React.FC<{ label: string; value: number; total: number; tone?: 'pos' | 'neg' | 'mute' }> = ({
  label,
  value,
  total,
  tone = 'pos',
}) => {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const fill =
    tone === 'neg' ? colorScheme.debit : tone === 'mute' ? colorScheme.textMuted : colorScheme.primary;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.muted}>{label}</Text>
        <Text style={styles.muted}>{currency(value)}</Text>
      </View>
      <View style={styles.chartBar}>
        <View style={[styles.chartFill, { width: `${pct}%`, backgroundColor: fill }]} />
      </View>
    </View>
  );
};

const AnalyticsPanel: React.FC<{ account: AccountCredit }> = ({ account }) => {
  const issued = useMemo(
    () =>
      account.transactions
        .filter((t) => t.kind === 'issue')
        .reduce((s, t) => s + t.amount, 0),
    [account.transactions]
  );
  const applied = useMemo(
    () =>
      account.transactions
        .filter((t) => t.kind === 'apply')
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [account.transactions]
  );
  const transferIn = useMemo(
    () =>
      account.transactions
        .filter((t) => t.kind === 'transfer_in')
        .reduce((s, t) => s + t.amount, 0),
    [account.transactions]
  );
  const transferOut = useMemo(
    () =>
      account.transactions
        .filter((t) => t.kind === 'transfer_out')
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [account.transactions]
  );
  const expired = useMemo(
    () =>
      account.transactions
        .filter((t) => t.kind === 'expire')
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [account.transactions]
  );

  const consumptionRate = issued > 0 ? Math.round((applied / issued) * 100) : 0;
  const channelTotal = issued + transferIn;

  const expiryBuckets = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const buckets = { within_7d: 0, within_30d: 0, beyond_30d: 0, no_expiry: 0 };
    for (const lot of account.lots) {
      if (lot.remaining <= 0) continue;
      if (!lot.expiresAt) {
        buckets.no_expiry += lot.remaining;
        continue;
      }
      const secToExpiry = lot.expiresAt - nowSec;
      if (secToExpiry <= 7 * 86_400) buckets.within_7d += lot.remaining;
      else if (secToExpiry <= 30 * 86_400) buckets.within_30d += lot.remaining;
      else buckets.beyond_30d += lot.remaining;
    }
    return buckets;
  }, [account.lots]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Credit analytics</Text>
      <Text style={styles.cardSubtitle}>Roll-up of lifetime issuance, application and expiry</Text>

      <View style={styles.statGrid}>
        <View style={styles.statTile}>
          <Text style={styles.statLabel}>Consumption rate</Text>
          <Text style={styles.statValue}>{consumptionRate}%</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statLabel}>Outstanding lots</Text>
          <Text style={styles.statValue}>{account.lots.filter((l) => l.remaining > 0).length}</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statLabel}>Outstanding balance</Text>
          <Text style={styles.statValue}>{currency(account.balance)}</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statLabel}>Available (unexpired)</Text>
          <Text style={[styles.statValue, { color: colorScheme.credit }]}>
            {currency(account.lots.reduce((s, l) => s + l.remaining, 0))}
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.cardTitle}>Channel mix</Text>
        <BucketBar label="Issuance" value={issued} total={channelTotal} />
        <BucketBar label="Transfers in" value={transferIn} total={channelTotal} />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.cardTitle}>Ledger flow</Text>
        <BucketBar label="Applied" value={applied} total={issued + transferIn || 1} tone="pos" />
        <BucketBar label="Transferred out" value={transferOut} total={issued + transferIn || 1} tone="mute" />
        <BucketBar label="Expired" value={expired} total={issued + transferIn || 1} tone="neg" />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.cardTitle}>Expiry forecast (outstanding lots)</Text>
        <BucketBar
          label="Within 7 days"
          value={expiryBuckets.within_7d}
          total={Math.max(1, expiryBuckets.within_7d + expiryBuckets.within_30d + expiryBuckets.beyond_30d + expiryBuckets.no_expiry)}
          tone="neg"
        />
        <BucketBar label="Within 30 days" value={expiryBuckets.within_30d} total={Math.max(1, expiryBuckets.within_7d + expiryBuckets.within_30d + expiryBuckets.beyond_30d + expiryBuckets.no_expiry)} tone="mute" />
        <BucketBar label="Beyond 30 days" value={expiryBuckets.beyond_30d} total={Math.max(1, expiryBuckets.within_7d + expiryBuckets.within_30d + expiryBuckets.beyond_30d + expiryBuckets.no_expiry)} />
        <BucketBar label="Never expires" value={expiryBuckets.no_expiry} total={Math.max(1, expiryBuckets.within_7d + expiryBuckets.within_30d + expiryBuckets.beyond_30d + expiryBuckets.no_expiry)} />
      </View>
    </View>
  );
};

const HistoryPanel: React.FC<{ account: AccountCredit }> = ({ account }) => {
  const entries = useMemo(
    () => [...account.transactions].sort((a, b) => b.timestamp - a.timestamp),
    [account.transactions]
  );
  if (entries.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Transaction history</Text>
        <Text style={styles.muted}>No credit activity yet.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Transaction history</Text>
      <Text style={styles.cardSubtitle}>Full audit trail — every issuance, application, transfer and expiry</Text>
      <FlatList
        scrollEnabled={false}
        data={entries}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.muted}>{item.reason}</Text>
              <Text style={styles.muted}>
                {new Date(item.timestamp * 1000).toLocaleString()} ·{' '}
                <Text style={styles[item.amount >= 0 ? 'credit' : 'debit']}>{item.kind}</Text>
              </Text>
            </View>
            <Text style={[styles.itemAmount, item.amount >= 0 ? styles.credit : styles.debit]}>
              {item.amount >= 0 ? '+' : ''}
              {currency(item.amount)}
            </Text>
          </View>
        )}
      />
    </View>
  );
};

const LotsPanel: React.FC<{ lots: CreditLot[] }> = ({ lots }) => {
  if (lots.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Credit lots</Text>
        <Text style={styles.muted}>No credit lots yet.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Credit lots</Text>
      <Text style={styles.cardSubtitle}>Each lot is consumed oldest-first</Text>
      {lots.map((lot) => {
        const issuedAt = new Date(lot.issuedAt * 1000).toLocaleDateString();
        const expiresAt = lot.expiresAt ? new Date(lot.expiresAt * 1000).toLocaleDateString() : '—';
        const expired = lot.expiresAt !== undefined && lot.expiresAt * 1000 <= Date.now();
        return (
          <View key={lot.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorScheme.text, fontWeight: '600' }}>Lot #{lot.id}</Text>
              <Text style={styles.muted}>Issued {issuedAt} · Expires {expiresAt}</Text>
              <View style={[styles.expiryPill, { backgroundColor: expired ? '#fee2e2' : '#ecfdf5' }]}>
                <Text style={{ color: expired ? colorScheme.debit : colorScheme.credit, fontWeight: '600' }}>
                  {expired ? 'expired' : 'active'}
                </Text>
              </View>
            </View>
            <Text style={styles.itemAmount}>{currency(lot.remaining)}</Text>
          </View>
        );
      })}
    </View>
  );
};

export interface CreditBalanceScreenProps {
  subscriber?: string;
  /** Pre-supplied analytics callbacks so the screen stays backend-agnostic. */
  onExportReport?: (format: 'csv' | 'json') => void;
}

export const CreditBalanceScreen: React.FC<CreditBalanceScreenProps> = ({
  subscriber = 'me',
  onExportReport,
}) => {
  const {
    issueCredit,
    setExpirationPolicy,
    applyCredit,
    transferCredit,
    expireCredits,
    getAccount,
    getBalance,
  } = useCreditStore();
  const account = getAccount(subscriber);
  const available = getBalance(subscriber);

  const [tab, setTab] = useState<Tab>('balance');
  const [amount, setAmount] = useState('100');
  const [due, setDue] = useState('50');
  const [recipient, setRecipient] = useState('bob');
  const [policyDays, setPolicyDays] = useState('30');

  const onIssue = () => {
    const v = Number(amount) || 0;
    if (v <= 0) {
      Alert.alert('Enter a positive amount');
      return;
    }
    issueCredit(subscriber, v, 'manual_grant');
  };

  const onApply = () => {
    const v = Number(due) || 0;
    if (v < 0) return;
    applyCredit(subscriber, 'sub_1', v);
  };

  const onTransfer = () => {
    const v = Number(amount) || 0;
    const to = recipient.trim();
    if (v <= 0 || !to) {
      Alert.alert('Enter a recipient and a positive amount');
      return;
    }
    const ok = transferCredit(subscriber, to, v, 'gift');
    if (!ok) Alert.alert('Transfer failed — insufficient balance');
  };

  const onExpire = () => {
    const expired = expireCredits(subscriber);
    Alert.alert('Expire', `Expired ${currency(expired)} of credit`);
  };

  const onSetPolicy = () => {
    const days = Number(policyDays) || 0;
    if (days <= 0) return;
    setExpirationPolicy(subscriber, { kind: 'after_secs', seconds: days * 86_400 });
    Alert.alert('Policy updated', `New credit will expire in ${days} days`);
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'balance', label: 'Balance' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'history', label: 'History' },
    { key: 'wallets', label: 'Lots' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Account credit</Text>
        <Text style={styles.heroBalance}>{currency(available)}</Text>
        <Text style={styles.heroSub}>
          Available · {currency(account.balance)} lifetime · {account.transactions.length} ledger entries
        </Text>
      </View>

      {onExportReport ? (
        <View style={styles.row}>
          <Pressable style={styles.buttonGhost} onPress={() => onExportReport('csv')}>
            <Text style={styles.buttonGhostLabel}>Export CSV</Text>
          </Pressable>
          <Pressable style={styles.buttonGhost} onPress={() => onExportReport('json')}>
            <Text style={styles.buttonGhostLabel}>Export JSON</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.tabRow}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.key }}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'balance' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Issue credit</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Pressable style={styles.button} onPress={onIssue}>
                <Text style={styles.buttonLabel}>Issue</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Apply to a charge</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={due}
                onChangeText={setDue}
              />
              <Pressable style={styles.button} onPress={onApply}>
                <Text style={styles.buttonLabel}>Apply</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transfer to another account</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                placeholder="Recipient"
                value={recipient}
                onChangeText={setRecipient}
              />
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Pressable style={styles.button} onPress={onTransfer}>
                <Text style={styles.buttonLabel}>Transfer</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Expiration policy</Text>
            <Text style={styles.cardSubtitle}>
              New lots will auto-expire after this many days
            </Text>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={policyDays}
                onChangeText={setPolicyDays}
              />
              <Pressable style={styles.button} onPress={onSetPolicy}>
                <Text style={styles.buttonLabel}>Save</Text>
              </Pressable>
            </View>
            <Pressable style={styles.buttonGhost} onPress={onExpire}>
              <Text style={styles.buttonGhostLabel}>Run expiry now</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {tab === 'analytics' ? <AnalyticsPanel account={account} /> : null}
      {tab === 'history' ? <HistoryPanel account={account} /> : null}
      {tab === 'wallets' ? <LotsPanel lots={account.lots} /> : null}
    </ScrollView>
  );
};

export default CreditBalanceScreen;
