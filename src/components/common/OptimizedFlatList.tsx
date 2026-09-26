import React, { useCallback } from 'react';
import { FlatList, FlatListProps, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../../utils/constants';

const ITEM_HEIGHT = 84;

interface OptimizedFlatListProps<T> extends Omit<FlatListProps<T>, 'data' | 'renderItem'> {
  data: T[];
  renderItem: FlatListProps<T>['renderItem'];
  keyExtractor: FlatListProps<T>['keyExtractor'];
  emptyText?: string;
  emptyIcon?: string;
  loading?: boolean;
  estimatedItemSize?: number;
}

export function OptimizedFlatList<T>({
  data,
  renderItem,
  keyExtractor,
  emptyText = 'No items',
  emptyIcon = '📋',
  loading = false,
  estimatedItemSize = ITEM_HEIGHT,
  contentContainerStyle,
  ...rest
}: OptimizedFlatListProps<T>) {
  const initialNumToRender = 10;
  const maxToRenderPerBatch = 5;
  const windowSize = 10;

  const ListEmptyComponent = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>{emptyIcon}</Text>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    ),
    [emptyIcon, emptyText]
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={(_data: ArrayLike<T> | null | undefined, index: number) => ({
        length: estimatedItemSize,
        offset: estimatedItemSize * index,
        index,
      })}
      initialNumToRender={initialNumToRender}
      maxToRenderPerBatch={maxToRenderPerBatch}
      windowSize={windowSize}
      removeClippedSubviews={true}
      ListEmptyComponent={ListEmptyComponent}
      maintainVisibleContentPosition={{
        minIndexForVisible: 0,
      }}
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
