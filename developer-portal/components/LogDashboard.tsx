import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { logStorage, LogEntry, LogSearchQuery } from '../../backend/elasticsearch/logStorage';

export const LogDashboard: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [correlationId, setCorrelationId] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const query: LogSearchQuery = { limit: 50 };
      if (searchTerm) query.searchTerm = searchTerm;
      if (correlationId) query.correlationId = correlationId;

      const result = await logStorage.searchLogs(query);
      setLogs(result.data);
    } catch (e) {
      console.error('Failed to fetch logs', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const renderLog = ({ item }: { item: LogEntry }) => (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <Text
          style={[styles.logLevel, item.level === 'error' ? styles.levelError : styles.levelInfo]}>
          {item.level.toUpperCase()}
        </Text>
        <Text style={styles.logTimestamp}>{new Date(item.timestamp).toLocaleString()}</Text>
      </View>
      <Text style={styles.logMessage}>{item.message}</Text>
      {item.correlationId && (
        <Text style={styles.logCorrelation}>Correlation ID: {item.correlationId}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log Analytics Dashboard</Text>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.input}
          placeholder="Search logs..."
          value={searchTerm}
          onChangeText={setSearchTerm}
        />
        <TextInput
          style={styles.input}
          placeholder="Filter by Correlation ID..."
          value={correlationId}
          onChangeText={setCorrelationId}
        />
        <TouchableOpacity style={styles.searchButton} onPress={fetchLogs}>
          <Text style={styles.searchButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={logs}
          renderItem={renderLog}
          keyExtractor={(item) => item.id || item.timestamp + Math.random()}
          ListEmptyComponent={<Text style={styles.emptyText}>No logs found.</Text>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    padding: 10,
    borderRadius: 6,
    marginRight: 10,
    marginBottom: 10,
    flex: 1,
    minWidth: 200,
  },
  searchButton: {
    backgroundColor: '#3B82F6',
    padding: 12,
    borderRadius: 6,
    justifyContent: 'center',
    marginBottom: 10,
  },
  searchButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  logCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  logLevel: {
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 12,
  },
  levelError: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
  },
  levelInfo: {
    backgroundColor: '#DBEAFE',
    color: '#2563EB',
  },
  logTimestamp: {
    color: '#6B7280',
    fontSize: 12,
  },
  logMessage: {
    fontSize: 14,
    color: '#374151',
  },
  logCorrelation: {
    marginTop: 8,
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'monospace',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7280',
    marginTop: 20,
  },
});
