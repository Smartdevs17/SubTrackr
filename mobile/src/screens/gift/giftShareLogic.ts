/**
 * mobile/src/screens/gift/giftShareLogic.ts
 *
 * Deterministic business calculations, input validators, link builders,
 * and code generation for the subscription gift-sharing flow.
 */

import type {
  GiftableSubscription,
  GiftShareFormState,
  GiftShareResult,
  RecipientType,
} from './types';

export const MAX_PERSONAL_MESSAGE_LENGTH = 250;
export const DEFAULT_EXPIRY_DAYS = 7;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 30;
export const BASE_CLAIM_URL = 'https://subtrackr.app/gift/claim';

/**
 * Standard Stellar G-address validator (Public Key).
 * Stellar public keys start with 'G', are base32 encoded, and exactly 56 chars long.
 */
export const STELLAR_PUBKEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Standard RFC 5322 compliant simplified email validator.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

export function validateStellarAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return STELLAR_PUBKEY_REGEX.test(address.trim());
}

export function detectRecipientType(input: string): RecipientType {
  const clean = input.trim();
  if (clean.startsWith('G') && clean.length === 56) {
    return 'stellar_address';
  }
  return 'email';
}

export function validateRecipient(input: string): {
  isValid: boolean;
  type?: RecipientType;
  error?: string;
} {
  const clean = (input || '').trim();
  if (!clean) {
    return { isValid: false, error: 'Recipient address or email is required.' };
  }

  const type = detectRecipientType(clean);
  if (type === 'stellar_address') {
    if (validateStellarAddress(clean)) {
      return { isValid: true, type };
    }
    return {
      isValid: false,
      type,
      error: 'Invalid Stellar public address (must start with G and be 56 characters).',
    };
  }

  if (validateEmail(clean)) {
    return { isValid: true, type };
  }

  return {
    isValid: false,
    type,
    error: 'Please enter a valid email address or Stellar G-address.',
  };
}

export function validatePersonalMessage(
  message: string,
  maxChars = MAX_PERSONAL_MESSAGE_LENGTH
): { isValid: boolean; error?: string } {
  if (!message) return { isValid: true };
  if (message.length > maxChars) {
    return {
      isValid: false,
      error: `Personal message must not exceed ${maxChars} characters (${message.length}/${maxChars}).`,
    };
  }
  return { isValid: true };
}

export function validateGiftEligibility(subscription: GiftableSubscription): {
  isEligible: boolean;
  reason?: string;
} {
  if (subscription.isGiftable === false) {
    return {
      isEligible: false,
      reason: subscription.nonGiftableReason || 'Subscription is not eligible for transfer.',
    };
  }

  if (subscription.status === 'canceled') {
    return {
      isEligible: false,
      reason: 'Canceled subscriptions cannot be gifted.',
    };
  }

  if (subscription.status === 'paused') {
    return {
      isEligible: false,
      reason: 'Paused subscriptions must be resumed before gifting.',
    };
  }

  return { isEligible: true };
}

/**
 * Generates an uppercase alphanumeric claim code, formatted as PREFIX-XXXX-XXXX.
 */
export function generateGiftCode(prefix = 'SUB'): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude ambiguous 0/O, 1/I
  const randomSegment = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      const idx = Math.floor(Math.random() * chars.length);
      result += chars.charAt(idx);
    }
    return result;
  };
  return `${prefix}-${randomSegment(4)}-${randomSegment(4)}`;
}

export function buildShareableUrl(claimCode: string, baseUrl = BASE_CLAIM_URL): string {
  const encoded = encodeURIComponent(claimCode);
  return `${baseUrl}?code=${encoded}`;
}

export function calculateGiftExpiry(
  expiresInDays: number = DEFAULT_EXPIRY_DAYS,
  baseDate: Date = new Date()
): { createdAt: string; expiresAt: string } {
  const clampedDays = Math.max(MIN_EXPIRY_DAYS, Math.min(MAX_EXPIRY_DAYS, expiresInDays));
  const createdAt = baseDate.toISOString();
  const expiresDate = new Date(baseDate.getTime() + clampedDays * 24 * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();
  return { createdAt, expiresAt };
}

export function createMockGiftResult(
  formState: GiftShareFormState,
  subscription: GiftableSubscription
): GiftShareResult {
  const claimCode = generateGiftCode();
  const shareableUrl = buildShareableUrl(claimCode);
  const { createdAt, expiresAt } = calculateGiftExpiry(formState.expiresInDays);

  return {
    giftId: `gift_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    subscriptionId: subscription.id,
    subscriptionName: subscription.name,
    claimCode,
    shareableUrl,
    recipient: formState.recipientInput.trim(),
    recipientType: formState.recipientType,
    deliveryMethod: formState.deliveryMethod,
    personalMessage: formState.personalMessage.trim() || undefined,
    createdAt,
    expiresAt,
    status: 'pending',
  };
}

export const DEFAULT_SAMPLE_SUBSCRIPTIONS: GiftableSubscription[] = [
  {
    id: 'sub_netflix_4k',
    name: 'Netflix Premium (4K HDR)',
    planTier: 'pro',
    billingCycle: 'monthly',
    price: 22.99,
    currency: 'USD',
    renewalDate: '2026-12-15',
    status: 'active',
    isGiftable: true,
    category: 'Entertainment',
  },
  {
    id: 'sub_spotify_duo',
    name: 'Spotify Premium Duo',
    planTier: 'pro',
    billingCycle: 'monthly',
    price: 14.99,
    currency: 'USD',
    renewalDate: '2026-12-01',
    status: 'active',
    isGiftable: true,
    category: 'Music',
  },
  {
    id: 'sub_copilot_annual',
    name: 'GitHub Copilot Enterprise',
    planTier: 'enterprise',
    billingCycle: 'annual',
    price: 228.0,
    currency: 'USD',
    renewalDate: '2027-05-20',
    status: 'active',
    isGiftable: true,
    category: 'Developer Tools',
  },
  {
    id: 'sub_chatgpt_plus',
    name: 'ChatGPT Plus',
    planTier: 'pro',
    billingCycle: 'monthly',
    price: 20.0,
    currency: 'USD',
    renewalDate: '2026-11-28',
    status: 'active',
    isGiftable: true,
    category: 'Productivity',
  },
  {
    id: 'sub_gym_paused',
    name: 'Equinox All-Access Club',
    planTier: 'enterprise',
    billingCycle: 'monthly',
    price: 290.0,
    currency: 'USD',
    renewalDate: '2026-12-31',
    status: 'paused',
    isGiftable: false,
    nonGiftableReason: 'Paused subscriptions must be resumed before gifting.',
    category: 'Fitness',
  },
];
