import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

interface DeveloperOnboardingProps {
  steps: OnboardingStep[];
  currentStep: number;
  onStepComplete: (stepId: string) => void;
  onFinish: () => void;
}

export const DeveloperOnboarding: React.FC<DeveloperOnboardingProps> = ({
  steps,
  currentStep,
  onStepComplete,
  onFinish,
}) => {
  const [loading, setLoading] = useState(false);

  const handleStepPress = useCallback(
    async (stepId: string) => {
      setLoading(true);
      try {
        await onStepComplete(stepId);
      } finally {
        setLoading(false);
      }
    },
    [onStepComplete]
  );

  const allCompleted = steps.every((step) => step.completed);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to SubTrackr Developer Portal</Text>
        <Text style={styles.subtitle}>
          Complete these steps to get started with your sandbox environment
        </Text>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${(steps.filter((s) => s.completed).length / steps.length) * 100}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {steps.filter((s) => s.completed).length} of {steps.length} completed
        </Text>
      </View>

      <View style={styles.stepsContainer}>
        {steps.map((step, index) => (
          <TouchableOpacity
            key={step.id}
            style={[
              styles.stepCard,
              step.completed && styles.stepCardCompleted,
              index === currentStep && styles.stepCardActive,
            ]}
            onPress={() => !step.completed && handleStepPress(step.id)}
            disabled={step.completed || loading}>
            <View style={styles.stepHeader}>
              <View style={[styles.stepNumber, step.completed && styles.stepNumberCompleted]}>
                {step.completed ? (
                  <Text style={styles.checkmark}>✓</Text>
                ) : (
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                )}
              </View>
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, step.completed && styles.stepTitleCompleted]}>
                  {step.title}
                </Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
              {loading && index === currentStep && (
                <ActivityIndicator size="small" color="#3B82F6" />
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {allCompleted && (
        <TouchableOpacity style={styles.finishButton} onPress={onFinish}>
          <Text style={styles.finishButtonText}>Go to Dashboard</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  progressContainer: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  stepsContainer: {
    padding: 16,
  },
  stepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  stepCardCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  stepCardActive: {
    borderColor: '#3B82F6',
    borderWidth: 2,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  stepNumberCompleted: {
    backgroundColor: '#22C55E',
  },
  stepNumberText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
  },
  checkmark: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  stepTitleCompleted: {
    color: '#15803D',
  },
  stepDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  finishButton: {
    backgroundColor: '#3B82F6',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  finishButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default DeveloperOnboarding;
