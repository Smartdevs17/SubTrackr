import React from 'react';
import { Subscription } from '../../types/subscription';
import { SubscriptionCard, SubscriptionCardProps } from '../subscription/SubscriptionCard';

interface SubscriptionListItemProps extends SubscriptionCardProps {
  subscription: Subscription;
  onPress: (subscription: Subscription) => void;
  onToggleStatus?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const areEqual = (prev: SubscriptionListItemProps, next: SubscriptionListItemProps): boolean => {
  const p = prev.subscription;
  const n = next.subscription;
  return (
    p.id === n.id &&
    p.name === n.name &&
    p.price === n.price &&
    p.isActive === n.isActive &&
    p.category === n.category &&
    p.billingCycle === n.billingCycle &&
    p.nextBillingDate === n.nextBillingDate &&
    p.currency === n.currency &&
    p.isCryptoEnabled === n.isCryptoEnabled &&
    p.description === n.description
  );
};

export const SubscriptionListItem = React.memo(
  ({ subscription, onPress, onToggleStatus, onDelete }: SubscriptionListItemProps) => (
    <SubscriptionCard
      subscription={subscription}
      onPress={onPress}
      onToggleStatus={onToggleStatus}
      onDelete={onDelete}
    />
  ),
  areEqual
);
