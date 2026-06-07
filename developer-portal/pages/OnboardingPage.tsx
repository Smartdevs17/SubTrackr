import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  isRequired: boolean;
}

interface OnboardingPageProps {
  onComplete: () => void;
}

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: 'register',
      title: 'Create Developer Account',
      description: 'Sign up for a developer account to access the SubTrackr API.',
      completed: false,
      isRequired: true,
    },
    {
      id: 'verify-email',
      title: 'Verify Email Address',
      description: 'Confirm your email address to activate your account.',
      completed: false,
      isRequired: true,
    },
    {
      id: 'create-sandbox',
      title: 'Create Sandbox Environment',
      description: 'Set up a sandbox environment for testing your integration.',
      completed: false,
      isRequired: true,
    },
    {
      id: 'generate-api-key',
      title: 'Generate API Key',
      description: 'Create your first API key to start making API calls.',
      completed: false,
      isRequired: true,
    },
    {
      id: 'explore-docs',
      title: 'Explore Documentation',
      description: 'Review the API documentation and integration guides.',
      completed: false,
      isRequired: false,
    },
    {
      id: 'first-api-call',
      title: 'Make First API Call',
      description: 'Test your integration by making your first API call.',
      completed: false,
      isRequired: true,
    },
  ]);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
  });

  const completedCount = steps.filter((s) => s.completed).length;
  const allRequiredCompleted = steps.filter((s) => s.isRequired).every((s) => s.completed);

  const handleCompleteStep = (stepId: string) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, completed: true } : s)));

    const nextStep = steps.findIndex((s) => !s.completed && s.id !== stepId);
    if (nextStep !== -1) {
      setCurrentStep(nextStep);
    }
  };

  const handleRegister = () => {
    if (!formData.name.trim() || !formData.email.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    handleCompleteStep('register');
    handleCompleteStep('verify-email');
  };

  const handleCreateSandbox = () => {
    Alert.alert('Sandbox Created', 'Your sandbox environment has been created successfully!', [
      { text: 'OK', onPress: () => handleCompleteStep('create-sandbox') },
    ]);
  };

  const handleGenerateApiKey = () => {
    Alert.alert(
      'API Key Generated',
      'Your API key has been generated. You can find it in the API Keys section.',
      [{ text: 'OK', onPress: () => handleCompleteStep('generate-api-key') }]
    );
  };

  const handleMakeFirstCall = () => {
    Alert.alert(
      'API Call Successful',
      'Congratulations! You made your first API call successfully!',
      [{ text: 'OK', onPress: () => handleCompleteStep('first-api-call') }]
    );
  };

  const renderStepContent = (step: OnboardingStep) => {
    switch (step.id) {
      case 'register':
      case 'verify-email':
        return (
          <View style={styles.stepForm}>
            <Text style={styles.inputLabel}>Full Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
              placeholder="John Doe"
              placeholderTextColor="#9CA3AF"
            />
            <Text style={styles.inputLabel}>Email Address *</Text>
            <TextInput
              style={styles.input}
              value={formData.email}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, email: text }))}
              placeholder="john@example.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
            />
            <Text style={styles.inputLabel}>Company (Optional)</Text>
            <TextInput
              style={styles.input}
              value={formData.company}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, company: text }))}
              placeholder="Acme Inc"
              placeholderTextColor="#9CA3AF"
            />
            <TouchableOpacity style={styles.actionButton} onPress={handleRegister}>
              <Text style={styles.actionButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        );

      case 'create-sandbox':
        return (
          <View style={styles.stepForm}>
            <Text style={styles.stepHelpText}>
              Your sandbox environment will be created with default settings. You can customize it
              later in the environment settings.
            </Text>
            <TouchableOpacity style={styles.actionButton} onPress={handleCreateSandbox}>
              <Text style={styles.actionButtonText}>Create Sandbox Environment</Text>
            </TouchableOpacity>
          </View>
        );

      case 'generate-api-key':
        return (
          <View style={styles.stepForm}>
            <Text style={styles.stepHelpText}>
              Generate an API key to authenticate your requests. Keep this key secure and never
              share it publicly.
            </Text>
            <TouchableOpacity style={styles.actionButton} onPress={handleGenerateApiKey}>
              <Text style={styles.actionButtonText}>Generate API Key</Text>
            </TouchableOpacity>
          </View>
        );

      case 'explore-docs':
        return (
          <View style={styles.stepForm}>
            <Text style={styles.stepHelpText}>
              Review the API documentation to understand available endpoints, authentication, and
              best practices.
            </Text>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleCompleteStep('explore-docs')}>
              <Text style={styles.actionButtonText}>Mark as Reviewed</Text>
            </TouchableOpacity>
          </View>
        );

      case 'first-api-call':
        return (
          <View style={styles.stepForm}>
            <Text style={styles.codeBlock}>
              {`curl -X GET https://sandbox.api.subtrackr.io/v1/subscriptions \\
  -H "Authorization: Bearer sk_test_your_key"`}
            </Text>
            <TouchableOpacity style={styles.actionButton} onPress={handleMakeFirstCall}>
              <Text style={styles.actionButtonText}>Test API Call</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to SubTrackr</Text>
        <Text style={styles.subtitle}>
          Complete these steps to set up your developer environment
        </Text>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[styles.progressFill, { width: `${(completedCount / steps.length) * 100}%` }]}
          />
        </View>
        <Text style={styles.progressText}>
          {completedCount} of {steps.length} completed
        </Text>
      </View>

      <View style={styles.stepsContainer}>
        {steps.map((step, index) => (
          <View
            key={step.id}
            style={[
              styles.stepCard,
              step.completed && styles.stepCardCompleted,
              index === currentStep && styles.stepCardActive,
            ]}>
            <TouchableOpacity
              style={styles.stepHeader}
              onPress={() => !step.completed && setCurrentStep(index)}
              disabled={step.completed}>
              <View style={[styles.stepNumber, step.completed && styles.stepNumberCompleted]}>
                {step.completed ? (
                  <Text style={styles.checkmark}>✓</Text>
                ) : (
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                )}
              </View>
              <View style={styles.stepInfo}>
                <Text style={[styles.stepTitle, step.completed && styles.stepTitleCompleted]}>
                  {step.title}
                </Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
                {step.isRequired && !step.completed && (
                  <Text style={styles.requiredBadge}>Required</Text>
                )}
              </View>
            </TouchableOpacity>

            {index === currentStep && !step.completed && (
              <View style={styles.stepContent}>{renderStepContent(step)}</View>
            )}
          </View>
        ))}
      </View>

      {allRequiredCompleted && (
        <View style={styles.completionContainer}>
          <Text style={styles.completionIcon}>🎉</Text>
          <Text style={styles.completionTitle}>Setup Complete!</Text>
          <Text style={styles.completionText}>
            You're all set to start integrating with SubTrackr.
          </Text>
          <TouchableOpacity style={styles.dashboardButton} onPress={onComplete}>
            <Text style={styles.dashboardButtonText}>Go to Dashboard</Text>
          </TouchableOpacity>
        </View>
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
    fontSize: 28,
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
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
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
    padding: 16,
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
  stepInfo: {
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
  requiredBadge: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
    marginTop: 4,
  },
  stepContent: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  stepForm: {
    gap: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  stepHelpText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 16,
  },
  codeBlock: {
    backgroundColor: '#1F2937',
    color: '#F9FAFB',
    padding: 16,
    borderRadius: 8,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  actionButton: {
    backgroundColor: '#3B82F6',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  completionContainer: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  completionIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  completionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  completionText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  dashboardButton: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  dashboardButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default OnboardingPage;
