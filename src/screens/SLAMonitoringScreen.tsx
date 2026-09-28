import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSLAStore } from '../store/slaStore';
import { useTheme } from '../theme/useTheme';
import type { SLATracking, SLAStatus } from '../types/sla';

export default function SLAMonitoringScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { trackings, breaches, isLoading, loadTrackings, loadBreaches, loadDashboard, dashboard } = useSLAStore();
  const [filterStatus, setFilterStatus] = useState<SLAStatus | 'all'>('all');

  useEffect(() => {
    loadTrackings();
    loadBreaches();
    loadDashboard();
  }, []);

  const filteredTrackings = trackings.filter(t => filterStatus === 'all' || t.status === filterStatus);

  const getStatusColor = (status: SLAStatus) => {
    switch (status) {
      case 'compliant': return '#10B981';
      case 'at_risk': return '#F59E0B';
      case 'breached': return '#EF4444';
      case 'critical': return '#DC2626';
      default: return theme.colors.text;
    }
  };

  const renderTracking = ({ item }: { item: SLATracking }) => (
    <TouchableOpacity style={[styles.card, { backgroundColor: theme.colors.card }]} onPress={() => navigation.navigate('SLADetail', { id: item.id })}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Subscription: {item.subscriptionId.substring(0, 12)}...</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metricRow}>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Compliance:</Text>
          <Text style={[styles.value, { color: getStatusColor(item.status) }]}>{item.compliancePercentage.toFixed(1)}%</Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Breaches:</Text>
          <Text style={[styles.value, { color: item.breachCount > 0 ? '#EF4444' : theme.colors.text }]}>{item.breachCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (isLoading && !dashboard) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {dashboard && (
        <View style={[styles.overview, { backgroundColor: theme.colors.card }]}>
          <Text style={[styles.overviewTitle, { color: theme.colors.text }]}>SLA Overview</Text>
          <View style={styles.overviewGrid}>
            <View style={styles.overviewItem}>
              <Text style={[styles.overviewValue, { color: '#10B981' }]}>{dashboard.overview.compliantPercentage.toFixed(1)}%</Text>
              <Text style={[styles.overviewLabel, { color: theme.colors.textSecondary }]}>Compliant</Text>
            </View>
            <View style={styles.overviewItem}>
              <Text style={[styles.overviewValue, { color: '#EF4444' }]}>{dashboard.overview.activeBreaches}</Text>
              <Text style={[styles.overviewLabel, { color: theme.colors.textSecondary }]}>Active Breaches</Text>
            </View>
            <View style={styles.overviewItem}>
              <Text style={[styles.overviewValue, { color: theme.colors.primary }]}>${dashboard.overview.creditsIssued.toFixed(2)}</Text>
              <Text style={[styles.overviewLabel, { color: theme.colors.textSecondary }]}>Credits Issued</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.filterContainer}>
        {(['all', 'compliant', 'at_risk', 'breached', 'critical'] as const).map(filter => (
          <TouchableOpacity
            key={filter}
            style={[styles.filterButton, { backgroundColor: theme.colors.card }, filterStatus === filter && { backgroundColor: theme.colors.primary }]}
            onPress={() => setFilterStatus(filter)}
          >
            <Text style={[styles.filterText, { color: theme.colors.text }, filterStatus === filter && { color: '#FFFFFF' }]}>
              {filter.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredTrackings}
        renderItem={renderTracking}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No SLA trackings found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overview: { padding: 16, margin: 16, borderRadius: 12 },
  overviewTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  overviewGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  overviewItem: { alignItems: 'center' },
  overviewValue: { fontSize: 24, fontWeight: 'bold' },
  overviewLabel: { fontSize: 12, marginTop: 4 },
  filterContainer: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap' },
  filterButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  filterText: { fontSize: 11, fontWeight: '600' },
  list: { padding: 16 },
  card: { padding: 16, borderRadius: 12, marginBottom: 12, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: 'bold' },
  metrics: { gap: 8 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 16 },
});
