import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useOnboardingStore } from '../../store/onboardingStore';

export interface OnboardingTourProps {
  testID?: string;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  testID = 'onboarding-tour-modal',
}) => {
  const {
    steps,
    currentStepIndex,
    isActive,
    nextStep,
    prevStep,
    skipTour,
    finishTour,
  } = useOnboardingStore();

  if (!isActive || steps.length === 0) {
    return null;
  }

  const currentStep = steps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  return (
    <View style={styles.backdrop} testID={testID}>
      <View style={styles.cardContainer} testID="onboarding-tour-card">
        {/* Header & Step Counter */}
        <View style={styles.headerRow}>
          <Text style={styles.stepCounterText} testID="onboarding-step-counter">
            Step {currentStepIndex + 1} of {steps.length}
          </Text>
          <Pressable
            onPress={skipTour}
            style={styles.skipButton}
            testID="onboarding-skip-button"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        {/* Content */}
        <Text style={styles.titleText} testID="onboarding-step-title">
          {currentStep.title}
        </Text>
        <Text style={styles.descriptionText} testID="onboarding-step-description">
          {currentStep.description}
        </Text>

        {/* Action Footer */}
        <View style={styles.footerRow}>
          {!isFirstStep && (
            <Pressable
              onPress={prevStep}
              style={[styles.button, styles.secondaryButton]}
              testID="onboarding-prev-button"
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          )}

          <Pressable
            onPress={isLastStep ? finishTour : nextStep}
            style={[styles.button, styles.primaryButton, isFirstStep && styles.fullWidthButton]}
            testID="onboarding-next-button"
          >
            <Text style={styles.primaryButtonText}>
              {isLastStep ? 'Get Started' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepCounterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366F1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  skipButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  skipText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  titleText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 24,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullWidthButton: {
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#6366F1',
    flex: 1,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
