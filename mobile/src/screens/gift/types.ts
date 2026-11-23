/**
 * mobile/src/screens/gift/types.ts
 *
 * Domain contracts, state definitions, and telemetry interfaces for
 * the subscription gift-share flow.
 */

export type GiftShareStep = 'select' | 'recipient' | 'confirm' | 'processing' | 'success' | 'error';

export type RecipientType = 'email' | 'stellar_address';

export type GiftDeliveryMethod = 'share_link' | 'direct_email' | 'in_app';

export type SubscriptionStatus = 'active' | 'trialing' | 'paused' | 'canceled';

export interface GiftableSubscription {
  id: string;
  name: string;
  planTier: string;
  billingCycle: 'monthly' | 'annual';
  price: number;
  currency: string;
  renewalDate: string;
  status: SubscriptionStatus;
  isGiftable?: boolean;
  nonGiftableReason?: string;
  icon?: string;
  category?: string;
}

export interface GiftShareFormState {
  subscriptionId: string | null;
  recipientInput: string;
  recipientType: RecipientType;
  deliveryMethod: GiftDeliveryMethod;
  personalMessage: string;
  expiresInDays: number;
  allowSenderRevoke: boolean;
}

export interface GiftShareResult {
  giftId: string;
  subscriptionId: string;
  subscriptionName: string;
  claimCode: string;
  shareableUrl: string;
  recipient: string;
  recipientType: RecipientType;
  deliveryMethod: GiftDeliveryMethod;
  personalMessage?: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'claimed' | 'expired' | 'revoked';
}

export interface GiftShareMetrics {
  onView?: () => void;
  onSelectSubscription?: (subscriptionId: string) => void;
  onStepChange?: (fromStep: GiftShareStep, toStep: GiftShareStep) => void;
  onGiftShareStart?: (payload: {
    subscriptionId: string;
    recipientType: RecipientType;
    deliveryMethod: GiftDeliveryMethod;
  }) => void;
  onGiftShareSuccess?: (result: GiftShareResult) => void;
  onGiftShareFailure?: (error: string) => void;
  onCopyLink?: (giftId: string) => void;
  onShareLink?: (giftId: string) => void;
  onReset?: () => void;
}

export interface GiftShareLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface GiftShareScreenProps {
  subscriptions?: GiftableSubscription[];
  initialSubscriptionId?: string;
  onSendGift?: (formState: GiftShareFormState) => Promise<GiftShareResult>;
  onBack?: () => void;
  metrics?: GiftShareMetrics;
  logger?: GiftShareLogger;
  testID?: string;
}
