import React, { useState } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet } from 'react-native';
import { useCreditStore, CreditTransaction } from '../stores/creditStore';

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 18, fontWeight: '700', marginVertical: 8 },
  balance: { fontSize: 32, fontWeight: '800', color: '#15803d' },
  label: { fontSize: 12, color: '#666', marginTop: 8 },
  input: { height: 40, borderColor: '#ccc', borderWidth: 1, paddingHorizontal: 8, borderRadius: 4, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  item: { paddingVertical: 6, borderBottomWidth: 1, borderColor: '#eee' },
  credit: { color: '#15803d' },
  debit: { color: '#b91c1c' },
});

const sign = (tx: CreditTransaction) => (tx.amount >= 0 ? styles.credit : styles.debit);

export const CreditBalanceScreen: React.FC<{ subscriber?: string }> = ({ subscriber = 'me' }) => {
  const { issueCredit, applyCredit, expireCredits, getBalance, getAccount } = useCreditStore();
  const [amount, setAmount] = useState('100');
  const [due, setDue] = useState('50');
  // Read from store on each render so issuing/applying refreshes the figures.
  const balance = useCreditStore((s) => s.accounts[subscriber]?.balance ?? 0);
  void balance; // stored balance; available balance shown below accounts for expiry

  const available = getBalance(subscriber);
  const account = getAccount(subscriber);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Account Credit</Text>
      <Text style={styles.balance}>{available.toLocaleString()}</Text>
      <Text style={styles.label}>Available credit (excludes expired)</Text>

      <Text style={styles.label}>Issue credit</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} />
      <Button
        title="Issue Credit"
        onPress={() => issueCredit(subscriber, Number(amount) || 0, 'manual_grant')}
      />

      <Text style={styles.label}>Apply credit to a charge</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={due} onChangeText={setDue} />
      <View style={styles.row}>
        <Button title="Apply" onPress={() => applyCredit(subscriber, 'sub_1', Number(due) || 0)} />
        <Button title="Expire now" onPress={() => expireCredits(subscriber)} />
      </View>

      <Text style={styles.header}>History</Text>
      <FlatList
        data={[...account.transactions].reverse()}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={sign(item)}>
              {item.kind} {item.amount >= 0 ? '+' : ''}
              {item.amount} · {item.reason}
            </Text>
          </View>
        )}
      />
    </View>
  );
};

export default CreditBalanceScreen;
