/**
 * Virtualised subscription list (Issue #2075).
 *
 * FlashList mounts only the visible window plus a small draw distance, so
 * lists with thousands of rows keep a stable frame rate. Row identity and
 * prop equality come from the memoised row module in `./row`.
 */

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { resolveFlashListTuning } from './flashListConfig';
import { toSubscriptionRows } from './mapRows';
import { createKeyExtractor, SubscriptionRow, useStableRowKeySelector } from './row';
import type { RowRenderMetrics, SubscriptionRowData } from './row';
import type { SubscriptionFlashListProps } from './types';

interface ViewableItem {
  index?: number | null;
}

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50, minimumViewTime: 100 };

export const SubscriptionFlashList: React.FC<SubscriptionFlashListProps> = ({
  subscriptions,
  loading = false,
  error = null,
  onPress,
  onToggleStatus,
  onRefresh,
  tuningOverrides,
  metrics,
  testID = 'subscription-flash-list',
}) => {
  const rows = useMemo(() => toSubscriptionRows(subscriptions), [subscriptions]);
  const tuning = useMemo(
    () => resolveFlashListTuning(rows.length, tuningOverrides),
    [rows.length, tuningOverrides],
  );
  const keySelector = useStableRowKeySelector();
  const keyExtractor = useMemo(() => createKeyExtractor(keySelector), [keySelector]);
  const onRowRender = metrics?.onRowRender;
  const onVisibleRows = metrics?.onVisibleRows;

  const renderItem = useCallback(
    ({ item, index }: { item: SubscriptionRowData; index: number }) => (
      <SubscriptionRow
        subscription={item}
        index={index}
        onPress={() => {
          const source = subscriptions[index];
          if (source) onPress(source);
        }}
        onToggleStatus={onToggleStatus}
        onRender={(renderMetrics: RowRenderMetrics) => onRowRender?.(renderMetrics)}
      />
    ),
    [subscriptions, onPress, onToggleStatus, onRowRender],
  );

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: readonly ViewableItem[] }) => {
      const indices = viewableItems
        .map((item) => item.index)
        .filter((index): index is number => typeof index === 'number');
      onVisibleRows?.({ count: indices.length, indices });
    },
    [onVisibleRows],
  );

  const emptyComponent = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.state} testID="subscription-list-loading">
          <ActivityIndicator accessibilityLabel="Loading subscriptions" />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.state} testID="subscription-list-error">
          <Text style={styles.stateText}>{error}</Text>
          {onRefresh ? (
            <TouchableOpacity onPress={onRefresh} testID="subscription-list-retry">
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.state} testID="subscription-list-empty">
        <Text style={styles.stateText}>No subscriptions yet</Text>
      </View>
    );
  }, [loading, error, onRefresh]);

  return (
    <FlashList
      testID={testID}
      accessibilityLabel="Subscription list"
      data={rows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      estimatedItemSize={tuning.estimatedItemSize}
      drawDistance={tuning.drawDistance}
      windowSize={tuning.windowSize}
      removeClippedSubviews={tuning.removeClippedSubviews}
      onViewableItemsChanged={handleViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      ListEmptyComponent={emptyComponent}
      refreshing={loading}
      onRefresh={onRefresh}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  state: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  stateText: { color: '#6b7280', fontSize: 14 },
  retryText: { color: '#2563eb', fontSize: 14, fontWeight: '600', marginTop: 12 },
});
