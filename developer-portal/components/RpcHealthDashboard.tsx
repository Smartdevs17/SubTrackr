import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

// Mocking backend response for demonstration in frontend
interface RpcMetricsData {
  endpoint: string;
  latencyMs: number;
  errorCount: number;
  successCount: number;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastFailureTime: number | null;
}

export const RpcHealthDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<RpcMetricsData[]>([]);

  useEffect(() => {
    // In a real implementation, this would fetch from an API like /api/v1/monitoring/rpc
    // For now, we mock the data to demonstrate the UI
    const mockData: RpcMetricsData[] = [
      {
        endpoint: 'https://cloudflare-eth.com',
        latencyMs: 145,
        errorCount: 2,
        successCount: 15430,
        circuitState: 'CLOSED',
        lastFailureTime: null,
      },
      {
        endpoint: 'https://rpc.ankr.com/eth',
        latencyMs: 0,
        errorCount: 0,
        successCount: 0,
        circuitState: 'CLOSED',
        lastFailureTime: null,
      },
      {
        endpoint: 'https://polygon-rpc.com',
        latencyMs: 1205,
        errorCount: 5,
        successCount: 432,
        circuitState: 'OPEN',
        lastFailureTime: Date.now() - 5000,
      },
      {
        endpoint: 'https://rpc.ankr.com/polygon',
        latencyMs: 85,
        errorCount: 0,
        successCount: 12,
        circuitState: 'CLOSED',
        lastFailureTime: null,
      }
    ];
    setMetrics(mockData);

    const interval = setInterval(() => {
      // Simulate real-time updates
      setMetrics(prev => prev.map(m => {
        if (m.circuitState === 'CLOSED' && m.successCount > 0) {
          return { ...m, latencyMs: m.latencyMs + (Math.random() * 10 - 5), successCount: m.successCount + 1 };
        }
        return m;
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'CLOSED': return '#22C55E';
      case 'OPEN': return '#EF4444';
      case 'HALF_OPEN': return '#F59E0B';
      default: return '#6B7280';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>RPC Health Monitor</Text>
        <Text style={styles.subtitle}>Real-time circuit breaker status and latency</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.headerCell, { flex: 2 }]}>Endpoint</Text>
            <Text style={[styles.cell, styles.headerCell]}>Latency</Text>
            <Text style={[styles.cell, styles.headerCell]}>Errors</Text>
            <Text style={[styles.cell, styles.headerCell]}>Status</Text>
          </View>
          {metrics.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={[styles.cell, { flex: 2 }]} numberOfLines={1}>{item.endpoint}</Text>
              <Text style={styles.cell}>{Math.round(item.latencyMs)} ms</Text>
              <Text style={styles.cell}>{item.errorCount}</Text>
              <View style={[styles.cell, styles.statusContainer]}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.circuitState) }]} />
                <Text style={{ color: getStatusColor(item.circuitState), fontWeight: '600' }}>
                  {item.circuitState}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    marginTop: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  table: {
    minWidth: 600,
    paddingHorizontal: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
  },
  cell: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
  },
  headerCell: {
    fontWeight: '600',
    color: '#6B7280',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
});
