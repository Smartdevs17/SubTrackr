import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useSegmentStore } from '../store/segmentStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useUserStore } from '../store/userStore';
import { segmentService } from '../services/segmentService';
import { useTheme } from '../theme/useTheme';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { SegmentOverlapAnalysis } from '../components/segments/SegmentOverlapAnalysis';
import { useNavigation } from '@react-navigation/native';

export const SegmentManagementScreen: React.FC = () => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { segments, deleteSegment } = useSegmentStore();
  const { subscriptions } = useSubscriptionStore();
  const { user } = useUserStore();

  const subscriberData = useMemo(() => {
    if (!user) return [];
    return [segmentService.mapSubscriberData(user, subscriptions)];
  }, [user, subscriptions]);

  const overlaps = useMemo(() => {
    return segmentService.calculateOverlap(segments, subscriberData);
  }, [segments, subscriberData]);

  const renderSegmentItem = ({ item }: { item: any }) => (
    <Card style={styles.segmentCard}>
      <TouchableOpacity
        onPress={() => navigation.navigate('SegmentDetail', { segmentId: item.id })}>
        <View style={styles.segmentHeader}>
          <Text style={[styles.segmentName, { color: theme.colors.text }]}>{item.name}</Text>
          <View style={[styles.logicBadge, { backgroundColor: theme.colors.accent }]}>
            <Text style={styles.logicBadgeText}>{item.logic}</Text>
          </View>
        </View>
        <Text style={[styles.segmentDesc, { color: theme.colors.textSecondary }]} numberOfLines={1}>
          {item.description || 'No description'}
        </Text>
        <View style={styles.segmentFooter}>
          <Text style={{ color: theme.colors.primary }}>{item.criteria.length} Rules</Text>
          <TouchableOpacity onPress={() => deleteSegment(item.id)}>
            <Text style={{ color: theme.colors.error }}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Card>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={segments}
        keyExtractor={(item) => item.id}
        renderItem={renderSegmentItem}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.colors.text }]}>Segments</Text>
              <Button
                title="+ New Segment"
                onPress={() => navigation.navigate('SegmentDetail', { segmentId: 'new' })}
                variant="primary"
              />
            </View>
            <SegmentOverlapAnalysis segments={segments} overlaps={overlaps} />
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: theme.colors.textSecondary }}>No segments created yet.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  segmentCard: {
    marginBottom: 12,
    padding: 16,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  segmentName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  logicBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logicBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  segmentDesc: {
    fontSize: 14,
    marginBottom: 12,
  },
  segmentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
});
