import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store';
import { CANCELLATION_REASONS } from '../store/cancellationStore';
import { RetentionOffer } from '../../backend/services/retentionService';

type Props = NativeStackScreenProps<RootStackParamList, 'CancellationFlow'>;

const OFFER_TYPE_ICONS: Record<string, string> = {
  discount: '💰',
  pause: '⏸️',
  feature_upgrade: '⭐',
  plan_change: '🔄',
};

const CancellationFlowScreen: React.FC<Props> = ({ route, navigation }) => {
  const { subscriptionId } = route.params;
  const {
    currentStep,
    reason,
    offers,
    acceptedOfferId,
    cancellationRecord,
    isLoading,
    error,
    initFlow,
    selectReason,
    acceptOffer,
    declineOffers,
    confirmCancellation,
    reset,
  } = useStore();

  useEffect(() => {
    initFlow(subscriptionId);
    return () => reset();
  }, [subscriptionId]);

  const handleAcceptOffer = async (offerId: string) => {
    await acceptOffer(offerId);
  };

  const handleConfirmCancellation = async () => {
    await confirmCancellation();
  };

  const renderReasonStep = () => (
    <View>
      <Text style={styles.stepLabel}>Step 1 of 3</Text>
      <Text style={styles.heading}>Why are you cancelling?</Text>
      <Text style={styles.subheading}>Your feedback helps us improve.</Text>
      {CANCELLATION_REASONS.map((r) => (
        <TouchableOpacity
          key={r}
          style={[styles.reasonOption, reason === r && styles.reasonOptionSelected]}
          onPress={() => selectReason(r)}
          accessibilityRole="radio"
          accessibilityState={{ selected: reason === r }}
          accessibilityLabel={r}>
          <Text style={[styles.reasonText, reason === r && styles.reasonTextSelected]}>{r}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderOfferCard = (offer: RetentionOffer) => (
    <Card key={offer.id} variant="elevated" style={styles.offerCard}>
      <View style={styles.offerHeader}>
        <Text style={styles.offerIcon}>{OFFER_TYPE_ICONS[offer.type] ?? '🎁'}</Text>
        <View style={styles.offerHeaderText}>
          <Text style={styles.offerTitle}>{offer.title}</Text>
          <Text style={styles.offerBadge}>{offer.abVariant === 'A' ? 'Popular' : 'Best Value'}</Text>
        </View>
      </View>
      <Text style={styles.offerDescription}>{offer.description}</Text>
      <Text style={styles.offerExpiry}>
        Expires: {new Date(offer.expiresAt).toLocaleDateString()}
      </Text>
      <Button
        title="Claim This Offer"
        variant="primary"
        fullWidth
        onPress={() => handleAcceptOffer(offer.id)}
        style={styles.offerBtn}
        accessibilityLabel={`Claim offer: ${offer.title}`}
      />
    </Card>
  );

  const renderOffersStep = () => (
    <View>
      <Text style={styles.stepLabel}>Step 2 of 3</Text>
      <Text style={styles.heading}>Wait — we have something for you</Text>
      <Text style={styles.subheading}>
        Before you go, here are some options we put together for you.
      </Text>
      {offers.length === 0 ? (
        <Card style={styles.noOffersCard}>
          <Text style={styles.noOffersText}>No special offers available at this time.</Text>
        </Card>
      ) : (
        offers.map(renderOfferCard)
      )}
      <Button
        title="No thanks, continue to cancel"
        variant="outline"
        fullWidth
        onPress={declineOffers}
        style={styles.declineBtn}
        accessibilityLabel="Decline all offers and continue to cancellation"
      />
    </View>
  );

  const renderConfirmStep = () => (
    <View>
      <Text style={styles.stepLabel}>Step 3 of 3</Text>
      <Text style={styles.heading}>Confirm Cancellation</Text>
      <Card variant="outlined" style={styles.confirmCard}>
        <Text style={styles.confirmLabel}>Reason</Text>
        <Text style={styles.confirmValue}>{reason}</Text>
      </Card>
      <Card variant="outlined" style={[styles.confirmCard, styles.warningCard]}>
        <Text style={styles.warningText}>
          ⚠️ Your subscription will remain active until the end of the current billing period. After
          that, access will be revoked.
        </Text>
      </Card>
      <Button
        title="Confirm Cancellation"
        variant="danger"
        fullWidth
        onPress={handleConfirmCancellation}
        style={styles.confirmBtn}
        accessibilityLabel="Confirm subscription cancellation"
      />
      <Button
        title="Go Back"
        variant="outline"
        fullWidth
        onPress={() => useStore.setState({ currentStep: 'OFFERS' })}
        accessibilityLabel="Go back to retention offers"
      />
    </View>
  );

  const renderSuccessStep = () => {
    const offerAccepted = acceptedOfferId !== null;
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>{offerAccepted ? '🎉' : '✅'}</Text>
        <Text style={styles.heading}>
          {offerAccepted ? 'Offer Applied!' : 'Cancellation Confirmed'}
        </Text>
        <Text style={styles.subheading}>
          {offerAccepted
            ? 'Your retention offer has been applied to your account.'
            : 'Your subscription has been cancelled. We hope to see you again.'}
        </Text>
        {cancellationRecord && (
          <Card style={styles.recordCard}>
            <Text style={styles.recordLabel}>Cool-off period ends</Text>
            <Text style={styles.recordValue}>
              {new Date(cancellationRecord.coolOffEndsAt).toLocaleDateString()}
            </Text>
            <Text style={styles.recordNote}>
              You can reactivate your subscription before this date.
            </Text>
          </Card>
        )}
        <Button
          title="Back to Dashboard"
          variant="primary"
          fullWidth
          onPress={() => navigation.popToTop()}
          style={styles.doneBtn}
          accessibilityLabel="Return to dashboard"
        />
      </View>
    );
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'REASON':
        return renderReasonStep();
      case 'OFFERS':
        return renderOffersStep();
      case 'CONFIRM':
        return renderConfirmStep();
      case 'SUCCESS':
        return renderSuccessStep();
      default:
        return null;
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      {error && (
        <Card variant="outlined" style={styles.errorCard}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </Card>
      )}
      {renderStep()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    flexGrow: 1,
    backgroundColor: colors.background,
  },
  loadingOverlay: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  stepLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  heading: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  // Reason step
  reasonOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  reasonOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceVariant,
  },
  reasonText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  reasonTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  // Offers step
  offerCard: {
    marginBottom: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  offerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  offerIcon: {
    fontSize: 28,
    marginRight: spacing.sm,
  },
  offerHeaderText: {
    flex: 1,
  },
  offerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  offerBadge: {
    ...typography.small,
    color: colors.accent,
    marginTop: 2,
  },
  offerDescription: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  offerExpiry: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  offerBtn: {
    marginTop: spacing.xs,
  },
  noOffersCard: {
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  noOffersText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  declineBtn: {
    marginTop: spacing.sm,
  },
  // Confirm step
  confirmCard: {
    marginBottom: spacing.md,
  },
  confirmLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  confirmValue: {
    ...typography.body,
    color: colors.text,
  },
  warningCard: {
    borderColor: colors.warning,
    backgroundColor: colors.warningBackground,
  },
  warningText: {
    ...typography.body2,
    color: colors.warning,
  },
  confirmBtn: {
    marginBottom: spacing.sm,
  },
  // Success step
  successContainer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  successIcon: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  recordCard: {
    width: '100%',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  recordLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  recordValue: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  recordNote: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  doneBtn: {
    width: '100%',
  },
  // Error
  errorCard: {
    marginBottom: spacing.md,
    borderColor: colors.error,
  },
  errorText: {
    ...typography.body2,
    color: colors.error,
  },
});

export default CancellationFlowScreen;
