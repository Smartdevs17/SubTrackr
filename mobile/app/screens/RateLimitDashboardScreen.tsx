import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function RateLimitDashboardScreen() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/rate-limits/anomalies')
      .then((r) => r.json())
      .then((d) => setItems(d.data ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Rate Limit Anomalies</Text>

        {items.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.heading}>{item.apiKey}</Text>
            <Text>Score: {item.score}</Text>
            <Text>Severity: {item.severity}</Text>
            <Text>Throttle: {item.adaptiveThrottleLevel}</Text>
            <Text>Suggested action: {item.suggestedAction}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  card: { backgroundColor: '#1C1C1E', padding: 16, borderRadius: 12 },
  heading: { color: '#fff', fontWeight: '700' },
});
