/**
 * mobile/src/screens/gift/index.ts
 *
 * Public barrel export for the gift-share flow screen, hooks, and logic.
 */

export { GiftShareScreen } from './GiftShareScreen';
export { useGiftShareFlow } from './hooks';
export type { UseGiftShareFlowOptions } from './hooks';
export {
  BASE_CLAIM_URL,
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_SAMPLE_SUBSCRIPTIONS,
  MAX_EXPIRY_DAYS,
  MAX_PERSONAL_MESSAGE_LENGTH,
  MIN_EXPIRY_DAYS,
  buildShareableUrl,
  calculateGiftExpiry,
  createMockGiftResult,
  detectRecipientType,
  generateGiftCode,
  validateEmail,
  validateGiftEligibility,
  validatePersonalMessage,
  validateRecipient,
  validateStellarAddress,
} from './giftShareLogic';
export type {
  GiftDeliveryMethod,
  GiftShareFormState,
  GiftShareLogger,
  GiftShareMetrics,
  GiftShareResult,
  GiftShareScreenProps,
  GiftShareStep,
  GiftableSubscription,
  RecipientType,
  SubscriptionStatus,
  UseGiftShareFlowReturn,
} from './types';
