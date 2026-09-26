import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFraudStore } from '../store/fraudStore';
import type { FraudDetection, FraudRiskLevel } from '../types/fraud';
import { useTheme } from '../theme/useTheme';

export default function FraudDetectionScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { detections, isLoading, error, loadDetections, updateDetectionStatus } = useFraudStore();
  const [filterLevel, setFilterLevel] = useState<FraudRiskLevel | 'all'>('all');

  useEffect(() => {
    loadDetections();
  }, []);

  const filteredDetections = detections.filter(
    d => filterLevel === 'all' || d.riskLevel === filterLevel
  );

  const getRiskColor = (level: FraudRiskLevel) => {
    switch (level) {
      case 'critical': return '#DC2626';
      case 'high': return '#EF4444';
      case 'medium': return '#F59E0B';
      case 'low': return '#10B981';
      default: return theme.colors.text;
    }
  };

  const handleReviewDetection = (detection: FraudDetection) => {
    Alert.alert(
      'Review Detection',
      'What is your assessment?',
      [
        {
          text: 'Confirmed Fraud',
          onPress: () => updateDetectionStatus(detection.id, 'confirmed', 'admin'),
        },
        {
          text: 'False Positive',
          onPress: () => updateDetectionStatus(detection.id, 'false_positive', 'admin'),
        },
        {
          text: 'Investigate',
          onPress: () => navigation.navigate('FraudInvestigation', { detectionId: detection.id }),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const renderDetectionItem = ({ item }: { item: FraudDetection }) => (
    <TouchableOpacity
      style={[styles.detectionCard, { backgroundColor: theme.colors.card }]}
      onPress={() => handleReviewDetection(item)}
    >
      <View style={styles.detectionHeader}>
        <Text style={[styles.transactionId, { color: theme.colors.text }]}>
          {item.transactionId.substring(0, 12)}...
        </Text>
        <View style={[styles.riskBadge, { backgroundColor: getRiskColor(item.riskLevel) + '20' }]}>
          <Text style={[styles.riskText, { color: getRiskColor(item.riskLevel) }]}>
            {item.riskLevel.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Risk Score:</Text>
        <Text style={[styles.scoreValue, { color: getRiskColor(item.riskLevel) }]}>
          {item.riskScore}/100
        </Text>
      </View>

      <View style={styles.indicatorsContainer}>
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
          Indicators ({item.indicators.length}):
        </Text>
        {item.indicators.slice(0, 2).map((ind, idx) => (
          <Text key={idx} style={[styles.indicator, { color: theme.colors.text }]}>
            • {ind.description}
          </Text>
        ))}
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
          {item.status.toUpperCase()}
        </Text>
        {item.isBlocked && (
          <Text style={[styles.blockedText, { color: '#DC2626' }]}>BLOCKED</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderFilters = () => {
    const filters: Array<FraudRiskLevel | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
    return (
      <View style={styles.filterContainer}>
        {filters.map(filter => (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterButton,
              { backgroundColor: theme.colors.card },
              filterLevel === filter && { backgroundColor: theme.colors.primary },
            ]}
            onPress={() => setFilterLevel(filter)}
          >
            <Text
              style={[
                styles.filterText,
                { color: theme.colors.text },
                filterLevel === filter && { color: '#FFFFFF' },
              ]}
            >
              {filter.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (isLoading && detections.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderFilters()}

      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Detections ({filteredDetections.length})
        </Text>
        <TouchableOpacity
          style={[styles.analyticsButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => navigation.navigate('FraudAnalytics')}
        >
          <Text style={styles.analyticsButtonText}>Analytics</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredDetections}
        renderItem={renderDetectionItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              No fraud detections found
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterContainer: { flexDirection: 'row', padding: 12, gap: 8 },
  filterButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  filterText: { fontSize: 12, fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: 'bold' },
  analyticsButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  analyticsButtonText: { color: '#FFFFFF', fontWeight: '600' },
  listContainer: { padding: 16 },
  detectionCard: { padding: 16, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  detectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  transactionId: { fontSize: 16, fontWeight: '600' },
  riskBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  riskText: { fontSize: 12, fontWeight: '700' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 14 },
  scoreValue: { fontSize: 18, fontWeight: 'bold' },
  indicatorsContainer: { marginBottom: 12 },
  indicator: { fontSize: 12, marginLeft: 8, marginTop: 4 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  statusText: { fontSize: 12, fontWeight: '600' },
  blockedText: { fontSize: 12, fontWeight: 'bold' },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 16 },
});
