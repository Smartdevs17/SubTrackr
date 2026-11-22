import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { areRowPropsEqual, subscriptionRowKey } from './keySelectors';
import type { SubscriptionRowData, SubscriptionRowProps } from './types';

const formatPrice = (price: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
};

const statusLabel = (subscription: SubscriptionRowData): string => {
  if (subscription.isPaused) return 'Paused';
  return subscription.isActive ? 'Active' : 'Inactive';
};

/**
 * Memoized subscription row. Re-renders only when a rendered field, the stable
 * key, or a callback actually changes — not when the parent passes a fresh
 * item object with identical content.
 */
export const SubscriptionRow: React.FC<SubscriptionRowProps> = React.memo(
  ({ subscription, onPress, onToggleStatus, index, testID, onRender }) => {
    const key = subscriptionRowKey(subscription, index);
    const status = statusLabel(subscription);
    const priceLabel = formatPrice(subscription.price, subscription.currency);

    useEffect(() => {
      if (onRender) onRender({ key, renderedAt: Date.now() });
    }, [key, onRender]);

    const handlePress = (): void => onPress(subscription);
    const handleToggle = (): void => {
      if (onToggleStatus) onToggleStatus(subscription.id);
    };

    return (
      <TouchableOpacity
        style={styles.container}
        onPress={handlePress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${subscription.name}, ${status}, ${priceLabel}`}
        testID={testID ?? `subscription-row-${key}`}>
        <View style={styles.content}>
          <Text style={styles.name} numberOfLines={1}>
            {subscription.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {subscription.category ?? 'other'} · {status}
          </Text>
        </View>
        <View style={styles.trailing}>
          <Text style={styles.price}>{priceLabel}</Text>
          {onToggleStatus ? (
            <TouchableOpacity
              style={styles.toggle}
              onPress={handleToggle}
              testID={`subscription-row-toggle-${key}`}>
              <Text style={styles.toggleText}>{status}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  },
  areRowPropsEqual
);

SubscriptionRow.displayName = 'SubscriptionRow';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  content: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  trailing: {
    alignItems: 'flex-end',
  },
  price: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  toggle: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  toggleText: {
    fontSize: 11,
    color: '#374151',
  },
});
