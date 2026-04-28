import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSandboxStore } from '../store/sandboxStore';
import { SandboxEnvironment, DeveloperOnboardingStep } from '../types/sandbox';
import {
  EnvironmentBadge,
  StatCard,
  OnboardingStep,
  QuickAction,
} from '../components/developer/DeveloperComponents';
import { apiKeyService } from '../services/sandbox/apiKeyService';

const DeveloperPortalScreen: React.FC = () => {
  const {
    sandboxConfig,
    developerProfile,
    apiKeys,
    usageStats,
    testSubscriptions,
    integrationGuides,
    initializeSandbox,
    switchEnvironment,
    createDeveloperProfile,
    completeOnboardingStep,
    generateApiKey,
    resetTestData,
  } = useSandboxStore();

  const [showOnboarding, setShowOnboarding] = useState(!developerProfile);
  const [profileForm, setProfileForm] = useState({
    name: '',
    email: '',
    company: '',
  });
  const [newKeyName, setNewKeyName] = useState('');

  useEffect(() => {
    initializeSandbox();
  }, [initializeSandbox]);

  const handleCreateProfile = async () => {
    if (!profileForm.name || !profileForm.email) {
      Alert.alert('Required fields', 'Name and email are required.');
      return;
    }
    await createDeveloperProfile(profileForm.name, profileForm.email, profileForm.company || undefined);
    await completeOnboardingStep(DeveloperOnboardingStep.CREATE_ACCOUNT);
    setShowOnboarding(false);
  };

  const handleGenerateKey = async () => {
    const name = newKeyName || 'Default Key';
    try {
      const key = await generateApiKey(name);
      Alert.alert('API Key Generated', `Your new API key:\n\n${key}\n\nCopy it now, it won't be shown again.`);
      setNewKeyName('');
    } catch {
      Alert.alert('Error', 'Failed to generate API key.');
    }
  };

  const handleResetData = () => {
    Alert.alert('Reset Test Data', 'This will reset all sandbox test data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetTestData },
    ]);
  };

  const completedGuides = integrationGuides.filter((g) => g.isCompleted).length;
  const onboardingProgress = developerProfile
    ? Math.round(
        ((developerProfile.completedSteps?.length || 0) /
          Object.keys(DeveloperOnboardingStep).length) *
          100
      )
    : 0;

  if (showOnboarding && !developerProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Developer Portal</Text>
            <Text style={styles.subtitle}>
              Build integrations with SubTrackr's powerful subscription management API
            </Text>
          </View>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Get Started</Text>
            <Text style={styles.bodyText}>
              Create your developer account to access the sandbox environment, generate API keys,
              and start building integrations.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={colors.textSecondary}
              value={profileForm.name}
              onChangeText={(name) => setProfileForm((f) => ({ ...f, name }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={colors.textSecondary}
              value={profileForm.email}
              onChangeText={(email) => setProfileForm((f) => ({ ...f, email }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Company (optional)"
              placeholderTextColor={colors.textSecondary}
              value={profileForm.company}
              onChangeText={(company) => setProfileForm((f) => ({ ...f, company }))}
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateProfile}>
              <Text style={styles.primaryButtonText}>Create Developer Account</Text>
            </TouchableOpacity>
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>What you'll get</Text>
            <View style={styles.featureList}>
              {[
                { icon: '🧪', text: 'Isolated sandbox environment' },
                { icon: '🔑', text: 'API key management' },
                { icon: '📊', text: 'Usage analytics & tracking' },
                { icon: '📖', text: 'Integration guides & documentation' },
                { icon: '🎯', text: 'Test data generation' },
                { icon: '🚀', text: 'Easy go-live transition' },
              ].map((feature) => (
                <View key={feature.text} style={styles.featureItem}>
                  <Text style={styles.featureIcon}>{feature.icon}</Text>
                  <Text style={styles.featureText}>{feature.text}</Text>
                </View>
              ))}
            </View>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Developer Portal</Text>
          <Text style={styles.subtitle}>
            Welcome back, {developerProfile?.name || 'Developer'}
          </Text>
        </View>

        <View style={styles.envBar}>
          {[SandboxEnvironment.DEVELOPMENT, SandboxEnvironment.STAGING, SandboxEnvironment.PRODUCTION].map(
            (env) => (
              <EnvironmentBadge
                key={env}
                environment={env}
                isActive={sandboxConfig.environment === env}
                onPress={() => switchEnvironment(env)}
              />
            )
          )}
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="API Keys" value={apiKeys.length} />
          <StatCard label="Test Subs" value={testSubscriptions.length} />
          <StatCard
            label="API Calls"
            value={usageStats?.totalRequests?.toLocaleString() || '0'}
          />
          <StatCard
            label="Success Rate"
            value={
              usageStats
                ? `${Math.round(
                    (usageStats.successfulRequests / Math.max(usageStats.totalRequests, 1)) * 100
                  )}%`
                : '0%'
            }
          />
        </View>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Onboarding Progress</Text>
            <Text style={styles.sectionMeta}>{onboardingProgress}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${onboardingProgress}%` }]} />
          </View>
          {Object.values(DeveloperOnboardingStep).map((step, index) => (
            <OnboardingStep
              key={step}
              stepNumber={index + 1}
              title={step.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              description={`Step ${index + 1} of the onboarding process`}
              isCompleted={developerProfile?.completedSteps?.includes(step) || false}
              isCurrent={String(developerProfile?.onboardingStep) === String(step)}
            />
          ))}
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>API Keys</Text>
            <Text style={styles.sectionMeta}>{apiKeys.length} keys</Text>
          </View>
          {apiKeys.length === 0 ? (
            <Text style={styles.emptyText}>No API keys yet. Generate one to get started.</Text>
          ) : (
            apiKeys.slice(0, 3).map((key) => (
              <View key={key.id} style={styles.keyRow}>
                <View style={styles.keyInfo}>
                  <Text style={styles.keyName}>{key.name}</Text>
                  <Text style={styles.keyValue}>{apiKeyService.maskApiKey(key.key)}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: key.status === 'active' ? colors.success : colors.error },
                  ]}>
                  <Text style={styles.statusText}>{key.status}</Text>
                </View>
              </View>
            ))
          )}
          <View style={styles.keyForm}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Key name"
              placeholderTextColor={colors.textSecondary}
              value={newKeyName}
              onChangeText={setNewKeyName}
            />
            <TouchableOpacity style={styles.secondaryButton} onPress={handleGenerateKey}>
              <Text style={styles.secondaryButtonText}>Generate</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <QuickAction
            icon="📊"
            title="Sandbox Dashboard"
            description="View test data and sandbox metrics"
            onPress={() => {}}
          />
          <QuickAction
            icon="🔑"
            title="Manage API Keys"
            description="Create, revoke, and manage your API keys"
            onPress={() => {}}
          />
          <QuickAction
            icon="📖"
            title="Integration Guides"
            description="Step-by-step guides for common integrations"
            onPress={() => {}}
          />
          <QuickAction
            icon="📚"
            title="API Documentation"
            description="Complete API reference documentation"
            onPress={() => {}}
          />
          <QuickAction
            icon="🔄"
            title="Reset Test Data"
            description="Reset sandbox to default test data"
            onPress={handleResetData}
          />
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Integration Guides</Text>
            <Text style={styles.sectionMeta}>
              {completedGuides}/{integrationGuides.length}
            </Text>
          </View>
          {integrationGuides.slice(0, 4).map((guide) => (
            <View key={guide.id} style={styles.guideRow}>
              <View style={styles.guideInfo}>
                <Text style={styles.guideTitle}>{guide.title}</Text>
                <Text style={styles.guideMeta}>
                  {guide.difficulty} · {guide.estimatedTime}
                </Text>
              </View>
              {guide.isCompleted && (
                <Text style={styles.completedBadge}>✓</Text>
              )}
            </View>
          ))}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Test Subscriptions</Text>
          {testSubscriptions.slice(0, 5).map((sub) => (
            <View key={sub.id} style={styles.subRow}>
              <View style={styles.subInfo}>
                <Text style={styles.subName}>{sub.name}</Text>
                <Text style={styles.subMeta}>
                  ${sub.price}/{sub.billingCycle}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      sub.status === 'active'
                        ? colors.success
                        : sub.status === 'paused'
                        ? colors.warning
                        : colors.error,
                  },
                ]}>
                <Text style={styles.statusText}>{sub.status}</Text>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  envBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.accent,
  },
  bodyText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  featureList: {
    gap: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureIcon: {
    fontSize: 20,
  },
  featureText: {
    ...typography.body,
    color: colors.text,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  keyInfo: {
    flex: 1,
    gap: 2,
  },
  keyName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  keyValue: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  keyForm: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.round,
  },
  statusText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  guideInfo: {
    flex: 1,
    gap: 2,
  },
  guideTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  guideMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  completedBadge: {
    color: colors.success,
    fontSize: 18,
    fontWeight: '700',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subInfo: {
    flex: 1,
    gap: 2,
  },
  subName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  subMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

export default DeveloperPortalScreen;
