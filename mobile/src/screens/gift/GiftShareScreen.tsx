/**
 * mobile/src/screens/gift/GiftShareScreen.tsx
 *
 * Production-ready subscription gift-share screen for SubTrackr mobile.
 * Enables users to transfer/pass an active subscription to another user via email
 * or Stellar public address with shareable link generation, error retry, and telemetry.
 */

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MAX_PERSONAL_MESSAGE_LENGTH } from './giftShareLogic';
import { useGiftShareFlow } from './hooks';
import type { GiftDeliveryMethod, GiftShareScreenProps } from './types';

export const GiftShareScreen: React.FC<GiftShareScreenProps> = ({
  subscriptions,
  initialSubscriptionId,
  onSendGift,
  onBack,
  metrics,
  logger,
  testID = 'gift-share-screen',
}) => {
  const {
    step,
    subscriptions: subs,
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
    error,
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
  } = useGiftShareFlow({
    subscriptions,
    initialSubscriptionId,
    onSendGift,
    metrics,
    logger,
  });

  useEffect(() => {
    metrics?.onView?.();
    logger?.info?.('GiftShareScreen mounted');
  }, [metrics, logger]);

  // Success view
  if (step === 'success' && giftResult) {
    return (
      <View style={styles.centerContainer} testID="gift-share-success-view">
        <View style={styles.successBadge}>
          <Text style={styles.successCheck}>✓</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Gift Share Ready!
        </Text>
        <Text style={styles.subtitle}>
          Your subscription to {giftResult.subscriptionName} can now be claimed by{' '}
          {giftResult.recipient}.
        </Text>

        {/* Claim Code Box */}
        <View style={styles.claimCodeCard} testID="claim-code-card">
          <Text style={styles.claimCodeLabel}>CLAIM CODE</Text>
          <Text
            style={styles.claimCodeValue}
            accessibilityRole="text"
            accessibilityLabel={`Claim code: ${giftResult.claimCode}`}
            testID="claim-code-text">
            {giftResult.claimCode}
          </Text>
          <Text style={styles.claimExpiry}>
            Valid for {expiresInDays} days • Expires {giftResult.expiresAt.split('T')[0]}
          </Text>
        </View>

        {/* Shareable Link Box */}
        <View style={styles.urlCard}>
          <Text style={styles.urlLabel}>Shareable Link</Text>
          <Text
            style={styles.urlValue}
            numberOfLines={1}
            ellipsizeMode="middle"
            testID="shareable-url-text">
            {giftResult.shareableUrl}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.copyButton]}
            onPress={handleCopyLink}
            accessibilityRole="button"
            accessibilityLabel={isCopied ? 'Link copied' : 'Copy link to clipboard'}
            accessibilityHint="Copies the gift link to your clipboard"
            testID="gift-copy-link-button">
            <Text style={styles.copyButtonText}>{isCopied ? '✓ Copied!' : 'Copy Link'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.shareButton]}
            onPress={handleShareLink}
            accessibilityRole="button"
            accessibilityLabel="Share gift link"
            accessibilityHint="Opens device share sheet to share the gift link"
            testID="gift-native-share-button">
            <Text style={styles.shareButtonText}>Share via...</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onBack || handleReset}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="gift-done-button">
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Processing state
  if (step === 'processing') {
    return (
      <View style={styles.centerContainer} testID="gift-share-processing-view">
        <ActivityIndicator
          size="large"
          color="#3B82F6"
          accessibilityRole="progressbar"
          accessibilityLabel="Generating gift link"
        />
        <Text style={styles.processingTitle}>Generating Gift Share...</Text>
        <Text style={styles.processingSubtitle}>
          Registering gift claim ticket and preparing transfer link.
        </Text>
      </View>
    );
  }

  // Dedicated Error State with Retry & Edit Support
  if (step === 'error') {
    return (
      <View style={styles.centerContainer} testID="gift-share-error-view">
        <View style={styles.errorBadge}>
          <Text style={styles.errorBadgeIcon}>✕</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Gift Share Failed
        </Text>
        <Text style={styles.subtitle}>
          We encountered an issue creating your subscription transfer link.
        </Text>

        <View style={styles.errorCard} testID="gift-error-card" accessibilityRole="alert">
          <Text style={styles.errorCardLabel}>Error Details</Text>
          <Text style={styles.errorCardText}>
            {error || 'An unexpected failure occurred while creating your gift share ticket.'}
          </Text>
        </View>

        <View style={styles.errorActionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, styles.retryButton]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry sending gift"
            testID="gift-retry-button">
            <Text style={styles.primaryButtonText}>↻ Retry Send</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.editButton}
            onPress={handleEditDetails}
            accessibilityRole="button"
            accessibilityLabel="Edit recipient details"
            testID="gift-edit-button">
            <Text style={styles.editButtonText}>Edit Details</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onBack || handleReset}
          accessibilityRole="button"
          accessibilityLabel="Cancel gift share"
          testID="gift-cancel-button">
          <Text style={styles.doneButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isNextDisabled =
    (step === 'select' && !selectedSubscription) ||
    (step === 'recipient' && !recipientValidation.isValid);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID={testID}
      keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={step === 'select' ? onBack : handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="gift-back-button">
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          Gift a Subscription
        </Text>
        <Text style={styles.subtitle}>
          Pass an active subscription to a friend, colleague, or team member via email or Stellar
          wallet.
        </Text>
      </View>

      {/* Step Progress Indicators */}
      <View style={styles.stepIndicatorContainer} accessibilityRole="tablist">
        {(['select', 'recipient', 'confirm'] as const).map((s, idx) => {
          const isActive = step === s;
          const isPassed =
            (s === 'select' && (step === 'recipient' || step === 'confirm')) ||
            (s === 'recipient' && step === 'confirm');
          return (
            <View key={s} style={styles.stepItem}>
              <View
                style={[
                  styles.stepBadge,
                  isActive && styles.stepBadgeActive,
                  isPassed && styles.stepBadgePassed,
                ]}>
                <Text style={styles.stepBadgeText}>{idx + 1}</Text>
              </View>
              <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
                {s === 'select' ? 'Select' : s === 'recipient' ? 'Recipient' : 'Confirm'}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Error Alert Banner */}
      {error && (
        <View style={styles.errorBanner} testID="gift-error-banner">
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        </View>
      )}

      {/* STEP 1: Select Subscription */}
      {step === 'select' && (
        <View
          style={styles.stepSection}
          testID="step-select-subscription"
          accessibilityRole="radiogroup"
          accessibilityLabel="Select subscription to gift">
          <Text style={styles.sectionTitle}>1. Select Subscription</Text>
          <Text style={styles.sectionSubtitle}>
            Choose an active subscription to transfer or share.
          </Text>

          {subs.map((sub) => {
            const isSelected = selectedSubId === sub.id;
            const isGiftable = sub.isGiftable !== false && sub.status === 'active';

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.subscriptionCard,
                  isSelected && styles.subscriptionCardSelected,
                  !isGiftable && styles.subscriptionCardDisabled,
                ]}
                onPress={() => handleSelectSubscription(sub.id)}
                disabled={!isGiftable}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: !isGiftable }}
                accessibilityLabel={`${sub.name}, ${sub.planTier} tier, ${sub.price} ${sub.currency} per ${sub.billingCycle}`}
                testID={`subscription-item-${sub.id}`}>
                <View style={styles.subCardTop}>
                  <View style={styles.subInfo}>
                    <Text style={styles.subName}>{sub.name}</Text>
                    <Text style={styles.subCategory}>{sub.category || 'Subscription'}</Text>
                  </View>
                  <View style={styles.subPriceBox}>
                    <Text style={styles.subPrice}>
                      ${sub.price.toFixed(2)}
                      <Text style={styles.subBillingCycle}>
                        /{sub.billingCycle === 'annual' ? 'yr' : 'mo'}
                      </Text>
                    </Text>
                    <View style={[styles.tierBadge, isSelected && styles.tierBadgeActive]}>
                      <Text style={styles.tierBadgeText}>{sub.planTier.toUpperCase()}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.subCardBottom}>
                  <Text style={styles.subRenewal}>Renews: {sub.renewalDate}</Text>
                  {!isGiftable && (
                    <Text style={styles.subDisabledNotice}>
                      {sub.nonGiftableReason || 'Ineligible'}
                    </Text>
                  )}
                  {isGiftable && isSelected && (
                    <Text style={styles.subSelectedTag}>Selected ✓</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* STEP 2: Recipient Details */}
      {step === 'recipient' && (
        <View style={styles.stepSection} testID="step-recipient-details">
          <Text style={styles.sectionTitle}>2. Recipient & Message</Text>
          <Text style={styles.sectionSubtitle}>
            Enter an email or Stellar G-address to receive the subscription.
          </Text>

          {/* Delivery Method Tabs */}
          <Text style={styles.fieldLabel}>Delivery Method</Text>
          <View style={styles.deliveryTabs} accessibilityRole="tablist">
            {(
              [
                { id: 'share_link', label: 'Share Link' },
                { id: 'direct_email', label: 'Direct Email' },
                { id: 'in_app', label: 'In-App Transfer' },
              ] as const
            ).map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[styles.deliveryTab, deliveryMethod === tab.id && styles.deliveryTabActive]}
                onPress={() => setDeliveryMethod(tab.id as GiftDeliveryMethod)}
                accessibilityRole="tab"
                accessibilityState={{ selected: deliveryMethod === tab.id }}
                testID={`delivery-tab-${tab.id}`}>
                <Text
                  style={[
                    styles.deliveryTabText,
                    deliveryMethod === tab.id && styles.deliveryTabTextActive,
                  ]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recipient Input */}
          <Text style={styles.fieldLabel}>Recipient Email or Stellar Address</Text>
          <TextInput
            style={[
              styles.textInput,
              recipientInput.length > 0 &&
                (recipientValidation.isValid ? styles.inputValid : styles.inputInvalid),
            ]}
            placeholder="e.g. friend@example.com or GABC123..."
            placeholderTextColor="#64748B"
            value={recipientInput}
            onChangeText={setRecipientInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Recipient email or Stellar address"
            testID="recipient-input"
          />

          {recipientInput.trim().length > 0 && (
            <View style={styles.inputStatusRow}>
              <Text
                style={[
                  styles.inputStatusText,
                  recipientValidation.isValid ? styles.validText : styles.invalidText,
                ]}>
                {recipientValidation.isValid
                  ? `✓ Valid ${recipientValidation.type === 'stellar_address' ? 'Stellar Address' : 'Email'}`
                  : `✗ ${recipientValidation.error}`}
              </Text>
            </View>
          )}

          {/* Expiry Options */}
          <Text style={styles.fieldLabel}>Claim Expiration Window</Text>
          <View
            style={styles.expiryRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Claim expiration window">
            {[3, 7, 14, 30].map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.expiryChip, expiresInDays === days && styles.expiryChipActive]}
                onPress={() => setExpiresInDays(days)}
                accessibilityRole="radio"
                accessibilityState={{ selected: expiresInDays === days }}
                accessibilityLabel={`${days} days expiration`}
                testID={`expiry-chip-${days}`}>
                <Text
                  style={[
                    styles.expiryChipText,
                    expiresInDays === days && styles.expiryChipTextActive,
                  ]}>
                  {days} Days
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Revocation Safeguard Toggle */}
          <TouchableOpacity
            style={styles.toggleCard}
            onPress={() => setAllowSenderRevoke(!allowSenderRevoke)}
            accessibilityRole="switch"
            accessibilityState={{ checked: allowSenderRevoke }}
            accessibilityLabel="Allow sender revocation"
            accessibilityHint="Allows you to cancel this gift if recipient does not claim it"
            testID="allow-sender-revoke-toggle">
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Allow Sender Revocation</Text>
              <Text style={styles.toggleDescription}>
                Retain ability to cancel this gift if unclaimed before expiration.
              </Text>
            </View>
            <View style={[styles.switchTrack, allowSenderRevoke && styles.switchTrackActive]}>
              <View style={[styles.switchThumb, allowSenderRevoke && styles.switchThumbActive]} />
            </View>
          </TouchableOpacity>

          {/* Personal Message */}
          <View style={styles.messageLabelRow}>
            <Text style={styles.fieldLabel}>Personal Message (Optional)</Text>
            <Text style={styles.charCounter}>
              {personalMessage.length}/{MAX_PERSONAL_MESSAGE_LENGTH}
            </Text>
          </View>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="Add a friendly note to your gift..."
            placeholderTextColor="#64748B"
            value={personalMessage}
            onChangeText={setPersonalMessage}
            multiline
            numberOfLines={3}
            maxLength={MAX_PERSONAL_MESSAGE_LENGTH}
            accessibilityLabel="Personal message"
            testID="personal-message-input"
          />
        </View>
      )}

      {/* STEP 3: Confirm & Review */}
      {step === 'confirm' && selectedSubscription && (
        <View style={styles.stepSection} testID="step-confirm-gift">
          <Text style={styles.sectionTitle}>3. Review & Confirm</Text>
          <Text style={styles.sectionSubtitle}>
            Review the gift details before generating the claimable link.
          </Text>

          <View style={styles.summaryCard} testID="gift-summary-card">
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subscription</Text>
              <Text style={styles.summaryValue}>{selectedSubscription.name}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Plan Tier</Text>
              <Text style={styles.summaryValue}>{selectedSubscription.planTier.toUpperCase()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Price / Value</Text>
              <Text style={styles.summaryValue}>
                ${selectedSubscription.price.toFixed(2)} / {selectedSubscription.billingCycle}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Recipient</Text>
              <Text style={styles.summaryValue} numberOfLines={1} ellipsizeMode="middle">
                {recipientInput}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery</Text>
              <Text style={styles.summaryValue}>
                {deliveryMethod === 'share_link'
                  ? 'Shareable Link'
                  : deliveryMethod === 'direct_email'
                    ? 'Email Notification'
                    : 'In-App Transfer'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Valid For</Text>
              <Text style={styles.summaryValue}>{expiresInDays} Days</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Revocation Policy</Text>
              <Text style={styles.summaryValue}>
                {allowSenderRevoke ? 'Revocable until claimed' : 'Non-revocable'}
              </Text>
            </View>
            {personalMessage.length > 0 && (
              <View style={styles.messagePreviewBox}>
                <Text style={styles.messagePreviewLabel}>Note Attached:</Text>
                <Text style={styles.messagePreviewText}>"{personalMessage}"</Text>
              </View>
            )}
          </View>

          <View style={styles.termsNotice}>
            <Text style={styles.termsText}>
              ℹ️ Your subscription billing remains active until the recipient claims the gift. You
              can revoke this gift at any time before it is claimed.
            </Text>
          </View>
        </View>
      )}

      {/* Footer Navigation Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, isNextDisabled && styles.buttonDisabled]}
          onPress={handleProceed}
          disabled={isNextDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            step === 'select'
              ? 'Continue to recipient details'
              : step === 'recipient'
                ? 'Review gift summary'
                : 'Confirm and generate gift share link'
          }
          testID="gift-proceed-button">
          <Text style={styles.primaryButtonText}>
            {step === 'select'
              ? 'Continue to Recipient →'
              : step === 'recipient'
                ? 'Review Summary →'
                : 'Confirm & Send Gift'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    marginBottom: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    minHeight: 48,
    justifyContent: 'center',
  },
  backText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
  },
  stepIndicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  stepBadgeActive: {
    backgroundColor: '#3B82F6',
  },
  stepBadgePassed: {
    backgroundColor: '#10B981',
  },
  stepBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  stepLabelActive: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#EF4444',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  stepSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
  },
  subscriptionCard: {
    backgroundColor: '#1E293B',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    minHeight: 48,
  },
  subscriptionCardSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E293B',
  },
  subscriptionCardDisabled: {
    opacity: 0.5,
  },
  subCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  subInfo: {
    flex: 1,
  },
  subName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  subCategory: {
    fontSize: 12,
    color: '#94A3B8',
  },
  subPriceBox: {
    alignItems: 'flex-end',
  },
  subPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#38BDF8',
  },
  subBillingCycle: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '400',
  },
  tierBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  tierBadgeActive: {
    backgroundColor: '#2563EB',
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  subCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  subRenewal: {
    fontSize: 12,
    color: '#64748B',
  },
  subDisabledNotice: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
  subSelectedTag: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
    marginBottom: 8,
    marginTop: 12,
  },
  deliveryTabs: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  deliveryTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
    minHeight: 48,
    justifyContent: 'center',
  },
  deliveryTabActive: {
    backgroundColor: '#3B82F6',
  },
  deliveryTabText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  deliveryTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  textInput: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 48,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  inputValid: {
    borderColor: '#10B981',
  },
  inputInvalid: {
    borderColor: '#EF4444',
  },
  inputStatusRow: {
    marginTop: 4,
    marginBottom: 4,
  },
  inputStatusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  validText: {
    color: '#10B981',
  },
  invalidText: {
    color: '#EF4444',
  },
  expiryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  expiryChip: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 3,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  expiryChipActive: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E3A8A',
  },
  expiryChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  expiryChipTextActive: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    minHeight: 48,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#334155',
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: '#3B82F6',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },
  messageLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCounter: {
    fontSize: 11,
    color: '#64748B',
  },
  summaryCard: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 8,
  },
  messagePreviewBox: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  messagePreviewLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
  },
  messagePreviewText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontStyle: 'italic',
  },
  termsNotice: {
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 8,
  },
  termsText: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
  footer: {
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  successBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#065F46',
    borderWidth: 2,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successCheck: {
    fontSize: 32,
    color: '#10B981',
    fontWeight: '800',
  },
  errorBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7F1D1D',
    borderWidth: 2,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorBadgeIcon: {
    fontSize: 28,
    color: '#EF4444',
    fontWeight: '800',
  },
  errorCard: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    padding: 16,
    width: '100%',
    marginVertical: 16,
  },
  errorCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F87171',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  errorCardText: {
    fontSize: 13,
    color: '#FCA5A5',
    lineHeight: 20,
  },
  errorActionRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 12,
  },
  retryButton: {
    flex: 1,
    backgroundColor: '#2563EB',
    marginRight: 8,
  },
  editButton: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginLeft: 8,
  },
  editButtonText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  claimCodeCard: {
    backgroundColor: '#1E293B',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    width: '100%',
    marginVertical: 16,
  },
  claimCodeLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#94A3B8',
    fontWeight: '700',
    marginBottom: 4,
  },
  claimCodeValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#38BDF8',
    letterSpacing: 2,
    marginBottom: 6,
  },
  claimExpiry: {
    fontSize: 12,
    color: '#64748B',
  },
  urlCard: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    marginBottom: 16,
  },
  urlLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 2,
  },
  urlValue: {
    fontSize: 13,
    color: '#CBD5E1',
    fontFamily: 'monospace',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  copyButton: {
    backgroundColor: '#3B82F6',
    marginRight: 8,
  },
  copyButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  shareButton: {
    backgroundColor: '#334155',
    marginLeft: 8,
  },
  shareButtonText: {
    color: '#F8FAFC',
    fontWeight: '600',
    fontSize: 14,
  },
  doneButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 48,
    justifyContent: 'center',
  },
  doneButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  processingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 16,
  },
  processingSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 6,
    textAlign: 'center',
  },
});
