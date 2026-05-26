import React, { useState } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet } from 'react-native';
import {
  useBatchStore,
  OperationType,
  estimateBatchGas,
} from '../stores/batchStore';

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 18, fontWeight: '700', marginVertical: 8 },
  label: { fontSize: 12, color: '#666', marginTop: 8 },
  input: {
    minHeight: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  meta: { fontSize: 12, color: '#444', marginVertical: 4 },
  item: { paddingVertical: 6, borderBottomWidth: 1, borderColor: '#eee' },
  success: { color: '#15803d' },
  failure: { color: '#b91c1c' },
});

const OPERATIONS: OperationType[] = ['charge', 'pause', 'resume', 'cancel', 'update', 'create'];

export const BatchOperationsScreen: React.FC = () => {
  const { draft, current, setDraft, loadFromCsv, createBatch, executeBatch, resetDraft } =
    useBatchStore();
  const [csv, setCsv] = useState('subscriptionId,amount\nsub_1,1000\nsub_2,1000');
  const [busy, setBusy] = useState(false);

  const onLoadCsv = () => loadFromCsv(csv, draft.operationType, draft.atomic);

  const onRun = async () => {
    const created = createBatch();
    if (!created) return;
    setBusy(true);
    await executeBatch();
    setBusy(false);
  };

  const gas = estimateBatchGas(draft.subscriptionIds.length);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Batch Operations</Text>

      <Text style={styles.label}>Operation type</Text>
      <View style={styles.row}>
        {OPERATIONS.map((op) => (
          <Text
            key={op}
            style={[styles.chip, draft.operationType === op && styles.chipActive]}
            onPress={() => setDraft({ operationType: op })}
          >
            {op}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>CSV template (subscriptionId,param per row)</Text>
      <TextInput
        style={[styles.input, { height: 90 }]}
        multiline
        value={csv}
        onChangeText={setCsv}
        autoCapitalize="none"
      />
      <Button title="Load from CSV" onPress={onLoadCsv} />

      <Text style={styles.meta}>
        {draft.subscriptionIds.length} subscription(s) · est. gas {gas.toLocaleString()} ·{' '}
        {draft.atomic ? 'atomic (all-or-nothing)' : 'non-atomic (partial allowed)'}
      </Text>
      <Button
        title={draft.atomic ? 'Switch to non-atomic' : 'Switch to atomic'}
        onPress={() => setDraft({ atomic: !draft.atomic })}
      />

      <View style={{ height: 8 }} />
      <Button title="Create & Execute Batch" onPress={onRun} disabled={busy || draft.subscriptionIds.length === 0} />
      <Button title="Reset" onPress={resetDraft} />

      {current && (
        <>
          <Text style={styles.header}>
            Status: {current.state} ({current.succeeded}/{current.total} ok, {current.failed} failed
            {current.rolledBack ? ', rolled back' : ''})
          </Text>
          <FlatList
            data={current.results}
            keyExtractor={(r) => r.subscriptionId}
            renderItem={({ item }) => (
              <View style={styles.item}>
                <Text style={item.success ? styles.success : styles.failure}>
                  {item.subscriptionId}: {item.success ? 'success' : `failed${item.message ? ` (${item.message})` : ''}`}
                </Text>
              </View>
            )}
          />
        </>
      )}
    </View>
  );
};

export default BatchOperationsScreen;
