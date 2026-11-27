/**
 * mobile/src/screens/gift/hooks.ts
 *
 * State machine hook for managing the gift-share flow, step transitions,
 * input validation, link sharing, error retry, and observability integration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_SAMPLE_SUBSCRIPTIONS,
  detectRecipientType,
  validateGiftEligibility,
  validatePersonalMessage,
  validateRecipient,
  createMockGiftResult,
} from './giftShareLogic';
import type {
  GiftableSubscription,
  GiftDeliveryMethod,
  GiftShareFormState,
  GiftShareLogger,
  GiftShareMetrics,
  GiftShareResult,
  GiftShareStep,
  UseGiftShareFlowReturn,
} from './types';

export interface UseGiftShareFlowOptions {
  subscriptions?: GiftableSubscription[];
  initialSubscriptionId?: string;
  onSendGift?: (formState: GiftShareFormState) => Promise<GiftShareResult>;
  metrics?: GiftShareMetrics;
  logger?: GiftShareLogger;
}

export function useGiftShareFlow({
  subscriptions = DEFAULT_SAMPLE_SUBSCRIPTIONS,
  initialSubscriptionId,
  onSendGift,
  metrics,
  logger,
}: UseGiftShareFlowOptions = {}): UseGiftShareFlowReturn {
  const initialSubId = useMemo(() => {
    if (initialSubscriptionId) {
      const match = subscriptions.find((s) => s.id === initialSubscriptionId);
      if (match && validateGiftEligibility(match).isEligible) {
        return match.id;
      }
    }
    const firstEligible = subscriptions.find((s) => validateGiftEligibility(s).isEligible);
    return firstEligible ? firstEligible.id : subscriptions[0]?.id || null;
  }, [subscriptions, initialSubscriptionId]);

  const [selectedSubId, setSelectedSubId] = useState<string | null>(initialSubId);
  const [step, setStep] = useState<GiftShareStep>('select');
  const [recipientInput, setRecipientInput] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<GiftDeliveryMethod>('share_link');
  const [personalMessage, setPersonalMessage] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [allowSenderRevoke, setAllowSenderRevoke] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [giftResult, setGiftResult] = useState<GiftShareResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const selectedSubscription = useMemo(
    () => subscriptions.find((sub) => sub.id === selectedSubId) || null,
    [subscriptions, selectedSubId]
  );

  const recipientValidation = useMemo(() => validateRecipient(recipientInput), [recipientInput]);

  const messageValidation = useMemo(
    () => validatePersonalMessage(personalMessage),
    [personalMessage]
  );

  const formState: GiftShareFormState = useMemo(
    () => ({
      subscriptionId: selectedSubId,
      recipientInput: recipientInput.trim(),
      recipientType: detectRecipientType(recipientInput),
      deliveryMethod,
      personalMessage: personalMessage.trim(),
      expiresInDays,
      allowSenderRevoke,
    }),
    [
      selectedSubId,
      recipientInput,
      deliveryMethod,
      personalMessage,
      expiresInDays,
      allowSenderRevoke,
    ]
  );

  const transitionStep = useCallback(
    (toStep: GiftShareStep) => {
      logger?.info?.('Transitioning gift share step', { from: step, to: toStep });
      metrics?.onStepChange?.(step, toStep);
      setStep(toStep);
    },
    [step, metrics, logger]
  );

  const handleSelectSubscription = useCallback(
    (subId: string) => {
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) return;

      const eligibility = validateGiftEligibility(sub);
      if (!eligibility.isEligible) {
        setError(eligibility.reason || 'Subscription is not eligible for gift sharing.');
        logger?.warn?.('Ineligible subscription selected', {
          subId,
          reason: eligibility.reason,
        });
        return;
      }

      setError(null);
      setSelectedSubId(subId);
      metrics?.onSelectSubscription?.(subId);
      logger?.info?.('Selected subscription to gift', { subId, name: sub.name });
    },
    [subscriptions, metrics, logger]
  );

  const handleProceed = useCallback(async () => {
    setError(null);

    // Step 1: Select Subscription -> Recipient Details
    if (step === 'select') {
      if (!selectedSubscription) {
        setError('Please select an active subscription to gift.');
        return;
      }
      const eligibility = validateGiftEligibility(selectedSubscription);
      if (!eligibility.isEligible) {
        setError(eligibility.reason || 'Selected subscription cannot be gifted.');
        return;
      }
      transitionStep('recipient');
      return;
    }

    // Step 2: Recipient Details -> Confirm
    if (step === 'recipient') {
      if (!recipientValidation.isValid) {
        setError(recipientValidation.error || 'Please enter a valid recipient.');
        return;
      }
      if (!messageValidation.isValid) {
        setError(messageValidation.error || 'Personal message is too long.');
        return;
      }
      transitionStep('confirm');
      return;
    }

    // Step 3 / Error Retry: Confirm -> Processing -> Success / Error
    if (step === 'confirm' || step === 'error') {
      if (!selectedSubscription) {
        setError('Missing subscription details.');
        return;
      }

      transitionStep('processing');
      metrics?.onGiftShareStart?.({
        subscriptionId: selectedSubscription.id,
        recipientType: formState.recipientType,
        deliveryMethod: formState.deliveryMethod,
      });
      logger?.info?.('Initiating gift share transaction', {
        subId: selectedSubscription.id,
        recipientType: formState.recipientType,
      });

      try {
        let result: GiftShareResult;
        if (onSendGift) {
          result = await onSendGift(formState);
        } else {
          result = createMockGiftResult(formState, selectedSubscription);
        }

        setGiftResult(result);
        transitionStep('success');
        metrics?.onGiftShareSuccess?.(result);
        logger?.info?.('Gift share successfully created', {
          giftId: result.giftId,
          claimCode: result.claimCode,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to generate gift share link. Please try again.';
        setError(message);
        transitionStep('error');
        metrics?.onGiftShareFailure?.(message);
        logger?.error?.('Gift share creation failed', { error: message });
      }
    }
  }, [
    step,
    selectedSubscription,
    recipientValidation,
    messageValidation,
    formState,
    onSendGift,
    transitionStep,
    metrics,
    logger,
  ]);

  const handleRetry = useCallback(async () => {
    metrics?.onRetry?.();
    logger?.info?.('Retrying gift share creation from error step');
    await handleProceed();
  }, [handleProceed, metrics, logger]);

  const handleEditDetails = useCallback(() => {
    setError(null);
    transitionStep('recipient');
    logger?.info?.('Editing gift details from error state');
  }, [transitionStep, logger]);

  const handleBack = useCallback(() => {
    setError(null);
    if (step === 'recipient') {
      transitionStep('select');
    } else if (step === 'confirm') {
      transitionStep('recipient');
    } else if (step === 'error') {
      transitionStep('confirm');
    }
  }, [step, transitionStep]);

  const handleCopyLink = useCallback(async () => {
    if (!giftResult?.shareableUrl) return;
    try {
      await Clipboard.setStringAsync(giftResult.shareableUrl);
      setIsCopied(true);
      metrics?.onCopyLink?.(giftResult.giftId);
      logger?.info?.('Copied gift share URL to clipboard', { giftId: giftResult.giftId });
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 3000);
      const timer = copyTimeoutRef.current as unknown as { unref?: () => void } | null;
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger?.warn?.('Clipboard copy failed', { error: errorMsg });
    }
  }, [giftResult, metrics, logger]);

  const handleShareLink = useCallback(async () => {
    if (!giftResult) return;
    try {
      const shareMessage = `Here's a gift subscription to ${giftResult.subscriptionName} on SubTrackr!\nClaim code: ${giftResult.claimCode}\nClaim link: ${giftResult.shareableUrl}`;
      await Share.share({
        title: `Gift: ${giftResult.subscriptionName}`,
        message: shareMessage,
        url: giftResult.shareableUrl,
      });
      metrics?.onShareLink?.(giftResult.giftId);
      logger?.info?.('Native share sheet opened', { giftId: giftResult.giftId });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger?.warn?.('Native share dialog failed or canceled', { error: errorMsg });
    }
  }, [giftResult, metrics, logger]);

  const handleReset = useCallback(() => {
    setSelectedSubId(initialSubId);
    setRecipientInput('');
    setDeliveryMethod('share_link');
    setPersonalMessage('');
    setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    setAllowSenderRevoke(true);
    setError(null);
    setGiftResult(null);
    setIsCopied(false);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    transitionStep('select');
    metrics?.onReset?.();
    logger?.info?.('Gift share state reset to default');
  }, [initialSubId, transitionStep, metrics, logger]);

  return {
    step,
    subscriptions,
    selectedSubscription,
    selectedSubId,
    recipientInput,
    setRecipientInput,
    deliveryMethod,
    setDeliveryMethod,
    personalMessage,
    setPersonalMessage,
    expiresInDays,
    setExpiresInDays,
    allowSenderRevoke,
    setAllowSenderRevoke,
    recipientValidation,
    messageValidation,
    formState,
    error,
    setError,
    giftResult,
    isCopied,
    handleSelectSubscription,
    handleProceed,
    handleRetry,
    handleEditDetails,
    handleBack,
    handleCopyLink,
    handleShareLink,
    handleReset,
  };
}
