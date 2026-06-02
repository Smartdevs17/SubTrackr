import React, { useState, useCallback, useEffect } from 'react';
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
  Modal,
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
  DocumentType,
  MerchantOnboardingFormData,
} from '../types/merchant';

// ── Welcome tour steps ────────────────────────────────────────────────────────

const TOUR_STEPS = [
  { icon: '🏢', title: 'Business Info', desc: 'Tell us about your business' },
  { icon: '📄', title: 'Documents', desc: 'Upload ID and business license' },
  { icon: '💳', title: 'Payment Setup', desc: 'Configure how you get paid' },
  { icon: '✅', title: 'Review', desc: 'Submit for compliance screening' },
];

// ── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  [OnboardingStatus.VERIFIED]: colors.success,
  [OnboardingStatus.REJECTED]: colors.danger,
  [OnboardingStatus.PENDING_REVIEW]: colors.warning,
  [OnboardingStatus.IN_PROGRESS]: colors.primary,
  [OnboardingStatus.NOT_STARTED]: colors.textSecondary,
  [OnboardingStatus.EXPIRED]: colors.danger,
};

// ── Component ─────────────────────────────────────────────────────────────────

const MerchantOnboardingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    onboarding,
    isLoading,
    error,
    startOnboarding,
    saveProgress,
    submitDocument,
    retryRejectedDocument,
    nextStep,
    previousStep,
    runComplianceScreening,
    configurePayment,
    requestVerification,
    completeWelcomeTour,
    canResume,
  } = useMerchantStore();

  const [formData, setFormData] = useState<MerchantOnboardingFormData>({
    businessName: '',
    businessType: '',
    country: '',
    phoneNumber: '',
    email: '',
  });
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [walletAddress, setWalletAddress] = useState('');

  // Pre-fill form from saved progress on mount
  useEffect(() => {
    if (onboarding?.formData) {
      setFormData((prev) => ({ ...prev, ...(onboarding.formData as MerchantOnboardingFormData) }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show error alerts
  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleStartOnboarding = useCallback(async () => {
    if (!formData.businessName || !formData.email) {
      Alert.alert('Error', 'Business name and email are required');
      return;
    }
    if (canResume()) {
      Alert.alert(
        'Resume Onboarding',
        'You have an incomplete onboarding session. Would you like to resume it?',
        [
          { text: 'Start Fresh', onPress: () => startOnboarding(formData) },
          { text: 'Resume', onPress: () => startOnboarding(formData) },
        ],
      );
    } else {
      await startOnboarding(formData);
      setShowTour(true);
    }
  }, [formData, startOnboarding, canResume]);

  const handleSaveAndExit = useCallback(() => {
    saveProgress(formData);
    Alert.alert('Saved', 'Your progress has been saved. You can resume later.');
    navigation.goBack();
  }, [formData, saveProgress, navigation]);

  const handleDocumentUpload = useCallback(
    async (docType: DocumentType) => {
      // In production: launch image picker and get real URI
      const mockUri = `file://doc_${docType}_${Date.now()}.jpg`;
      await submitDocument(docType, mockUri);
      Alert.alert('Uploaded', 'Document submitted for review');
    },
    [submitDocument],
  );

  const handleRetryDocument = useCallback(
    async (docId: string) => {
      const mockUri = `file://retry_${docId}_${Date.now()}.jpg`;
      await retryRejectedDocument(docId, mockUri);
      Alert.alert('Re-uploaded', 'Document resubmitted');
    },
    [retryRejectedDocument],
  );

  const handleConfigurePayment = useCallback(() => {
    if (!walletAddress) {
      Alert.alert('Error', 'Please enter a Stellar wallet address');
      return;
    }
    configurePayment({ method: 'stellar_xlm', walletAddress });
    Alert.alert('Saved', 'Payment method configured');
  }, [walletAddress, configurePayment]);

  const handleRunCompliance = useCallback(async () => {
    try {
      const result = await runComplianceScreening();
      if (!result.passed) {
        Alert.alert(
          'Compliance Failed',
          result.sanctionsHit
            ? 'Your country is on the sanctions list. We cannot proceed.'
            : 'Compliance check failed. Please contact support.',
        );
      } else {
        Alert.alert('Compliance Passed', 'Your business passed all compliance checks ✅');
      }
    } catch {
      Alert.alert('Error', 'Compliance check failed. Please try again.');
    }
  }, [runComplianceScreening]);

  const handleNextStep = useCallback(async () => {
    saveProgress(formData);
    await nextStep();
  }, [formData, saveProgress, nextStep]);

  const handleTourFinish = useCallback(() => {
    setShowTour(false);
    completeWelcomeTour();
  }, [completeWelcomeTour]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderStepIndicator = () => {
    if (!onboarding) return null;
    return (
      <View style={styles.stepIndicator}>
        {onboarding.steps.map((step, index) => {
          const currentIdx = onboarding.steps.indexOf(onboarding.currentStep);
          const isActive = step === onboarding.currentStep;
          const isCompleted = currentIdx > index;
          return (
            <View key={step} style={styles.stepItem}>
              <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isCompleted && styles.stepCircleCompleted]}>
                <Text style={[styles.stepNumber, (isActive || isCompleted) && styles.stepNumberActive]}>
                  {isCompleted ? '✓' : index + 1}
                </Text>
              </View>
              <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]} numberOfLines={1}>
                {step.replace(/_/g, ' ')}
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
      {(['businessName', 'businessType', 'country', 'phoneNumber', 'email'] as const).map((field) => (
        <View key={field} style={styles.inputGroup}>
          <Text style={styles.inputLabel}>
            {field.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
            {(field === 'businessName' || field === 'email') ? ' *' : ''}
          </Text>
          <TextInput
            style={styles.input}
            value={formData[field]}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, [field]: text }))}
            placeholder={`Enter ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`}
            placeholderTextColor={colors.textSecondary}
            keyboardType={field === 'email' ? 'email-address' : field === 'phoneNumber' ? 'phone-pad' : 'default'}
            autoCapitalize={field === 'email' ? 'none' : 'words'}
          />
        </View>
      ))}
    </View>
  );

  const renderDocumentStep = () => {
    const docTypes =
      onboarding?.currentStep === OnboardingStep.ID_DOCUMENT
        ? [DocumentType.ID_FRONT, DocumentType.ID_BACK]
        : [DocumentType.BUSINESS_LICENSE];

    return (
      <View style={styles.stepContent}>
        <Text style={styles.sectionTitle}>Document Upload</Text>
        <Text style={styles.stepDescription}>Upload clear photos of the required documents</Text>
        {docTypes.map((docType) => {
          const uploaded = onboarding?.documents.find((d) => d.type === docType);
          const isRejected = uploaded?.status === 'rejected';
          return (
            <TouchableOpacity
              key={docType}
              style={[styles.uploadBox, uploaded && styles.uploadBoxDone, isRejected && styles.uploadBoxRejected]}
              onPress={() => isRejected && uploaded ? handleRetryDocument(uploaded.id) : handleDocumentUpload(docType)}
              accessibilityRole="button"
              accessibilityLabel={`Upload ${docType.replace(/_/g, ' ')}`}>
              <Text style={styles.uploadIcon}>{uploaded ? (isRejected ? '❌' : '✅') : '📄'}</Text>
              <Text style={styles.uploadText}>{docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
              <Text style={styles.uploadHint}>
                {isRejected ? 'Tap to re-upload' : uploaded ? 'Uploaded — pending review' : 'Tap to upload'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderPaymentStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Payment Setup</Text>
      <Text style={styles.stepDescription}>Configure how you receive subscription payments</Text>
      {onboarding?.paymentSetup ? (
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryValue}>✅ Payment configured: {onboarding.paymentSetup.method}</Text>
          {onboarding.paymentSetup.walletAddress && (
            <Text style={styles.summaryLabel} numberOfLines={1}>{onboarding.paymentSetup.walletAddress}</Text>
          )}
        </Card>
      ) : (
        <>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Stellar Wallet Address *</Text>
            <TextInput
              style={styles.input}
              value={walletAddress}
              onChangeText={setWalletAddress}
              placeholder="G..."
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
            />
          </View>
          <TouchableOpacity style={styles.nextButton} onPress={handleConfigurePayment} accessibilityRole="button">
            <Text style={styles.nextButtonText}>Save Payment Method</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderComplianceStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Compliance Screening</Text>
      <Text style={styles.stepDescription}>We run sanctions and PEP checks to keep the platform safe.</Text>
      {onboarding?.compliance ? (
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Result</Text>
            <Text style={[styles.summaryValue, { color: onboarding.compliance.passed ? colors.success : colors.danger }]}>
              {onboarding.compliance.passed ? '✅ Passed' : '❌ Failed'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Sanctions</Text>
            <Text style={styles.summaryValue}>{onboarding.compliance.sanctionsHit ? 'Hit' : 'Clear'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>PEP</Text>
            <Text style={styles.summaryValue}>{onboarding.compliance.pepHit ? 'Hit' : 'Clear'}</Text>
          </View>
        </Card>
      ) : (
        <TouchableOpacity style={styles.nextButton} onPress={handleRunCompliance} accessibilityRole="button">
          <Text style={styles.nextButtonText}>Run Compliance Check</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderReviewStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.sectionTitle}>Review & Submit</Text>
      <Card style={styles.summaryCard}>
        {([
          ['Business Name', onboarding?.formData?.businessName],
          ['Business Type', onboarding?.formData?.businessType || 'N/A'],
          ['Country', onboarding?.formData?.country || 'N/A'],
          ['Email', onboarding?.formData?.email],
          ['Documents', `${onboarding?.documents.length ?? 0} uploaded`],
          ['Payment', onboarding?.paymentSetup ? onboarding.paymentSetup.method : 'Not configured'],
          ['Compliance', onboarding?.compliance ? (onboarding.compliance.passed ? '✅ Passed' : '❌ Failed') : 'Not run'],
        ] as [string, string | undefined][]).map(([label, value]) => (
          <View key={label} style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue}>{value ?? '—'}</Text>
          </View>
        ))}
      </Card>
      {onboarding?.verificationDeadline && (
        <Text style={styles.stepDescription}>
          ⏱ Verification deadline: {new Date(onboarding.verificationDeadline).toLocaleDateString()}
        </Text>
      )}
      <TouchableOpacity style={styles.submitButton} onPress={requestVerification} accessibilityRole="button">
        <Text style={styles.submitButtonText}>Submit for Verification</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStatusCard = () => {
    if (!onboarding) return null;
    return (
      <Card style={styles.statusCard}>
        <Text style={styles.statusTitle}>Verification Status</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[onboarding.status] ?? colors.textSecondary }]}>
            <Text style={styles.statusBadgeText}>{onboarding.status.replace(/_/g, ' ')}</Text>
          </View>
        </View>
        {onboarding.verificationResult && (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tier</Text>
              <Text style={styles.summaryValue}>{onboarding.verificationResult.tier}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Monthly Limit</Text>
              <Text style={styles.summaryValue}>${onboarding.verificationResult.limits.monthlyVolume.toLocaleString()}</Text>
            </View>
          </>
        )}
      </Card>
    );
  };

  const renderCurrentStep = () => {
    if (!onboarding) return null;
    switch (onboarding.currentStep) {
      case OnboardingStep.BUSINESS_INFO: return renderBusinessInfoStep();
      case OnboardingStep.ID_DOCUMENT: return renderDocumentStep();
      case OnboardingStep.BUSINESS_LICENSE: return renderDocumentStep();
      case OnboardingStep.REVIEW: return renderReviewStep();
      default: return null;
    }
  };

  // ── Main render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Processing...</Text>
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
            {renderStatusCard()}
            {renderCurrentStep()}

            <View style={styles.navigationButtons}>
              {onboarding.steps.indexOf(onboarding.currentStep) > 0 && (
                <TouchableOpacity style={styles.backButton} onPress={previousStep} accessibilityRole="button">
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.saveExitButton} onPress={handleSaveAndExit} accessibilityRole="button">
                <Text style={styles.saveExitText}>Save & Exit</Text>
              </TouchableOpacity>
              {onboarding.currentStep !== OnboardingStep.REVIEW && (
                <TouchableOpacity style={styles.nextButton} onPress={handleNextStep} accessibilityRole="button">
                  <Text style={styles.nextButtonText}>Next →</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          <Card style={styles.startCard}>
            <Text style={styles.startTitle}>Get Started</Text>
            <Text style={styles.startDescription}>
              Complete our merchant verification process to start accepting subscription payments on Stellar.
            </Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Business Name *</Text>
              <TextInput
                style={styles.input}
                value={formData.businessName}
                onChangeText={(t) => setFormData((p) => ({ ...p, businessName: t }))}
                placeholder="Enter business name"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email *</Text>
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(t) => setFormData((p) => ({ ...p, email: t }))}
                placeholder="Enter email"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <TouchableOpacity style={styles.startButton} onPress={handleStartOnboarding} accessibilityRole="button">
              <Text style={styles.startButtonText}>Start Onboarding</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>

      {/* Welcome tour modal */}
      <Modal visible={showTour} animationType="fade" transparent onRequestClose={handleTourFinish}>
        <View style={styles.tourOverlay}>
          <View style={styles.tourCard}>
            <Text style={styles.tourIcon}>{TOUR_STEPS[tourStep].icon}</Text>
            <Text style={styles.tourTitle}>{TOUR_STEPS[tourStep].title}</Text>
            <Text style={styles.tourDesc}>{TOUR_STEPS[tourStep].desc}</Text>
            <View style={styles.tourDots}>
              {TOUR_STEPS.map((_, i) => (
                <View key={i} style={[styles.tourDot, i === tourStep && styles.tourDotActive]} />
              ))}
            </View>
            <View style={styles.tourButtons}>
              <TouchableOpacity onPress={handleTourFinish} accessibilityRole="button">
                <Text style={styles.tourSkip}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tourNext}
                onPress={() => {
                  if (tourStep < TOUR_STEPS.length - 1) setTourStep((s) => s + 1);
                  else handleTourFinish();
                }}
                accessibilityRole="button">
                <Text style={styles.tourNextText}>
                  {tourStep < TOUR_STEPS.length - 1 ? 'Next' : 'Get Started'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: typography.fontSizeMd },
  header: { padding: spacing.md, paddingTop: spacing.lg },
  title: { fontSize: typography.fontSizeXl, fontWeight: typography.fontWeightBold, color: colors.text },
  subtitle: { fontSize: typography.fontSizeMd, color: colors.textSecondary, marginTop: spacing.xs },
  stepIndicator: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.md },
  stepItem: { alignItems: 'center', flex: 1 },
  stepCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepCircleCompleted: { backgroundColor: colors.success },
  stepNumber: { color: colors.textSecondary, fontSize: typography.fontSizeSm, fontWeight: typography.fontWeightBold },
  stepNumberActive: { color: colors.text },
  stepLabel: { marginTop: spacing.xs, fontSize: typography.fontSizeXs, color: colors.textSecondary, textAlign: 'center' },
  stepLabelActive: { color: colors.primary, fontWeight: typography.fontWeightBold },
  stepContent: { padding: spacing.md },
  sectionTitle: { fontSize: typography.fontSizeLg, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.md },
  stepDescription: { fontSize: typography.fontSizeMd, color: colors.textSecondary, marginBottom: spacing.md },
  inputGroup: { marginBottom: spacing.md },
  inputLabel: { fontSize: typography.fontSizeSm, color: colors.textSecondary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, fontSize: typography.fontSizeMd, color: colors.text, borderWidth: 1, borderColor: colors.border },
  uploadBox: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  uploadBoxDone: { borderColor: colors.success, borderStyle: 'solid' },
  uploadBoxRejected: { borderColor: colors.danger, borderStyle: 'solid' },
  uploadIcon: { fontSize: 32, marginBottom: spacing.sm },
  uploadText: { fontSize: typography.fontSizeMd, color: colors.text, fontWeight: typography.fontWeightMedium },
  uploadHint: { fontSize: typography.fontSizeSm, color: colors.textSecondary, marginTop: spacing.xs },
  summaryCard: { padding: spacing.md, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryLabel: { fontSize: typography.fontSizeSm, color: colors.textSecondary },
  summaryValue: { fontSize: typography.fontSizeSm, color: colors.text, fontWeight: typography.fontWeightMedium },
  submitButton: { backgroundColor: colors.primary, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  submitButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold },
  navigationButtons: { flexDirection: 'row', padding: spacing.md, gap: spacing.sm },
  backButton: { flex: 1, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  backButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightMedium },
  saveExitButton: { flex: 1, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  saveExitText: { color: colors.textSecondary, fontSize: typography.fontSizeSm },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center' },
  nextButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold },
  statusCard: { padding: spacing.md, margin: spacing.md, marginTop: 0 },
  statusTitle: { fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.md },
  statusBadgeText: { color: colors.text, fontSize: typography.fontSizeSm, fontWeight: typography.fontWeightMedium, textTransform: 'capitalize' },
  startCard: { padding: spacing.lg, margin: spacing.md, alignItems: 'center' },
  startTitle: { fontSize: typography.fontSizeLg, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.sm },
  startDescription: { fontSize: typography.fontSizeMd, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  startButton: { backgroundColor: colors.primary, borderRadius: borderRadius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', width: '100%' },
  startButtonText: { color: colors.text, fontSize: typography.fontSizeMd, fontWeight: typography.fontWeightBold },
  tourOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  tourCard: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.xl, alignItems: 'center', width: '100%' },
  tourIcon: { fontSize: 56, marginBottom: spacing.md },
  tourTitle: { fontSize: typography.fontSizeLg, fontWeight: typography.fontWeightBold, color: colors.text, marginBottom: spacing.sm },
  tourDesc: { fontSize: typography.fontSizeMd, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  tourDots: { flexDirection: 'row', marginBottom: spacing.lg, gap: spacing.xs },
  tourDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  tourDotActive: { backgroundColor: colors.primary, width: 20 },
  tourButtons: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' },
  tourSkip: { color: colors.textSecondary, fontSize: typography.fontSizeMd },
  tourNext: { backgroundColor: colors.primary, borderRadius: borderRadius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  tourNextText: { color: colors.text, fontWeight: typography.fontWeightBold },
});

export default MerchantOnboardingScreen;
