import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useMerchantStore } from '../store/merchantStore';
import { Card } from '../components/common/Card';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import {
  OnboardingStep,
  OnboardingStatus,
  VerificationTier,
  DocumentType,
  MerchantOnboardingFormData,
} from '../types/merchant';

const MerchantOnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    onboarding,
    isLoading,
    error,
    startOnboarding,
    submitDocument,
    nextStep,
    previousStep,
    requestVerification,
  } = useMerchantStore();

  const [formData, setFormData] = useState<MerchantOnboardingFormData>({
    businessName: '',
    businessType: '',
    country: '',
    phoneNumber: '',
    email: '',
  });

  const handleStartOnboarding = useCallback(async () => {
    if (!formData.businessName || !formData.email) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }
    await startOnboarding(formData);
  }, [formData, startOnboarding]);

  const handleDocumentUpload = useCallback(
    async (docType: DocumentType) => {
      await submitDocument(docType, `doc_${Date.now()}`);
      Alert.alert('Success', 'Document uploaded successfully');
    },
    [submitDocument]
  );

  const renderStepIndicator = () => {
    if (!onboarding) return null;

    return (
      <View style={styles.stepIndicator}>
        {onboarding.steps.map((step, index) => {
          const isActive = step === onboarding.currentStep;
          const isCompleted = onboarding.steps.indexOf(onboarding.currentStep) > index;

          return (
            <View key={step} style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  isActive && styles.stepCircleActive,
                  isCompleted && styles.stepCircleCompleted,
                ]}>
                <Text
                  style={[styles.stepNumber, (isActive || isCompleted) && styles.stepNumberActive]}>
                  {isCompleted ? '✓' : index + 1}
                </Text>
              </View>
              <Text
                style={[styles.stepLabel, isActive && styles.stepLabelActive]}
                numberOfLines={1}>
                {step.replace('_', ' ')}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const renderBusinessInfoStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Business Information</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Business Name *</Text>
        <TextInput
          style={styles.input}
          value={formData.businessName}
          onChangeText={(text) => setFormData({ ...formData, businessName: text })}
          placeholder="Enter business name"
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Business Type</Text>
        <TextInput
          style={styles.input}
          value={formData.businessType}
          onChangeText={(text) => setFormData({ ...formData, businessType: text })}
          placeholder="e.g., LLC, Corporation"
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Country</Text>
        <TextInput
          style={styles.input}
          value={formData.country}
          onChangeText={(text) => setFormData({ ...formData, country: text })}
          placeholder="Enter country"
          placeholderTextColor={colors.textSecondary}
        />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Phone Number</Text>
        <TextInput
          style={styles.input}
          value={formData.phoneNumber}
          onChangeText={(text) => setFormData({ ...formData, phoneNumber: text })}
          placeholder="Enter phone number"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
        />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Email *</Text>
        <TextInput
          style={styles.input}
          value={formData.email}
          onChangeText={(text) => setFormData({ ...formData, email: text })}
          placeholder="Enter email"
          placeholderTextColor={colors.textSecondary}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>
    </View>
  );

  const renderDocumentStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Document Upload</Text>
      <Text style={styles.stepDescription}>
        Please upload the required documents for verification
      </Text>

      <TouchableOpacity
        style={styles.uploadBox}
        onPress={() => handleDocumentUpload(DocumentType.ID_FRONT)}
        accessibilityRole="button"
        accessibilityLabel="Upload ID document front">
        <Text style={styles.uploadIcon}>📄</Text>
        <Text style={styles.uploadText}>ID Document (Front)</Text>
        <Text style={styles.uploadHint}>Tap to upload</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.uploadBox}
        onPress={() => handleDocumentUpload(DocumentType.ID_BACK)}
        accessibilityRole="button"
        accessibilityLabel="Upload ID document back">
        <Text style={styles.uploadIcon}>📄</Text>
        <Text style={styles.uploadText}>ID Document (Back)</Text>
        <Text style={styles.uploadHint}>Tap to upload</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.uploadBox}
        onPress={() => handleDocumentUpload(DocumentType.BUSINESS_LICENSE)}
        accessibilityRole="button"
        accessibilityLabel="Upload business license">
        <Text style={styles.uploadIcon}>🏢</Text>
        <Text style={styles.uploadText}>Business License</Text>
        <Text style={styles.uploadHint}>Tap to upload</Text>
      </TouchableOpacity>
    </View>
  );

  const renderReviewStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Review & Submit</Text>
      <Text style={styles.stepDescription}>
        Review your information and submit for verification
      </Text>

      <Card style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Business Name</Text>
          <Text style={styles.summaryValue}>{formData.businessName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Business Type</Text>
          <Text style={styles.summaryValue}>{formData.businessType || 'N/A'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Country</Text>
          <Text style={styles.summaryValue}>{formData.country || 'N/A'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Email</Text>
          <Text style={styles.summaryValue}>{formData.email}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Documents</Text>
          <Text style={styles.summaryValue}>{onboarding?.documents.length || 0} uploaded</Text>
        </View>
      </Card>

      <TouchableOpacity
        style={styles.submitButton}
        onPress={requestVerification}
        accessibilityRole="button"
        accessibilityLabel="Submit for verification">
        <Text style={styles.submitButtonText}>Submit for Verification</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStatus = () => {
    if (!onboarding) return null;

    const statusColors: Record<string, string> = {
      [OnboardingStatus.VERIFIED]: colors.success,
      [OnboardingStatus.REJECTED]: colors.danger,
      [OnboardingStatus.PENDING_REVIEW]: colors.warning,
      [OnboardingStatus.IN_PROGRESS]: colors.primary,
    };

    return (
      <Card style={styles.statusCard}>
        <Text style={styles.statusTitle}>Verification Status</Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[onboarding.status] || colors.textSecondary },
            ]}>
            <Text style={styles.statusBadgeText}>{onboarding.status.replace('_', ' ')}</Text>
          </View>
        </View>
        {onboarding.verificationResult && (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Verification Tier</Text>
              <Text style={styles.summaryValue}>{onboarding.verificationResult.tier}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Monthly Limit</Text>
              <Text style={styles.summaryValue}>
                ${onboarding.verificationResult.limits.monthlyVolume.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Max Transactions</Text>
              <Text style={styles.summaryValue}>
                {onboarding.verificationResult.limits.maxTransactions.toLocaleString()}
              </Text>
            </View>
          </>
        )}
      </Card>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Merchant Onboarding</Text>
          <Text style={styles.subtitle}>Complete verification to start accepting payments</Text>
        </View>

        {onboarding ? (
          <>
            {renderStepIndicator()}
            {renderStatus()}
            {onboarding.currentStep === OnboardingStep.BUSINESS_INFO && renderBusinessInfoStep()}
            {onboarding.currentStep === OnboardingStep.ID_DOCUMENT && renderDocumentStep()}
            {onboarding.currentStep === OnboardingStep.BUSINESS_LICENSE && renderDocumentStep()}
            {onboarding.currentStep === OnboardingStep.REVIEW && renderReviewStep()}

            <View style={styles.navigationButtons}>
              {onboarding.steps.indexOf(onboarding.currentStep) > 0 && (
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={previousStep}
                  accessibilityRole="button"
                  accessibilityLabel="Go to previous step">
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>
              )}
              {onboarding.currentStep !== OnboardingStep.REVIEW && (
                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={nextStep}
                  accessibilityRole="button"
                  accessibilityLabel="Go to next step">
                  <Text style={styles.nextButtonText}>Next</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          <Card style={styles.startCard}>
            <Text style={styles.startTitle}>Get Started</Text>
            <Text style={styles.startDescription}>
              Complete our merchant verification process to start accepting subscription payments
            </Text>
            <TouchableOpacity
              style={styles.startButton}
              onPress={handleStartOnboarding}
              accessibilityRole="button"
              accessibilityLabel="Start onboarding">
              <Text style={styles.startButtonText}>Start Onboarding</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizeMd,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.primary,
  },
  stepCircleCompleted: {
    backgroundColor: colors.success,
  },
  stepNumber: {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
  },
  stepNumberActive: {
    color: colors.text,
  },
  stepLabel: {
    marginTop: spacing.xs,
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
  },
  stepLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeightBold,
  },
  stepContent: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  stepDescription: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.fontSizeMd,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  uploadBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  uploadIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  uploadText: {
    fontSize: typography.fontSizeMd,
    color: colors.text,
    fontWeight: typography.fontWeightMedium,
  },
  uploadHint: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  summaryCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: typography.fontSizeSm,
    color: colors.text,
    fontWeight: typography.fontWeightMedium,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  submitButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
  navigationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.md,
  },
  backButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  backButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightMedium,
  },
  nextButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  nextButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
  statusCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  statusTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  statusBadgeText: {
    color: colors.text,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    textTransform: 'capitalize',
  },
  startCard: {
    padding: spacing.lg,
    margin: spacing.md,
    alignItems: 'center',
  },
  startTitle: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  startDescription: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  startButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
});

export default MerchantOnboardingScreen;
