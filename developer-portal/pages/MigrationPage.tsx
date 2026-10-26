import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { migrationService, MigrationPlan } from '../../src/services/sandbox/migrationService';

interface MigrationPageProps {
  environmentId?: string;
  environmentName?: string;
  onComplete: () => void;
  onBack: () => void;
}

export const MigrationPage: React.FC<MigrationPageProps> = ({
  environmentId = 'sandbox_dev_001',
  environmentName = 'Development Sandbox',
  onComplete,
  onBack,
}) => {
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState<string | null>(null);

  useEffect(() => {
    loadOrCreatePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOrCreatePlan = async () => {
    setLoading(true);
    try {
      const existing = migrationService.getCurrentPlan();
      if (existing) {
        setPlan(existing);
      } else {
        const newPlan = await migrationService.createMigrationPlan(environmentId, environmentName);
        setPlan(newPlan);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load migration plan');
    } finally {
      setLoading(false);
    }
  };

  const handleStartValidation = async () => {
    if (!plan) return;
    setStepLoading('validation');
    try {
      const updated = await migrationService.startValidation();
      setPlan({ ...updated! });
    } finally {
      setStepLoading(null);
    }
  };

  const handleExecuteStep = async (stepId: string) => {
    if (!plan) return;
    setStepLoading(stepId);
    try {
      const step = await migrationService.executeStep(stepId);
      if (step) {
        // Refresh plan
        const current = migrationService.getCurrentPlan();
        setPlan(current ? { ...current } : null);
      }
    } finally {
      setStepLoading(null);
    }
  };

  const handleCompleteMigration = async () => {
    Alert.alert(
      'Go Live to Production?',
      'This will transition your sandbox configuration to production. This action cannot be easily undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go Live',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const result = await migrationService.completeMigration();
              if (result.success) {
                Alert.alert(
                  '🎉 Migration Complete!',
                  'Your configuration has been migrated to production.\n\n' +
                    'Monitor your production traffic for the first 24 hours.',
                  [{ text: 'OK', onPress: onComplete }]
                );
              } else {
                Alert.alert('Migration Failed', result.errors.join('\n'));
              }
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleChecklist = async (stepId: string, itemId: string, currentStatus: string) => {
    if (!plan) return;
    const newStatus =
      currentStatus === 'failed' ? 'passed' : currentStatus === 'pending' ? 'passed' : 'pending';
    await migrationService.updateChecklistItem(
      stepId,
      itemId,
      newStatus as 'pending' | 'passed' | 'failed'
    );
    const current = migrationService.getCurrentPlan();
    setPlan(current ? { ...current } : null);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
      case 'passed':
        return '#10B981';
      case 'in_progress':
        return '#F59E0B';
      case 'failed':
        return '#EF4444';
      case 'pending':
        return '#6B7280';
      default:
        return '#6B7280';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'completed':
      case 'passed':
        return '✅';
      case 'in_progress':
        return '🔄';
      case 'failed':
        return '❌';
      case 'pending':
        return '⏳';
      case 'skipped':
        return '⏭️';
      default:
        return '⬜';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return { label: 'CRITICAL', color: '#EF4444', bg: '#FEE2E2' };
      case 'warning':
        return { label: 'WARNING', color: '#F59E0B', bg: '#FEF3C7' };
      case 'info':
        return { label: 'INFO', color: '#3B82F6', bg: '#DBEAFE' };
      default:
        return { label: 'UNKNOWN', color: '#6B7280', bg: '#F3F4F6' };
    }
  };

  if (loading && !plan) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading migration plan...</Text>
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No migration plan available.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadOrCreatePlan}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🚀 Migration Wizard</Text>
        <Text style={styles.subtitle}>Sandbox → Production: {plan.sourceEnvironmentName}</Text>
      </View>

      {/* Progress */}
      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Migration Progress</Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${
                  plan.summary.totalSteps > 0
                    ? (plan.summary.completedSteps / plan.summary.totalSteps) * 100
                    : 0
                }%`,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {plan.summary.completedSteps} / {plan.summary.totalSteps} steps completed
          {'  '}|{'  '}
          {plan.summary.passedChecks} / {plan.summary.totalChecks} checks passed
          {plan.summary.criticalFailures > 0 && (
            <Text style={styles.criticalWarning}>
              {'  ⚠️ '}
              {plan.summary.criticalFailures} critical failure(s)
            </Text>
          )}
        </Text>
      </View>

      {/* Plan Status */}
      <View style={styles.statusBar}>
        <Text style={styles.statusLabel}>Plan Status:</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(plan.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(plan.status) }]}>
            {plan.status.toUpperCase()}
          </Text>
        </View>
        {plan.status === 'draft' && (
          <TouchableOpacity
            style={styles.validateButton}
            onPress={handleStartValidation}
            disabled={stepLoading === 'validation'}>
            {stepLoading === 'validation' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.validateButtonText}>Start Validation</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Steps */}
      {plan.steps.map((step, index) => (
        <View
          key={step.id}
          style={[styles.stepCard, activeStep === step.id && styles.stepCardActive]}>
          <TouchableOpacity
            style={styles.stepHeader}
            onPress={() => setActiveStep(activeStep === step.id ? null : step.id)}>
            <View style={styles.stepHeaderLeft}>
              <View style={[styles.stepNumber, { backgroundColor: getStatusColor(step.status) }]}>
                <Text style={styles.stepNumberText}>{step.order}</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
            </View>
            <View style={styles.stepHeaderRight}>
              <Text style={styles.statusIcon}>{getStatusIcon(step.status)}</Text>
              {step.status === 'completed' && (
                <Text style={styles.expandIcon}>{activeStep === step.id ? '▲' : '▼'}</Text>
              )}
              {step.status === 'pending' && plan.status === 'ready' && (
                <TouchableOpacity
                  style={styles.runStepButton}
                  onPress={() => handleExecuteStep(step.id)}
                  disabled={stepLoading === step.id}>
                  {stepLoading === step.id ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.runStepButtonText}>Run</Text>
                  )}
                </TouchableOpacity>
              )}
              {step.status === 'completed' && index < plan.steps.length - 1 && (
                <Text style={styles.expandIcon}>{activeStep === step.id ? '▲' : '▼'}</Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Checklist */}
          {activeStep === step.id && step.checklist.length > 0 && (
            <View style={styles.checklist}>
              {step.checklist.map((item) => {
                const severityBadge = getSeverityBadge(item.severity);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.checklistItem}
                    onPress={() => handleToggleChecklist(step.id, item.id, item.status)}>
                    <View style={styles.checklistHeader}>
                      <Text style={styles.checklistStatus}>{getStatusIcon(item.status)}</Text>
                      <View style={[styles.severityBadge, { backgroundColor: severityBadge.bg }]}>
                        <Text style={[styles.severityText, { color: severityBadge.color }]}>
                          {severityBadge.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.checklistTitle}>{item.title}</Text>
                    <Text style={styles.checklistDesc}>{item.description}</Text>
                    {item.recommendation && (
                      <View style={styles.recommendation}>
                        <Text style={styles.recommendationLabel}>💡 Recommendation:</Text>
                        <Text style={styles.recommendationText}>{item.recommendation}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      ))}

      {/* Complete Migration Button */}
      {plan.status === 'completed' && (
        <TouchableOpacity style={styles.completeButton} onPress={handleCompleteMigration}>
          <Text style={styles.completeButtonText}>🚀 Go Live to Production</Text>
        </TouchableOpacity>
      )}

      {plan.status === 'failed' && (
        <View style={styles.failedBanner}>
          <Text style={styles.failedBannerTitle}>⚠️ Critical Issues Detected</Text>
          <Text style={styles.failedBannerText}>
            Please resolve all critical failures before proceeding to production. Tap on each step
            above to review and fix checklist items.
          </Text>
          <TouchableOpacity style={styles.retryValidationButton} onPress={handleStartValidation}>
            <Text style={styles.retryValidationText}>Re-run Validation</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom spacing */}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  backLink: {
    color: '#6366F1',
    fontSize: 16,
    marginTop: 8,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
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
    backgroundColor: '#6366F1',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    color: '#6B7280',
  },
  criticalWarning: {
    color: '#EF4444',
    fontWeight: '600',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  validateButton: {
    marginLeft: 'auto',
    backgroundColor: '#6366F1',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  validateButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  stepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  stepCardActive: {
    borderWidth: 2,
    borderColor: '#6366F1',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  stepHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  stepHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  stepDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  statusIcon: {
    fontSize: 18,
  },
  expandIcon: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  runStepButton: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  runStepButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  checklist: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 16,
    paddingTop: 12,
    backgroundColor: '#F9FAFB',
  },
  checklistItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  checklistStatus: {
    fontSize: 16,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  checklistTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  checklistDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  recommendation: {
    marginTop: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    padding: 8,
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  recommendationText: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
  },
  completeButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  completeButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  failedBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  failedBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 8,
  },
  failedBannerText: {
    fontSize: 13,
    color: '#7F1D1D',
    marginBottom: 12,
    lineHeight: 18,
  },
  retryValidationButton: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  retryValidationText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  bottomSpacer: {
    height: 40,
  },
});
