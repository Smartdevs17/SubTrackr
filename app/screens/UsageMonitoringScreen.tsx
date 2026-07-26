import React, { useState } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet } from 'react-native';
import { useMeteringStore } from '../stores/meteringStore';

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 18, fontWeight: '700', marginVertical: 8 },
  label: { fontSize: 12, color: '#666', marginTop: 8 },
  input: { height: 40, borderColor: '#ccc', borderWidth: 1, paddingHorizontal: 8, borderRadius: 4, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  meter: { paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  metric: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, color: '#666' },
  alert: { color: '#b45309', fontWeight: '600' },
  total: { fontSize: 20, fontWeight: '800', marginTop: 8 },
});

export const UsageMonitoringScreen: React.FC<{ subscriptionId?: string }> = ({
  subscriptionId = 'sub_1',
}) => {
  const { registerMeter, recordUsage, calculateUsageCharge, getMeters } = useMeteringStore();
  const meters = useMeteringStore((s) => s.meters[subscriptionId]);
  const alerts = useMeteringStore((s) => s.alerts);
  const [metric, setMetric] = useState('api_calls');
  const [value, setValue] = useState('10');

  const meterList = getMeters(subscriptionId);
  const charge = calculateUsageCharge(subscriptionId, { start: 0, end: Number.MAX_SAFE_INTEGER });
  void meters; // subscribe to store updates so the list re-renders on ingest

  const ensureMeter = () => registerMeter(subscriptionId, metric, { unitPrice: 1, includedUnits: 0 });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Usage Monitoring</Text>

      <Text style={styles.label}>Metric</Text>
      <TextInput style={styles.input} autoCapitalize="none" value={metric} onChangeText={setMetric} />
      <Text style={styles.label}>Units to record</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={value} onChangeText={setValue} />
      <View style={styles.row}>
        <Button title="Register meter" onPress={ensureMeter} />
        <Button title="Record usage" onPress={() => recordUsage(subscriptionId, metric, Number(value) || 0)} />
      </View>

      <Text style={styles.total}>Current usage charge: {charge.total.toLocaleString()} {charge.currency}</Text>

      {alerts.length > 0 && (
        <Text style={styles.alert}>
          ⚠ {alerts.length} usage alert(s) triggered
        </Text>
      )}

      <Text style={styles.header}>Meters</Text>
      <FlatList
        data={meterList}
        keyExtractor={(m) => m.metric}
        renderItem={({ item }) => (
          <View style={styles.meter}>
            <Text style={styles.metric}>{item.metric}</Text>
            <Text style={styles.sub}>
              total {item.total} · {item.buckets.length} period(s) · {item.includedUnits} included ·{' '}
              {item.unitPrice}/unit
            </Text>
          </View>
        )}
      />
    </View>
  );
};

export default UsageMonitoringScreen;
