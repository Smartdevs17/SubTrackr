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
  onRetry?: () => void;
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

export interface UseGiftShareFlowReturn {
  step: GiftShareStep;
  subscriptions: GiftableSubscription[];
  selectedSubscription: GiftableSubscription | null;
  selectedSubId: string | null;
  recipientInput: string;
  setRecipientInput: (val: string) => void;
  deliveryMethod: GiftDeliveryMethod;
  setDeliveryMethod: (val: GiftDeliveryMethod) => void;
  personalMessage: string;
  setPersonalMessage: (val: string) => void;
  expiresInDays: number;
  setExpiresInDays: (val: number) => void;
  allowSenderRevoke: boolean;
  setAllowSenderRevoke: (val: boolean) => void;
  recipientValidation: { isValid: boolean; type?: RecipientType; error?: string };
  messageValidation: { isValid: boolean; error?: string };
  formState: GiftShareFormState;
  error: string | null;
  setError: (err: string | null) => void;
  giftResult: GiftShareResult | null;
  isCopied: boolean;
  handleSelectSubscription: (subId: string) => void;
  handleProceed: () => Promise<void>;
  handleRetry: () => Promise<void>;
  handleEditDetails: () => void;
  handleBack: () => void;
  handleCopyLink: () => Promise<void>;
  handleShareLink: () => Promise<void>;
  handleReset: () => void;
}
