/**
 * mobile/src/screens/gift/__tests__/hooks.test.ts
 *
 * Pure TypeScript unit tests for `useGiftShareFlow` state machine,
 * input validation, step progression, error recovery, clipboard, native share,
 * and observability integration.
 */

import { renderHook, act } from '@testing-library/react-hooks';
import { useGiftShareFlow } from '../hooks';
import { DEFAULT_SAMPLE_SUBSCRIPTIONS } from '../giftShareLogic';
import type { GiftShareMetrics, GiftShareResult } from '../types';

beforeAll(() => {
  (global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Mock react-native Share
jest.mock('react-native', () => ({
  Share: {
    share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  },
}));

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

describe('useGiftShareFlow hook', () => {
  const metrics: Required<GiftShareMetrics> = {
    onView: jest.fn(),
    onSelectSubscription: jest.fn(),
    onStepChange: jest.fn(),
    onGiftShareStart: jest.fn(),
    onGiftShareSuccess: jest.fn(),
    onGiftShareFailure: jest.fn(),
    onRetry: jest.fn(),
    onCopyLink: jest.fn(),
    onShareLink: jest.fn(),
    onReset: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('initializes with default eligible subscription and select step', () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      expect(result.current.step).toBe('select');
      expect(result.current.selectedSubId).toBe(DEFAULT_SAMPLE_SUBSCRIPTIONS[0].id);
      expect(result.current.selectedSubscription).toBeDefined();
      expect(result.current.recipientInput).toBe('');
      expect(result.current.deliveryMethod).toBe('share_link');
      expect(result.current.expiresInDays).toBe(7);
      expect(result.current.allowSenderRevoke).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('falls back to first eligible subscription if initialSubscriptionId is ineligible', () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          initialSubscriptionId: 'sub_gym_paused', // paused sub in sample
          metrics,
          logger,
        })
      );

      expect(result.current.selectedSubId).toBe(DEFAULT_SAMPLE_SUBSCRIPTIONS[0].id);
      expect(result.current.selectedSubscription?.status).toBe('active');
    });

    it('honors eligible initialSubscriptionId', () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          initialSubscriptionId: 'sub_spotify_duo',
          metrics,
          logger,
        })
      );

      expect(result.current.selectedSubId).toBe('sub_spotify_duo');
      expect(result.current.selectedSubscription?.name).toBe('Spotify Premium Duo');
    });
  });

  describe('Subscription Selection', () => {
    it('selects valid subscription and triggers telemetry', () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      act(() => {
        result.current.handleSelectSubscription('sub_chatgpt_plus');
      });

      expect(result.current.selectedSubId).toBe('sub_chatgpt_plus');
      expect(metrics.onSelectSubscription).toHaveBeenCalledWith('sub_chatgpt_plus');
      expect(logger.info).toHaveBeenCalledWith(
        'Selected subscription to gift',
        expect.objectContaining({ subId: 'sub_chatgpt_plus' })
      );
    });

    it('rejects paused or ineligible subscription and sets error', () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      act(() => {
        result.current.handleSelectSubscription('sub_gym_paused');
      });

      expect(result.current.selectedSubId).toBe(DEFAULT_SAMPLE_SUBSCRIPTIONS[0].id);
      expect(result.current.error).toContain('Paused');
      expect(logger.warn).toHaveBeenCalledWith(
        'Ineligible subscription selected',
        expect.objectContaining({ subId: 'sub_gym_paused' })
      );
    });
  });

  describe('Step Transitions and Validations', () => {
    it('proceeds from select to recipient when eligible subscription is selected', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      await act(async () => {
        await result.current.handleProceed();
      });

      expect(result.current.step).toBe('recipient');
      expect(metrics.onStepChange).toHaveBeenCalledWith('select', 'recipient');
    });

    it('validates recipient before advancing from recipient to confirm', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Advance to recipient
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('recipient');

      // Attempt proceed with empty recipient
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('recipient');
      expect(result.current.error).toContain('required');

      // Attempt with invalid email
      act(() => {
        result.current.setRecipientInput('invalid-email-address');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('recipient');
      expect(result.current.error).toContain('valid email address or Stellar G-address');

      // Provide valid email
      act(() => {
        result.current.setRecipientInput('friend@example.com');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('confirm');
      expect(result.current.error).toBeNull();
      expect(metrics.onStepChange).toHaveBeenCalledWith('recipient', 'confirm');
    });

    it('validates personal message character length limit', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Move to recipient step
      await act(async () => {
        await result.current.handleProceed();
      });

      act(() => {
        result.current.setRecipientInput('friend@example.com');
        result.current.setPersonalMessage('x'.repeat(251)); // over 250
      });

      await act(async () => {
        await result.current.handleProceed();
      });

      expect(result.current.step).toBe('recipient');
      expect(result.current.error).toContain('must not exceed 250 characters');
    });

    it('navigates back across steps correctly with handleBack', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Step select -> recipient
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('recipient');

      // Step recipient -> confirm
      act(() => {
        result.current.setRecipientInput('friend@example.com');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('confirm');

      // Back to recipient
      act(() => {
        result.current.handleBack();
      });
      expect(result.current.step).toBe('recipient');

      // Back to select
      act(() => {
        result.current.handleBack();
      });
      expect(result.current.step).toBe('select');
    });
  });

  describe('Gift Confirmation and Result Generation', () => {
    it('creates gift result with default mock generator and triggers success metrics', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Advance to recipient
      await act(async () => {
        await result.current.handleProceed();
      });

      // Fill recipient and options
      act(() => {
        result.current.setRecipientInput(
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
        );
        result.current.setDeliveryMethod('share_link');
        result.current.setExpiresInDays(14);
        result.current.setAllowSenderRevoke(true);
        result.current.setPersonalMessage('Happy Birthday!');
      });

      // Advance to confirm
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('confirm');

      // Confirm send
      await act(async () => {
        await result.current.handleProceed();
      });

      expect(result.current.step).toBe('success');
      expect(result.current.giftResult).toBeDefined();
      expect(result.current.giftResult?.claimCode).toMatch(/^SUB-/);
      expect(result.current.giftResult?.recipientType).toBe('stellar_address');
      expect(result.current.giftResult?.personalMessage).toBe('Happy Birthday!');
      expect(metrics.onGiftShareStart).toHaveBeenCalled();
      expect(metrics.onGiftShareSuccess).toHaveBeenCalledWith(result.current.giftResult);
    });

    it('supports custom onSendGift handler', async () => {
      const mockCustomResult: GiftShareResult = {
        giftId: 'gift_custom_999',
        subscriptionId: 'sub_netflix_4k',
        subscriptionName: 'Netflix Premium (4K HDR)',
        claimCode: 'SUB-CUST-9999',
        shareableUrl: 'https://subtrackr.app/gift/claim?code=SUB-CUST-9999',
        recipient: 'colleague@corp.com',
        recipientType: 'email',
        deliveryMethod: 'direct_email',
        createdAt: '2026-11-24T12:00:00.000Z',
        expiresAt: '2026-12-01T12:00:00.000Z',
        status: 'pending',
      };

      const customOnSendGift = jest.fn().mockResolvedValue(mockCustomResult);

      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          onSendGift: customOnSendGift,
          metrics,
          logger,
        })
      );

      // select -> recipient
      await act(async () => {
        await result.current.handleProceed();
      });

      act(() => {
        result.current.setRecipientInput('colleague@corp.com');
        result.current.setDeliveryMethod('direct_email');
      });

      // recipient -> confirm
      await act(async () => {
        await result.current.handleProceed();
      });

      // confirm -> success
      await act(async () => {
        await result.current.handleProceed();
      });

      expect(customOnSendGift).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_netflix_4k',
          recipientInput: 'colleague@corp.com',
          deliveryMethod: 'direct_email',
        })
      );
      expect(result.current.step).toBe('success');
      expect(result.current.giftResult?.giftId).toBe('gift_custom_999');
      expect(metrics.onGiftShareSuccess).toHaveBeenCalledWith(mockCustomResult);
    });

    it('handles onSendGift failure, transitions to error, and supports retry', async () => {
      const failingSendGift = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network payment timeout'))
        .mockResolvedValueOnce({
          giftId: 'gift_retry_success',
          subscriptionId: 'sub_netflix_4k',
          subscriptionName: 'Netflix Premium (4K HDR)',
          claimCode: 'SUB-RETR-1111',
          shareableUrl: 'https://subtrackr.app/gift/claim?code=SUB-RETR-1111',
          recipient: 'friend@test.com',
          recipientType: 'email' as const,
          deliveryMethod: 'share_link' as const,
          createdAt: '2026-11-24T12:00:00.000Z',
          expiresAt: '2026-12-01T12:00:00.000Z',
          status: 'pending' as const,
        });

      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          onSendGift: failingSendGift,
          metrics,
          logger,
        })
      );

      // select -> recipient
      await act(async () => {
        await result.current.handleProceed();
      });

      act(() => {
        result.current.setRecipientInput('friend@test.com');
      });

      // recipient -> confirm
      await act(async () => {
        await result.current.handleProceed();
      });

      // confirm -> error
      await act(async () => {
        await result.current.handleProceed();
      });

      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('Network payment timeout');
      expect(metrics.onGiftShareFailure).toHaveBeenCalledWith('Network payment timeout');
      expect(logger.error).toHaveBeenCalled();

      // Retry send
      await act(async () => {
        await result.current.handleRetry();
      });

      expect(metrics.onRetry).toHaveBeenCalled();
      expect(result.current.step).toBe('success');
      expect(result.current.giftResult?.giftId).toBe('gift_retry_success');
    });

    it('allows editing recipient details from error step', async () => {
      const failingSend = jest.fn().mockRejectedValue(new Error('Account not found'));
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          onSendGift: failingSend,
          metrics,
          logger,
        })
      );

      // Navigate to confirm
      await act(async () => {
        await result.current.handleProceed();
      });
      act(() => {
        result.current.setRecipientInput('bad@email.com');
      });
      await act(async () => {
        await result.current.handleProceed();
      });

      // Trigger error
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('error');

      // Click Edit Details
      act(() => {
        result.current.handleEditDetails();
      });

      expect(result.current.step).toBe('recipient');
      expect(result.current.error).toBeNull();
    });
  });

  describe('Clipboard, Sharing, and Reset', () => {
    it('copies claim URL to clipboard and logs metrics', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Advance through to success
      await act(async () => {
        await result.current.handleProceed();
      });
      act(() => {
        result.current.setRecipientInput('user@subtrackr.com');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('success');

      // Copy link
      await act(async () => {
        await result.current.handleCopyLink();
      });

      expect(result.current.isCopied).toBe(true);
      expect(metrics.onCopyLink).toHaveBeenCalledWith(result.current.giftResult?.giftId);
    });

    it('triggers native share dialog and logs telemetry', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Advance to success
      await act(async () => {
        await result.current.handleProceed();
      });
      act(() => {
        result.current.setRecipientInput('user@subtrackr.com');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      await act(async () => {
        await result.current.handleProceed();
      });

      // Share link
      await act(async () => {
        await result.current.handleShareLink();
      });

      expect(metrics.onShareLink).toHaveBeenCalledWith(result.current.giftResult?.giftId);
    });

    it('resets flow state back to select step with handleReset', async () => {
      const { result } = renderHook(() =>
        useGiftShareFlow({
          subscriptions: DEFAULT_SAMPLE_SUBSCRIPTIONS,
          metrics,
          logger,
        })
      );

      // Advance to success
      await act(async () => {
        await result.current.handleProceed();
      });
      act(() => {
        result.current.setRecipientInput('user@subtrackr.com');
        result.current.setPersonalMessage('Enjoy!');
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      await act(async () => {
        await result.current.handleProceed();
      });
      expect(result.current.step).toBe('success');

      // Reset
      act(() => {
        result.current.handleReset();
      });

      expect(result.current.step).toBe('select');
      expect(result.current.recipientInput).toBe('');
      expect(result.current.personalMessage).toBe('');
      expect(result.current.giftResult).toBeNull();
      expect(metrics.onReset).toHaveBeenCalled();
    });
  });
});
