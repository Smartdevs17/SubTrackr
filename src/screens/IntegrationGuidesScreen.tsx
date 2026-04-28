import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSandboxStore } from '../store/sandboxStore';
import { IntegrationGuideCategory } from '../types/sandbox';

const CATEGORY_LABELS: Record<IntegrationGuideCategory, { label: string; icon: string }> = {
  [IntegrationGuideCategory.GETTING_STARTED]: { label: 'Getting Started', icon: '🚀' },
  [IntegrationGuideCategory.SUBSCRIPTION_MANAGEMENT]: {
    label: 'Subscriptions',
    icon: '🔄',
  },
  [IntegrationGuideCategory.PAYMENT_PROCESSING]: { label: 'Payments', icon: '💳' },
  [IntegrationGuideCategory.WEBHOOK_INTEGRATION]: { label: 'Webhooks', icon: '🔔' },
  [IntegrationGuideCategory.ANALYTICS_REPORTING]: { label: 'Analytics', icon: '📊' },
  [IntegrationGuideCategory.ADVANCED_FEATURES]: { label: 'Advanced', icon: '⚡' },
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: colors.success,
  intermediate: colors.warning,
  advanced: colors.error,
};

const IntegrationGuidesScreen: React.FC = () => {
  const { integrationGuides, markGuideCompleted } = useSandboxStore();
  const [selectedCategory, setSelectedCategory] = useState<IntegrationGuideCategory | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const filteredGuides = selectedCategory
    ? integrationGuides.filter((g) => g.category === selectedCategory)
    : integrationGuides;

  const completedCount = integrationGuides.filter((g) => g.isCompleted).length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Integration Guides</Text>
          <Text style={styles.subtitle}>
            Step-by-step guides to build integrations with SubTrackr
          </Text>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {completedCount}/{integrationGuides.length} completed
            </Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(
                      (completedCount / Math.max(integrationGuides.length, 1)) * 100
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryBar}>
          <TouchableOpacity
            style={[styles.categoryChip, !selectedCategory && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(null)}>
            <Text style={[styles.categoryChipText, !selectedCategory && styles.categoryChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {Object.entries(CATEGORY_LABELS).map(([key, { label, icon }]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.categoryChip,
                selectedCategory === key && styles.categoryChipActive,
              ]}
              onPress={() =>
                setSelectedCategory(
                  selectedCategory === key ? null : (key as IntegrationGuideCategory)
                )
              }>
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === key && styles.categoryChipTextActive,
                ]}>
                {icon} {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filteredGuides.map((guide) => (
          <Card key={guide.id} style={styles.guideCard}>
            <TouchableOpacity
              style={styles.guideHeader}
              onPress={() => setExpandedGuide(expandedGuide === guide.id ? null : guide.id)}>
              <View style={styles.guideTitleRow}>
                <Text style={styles.guideIcon}>
                  {CATEGORY_LABELS[guide.category as IntegrationGuideCategory]?.icon || '📖'}
                </Text>
                <View style={styles.guideTitleContent}>
                  <Text style={styles.guideTitle}>{guide.title}</Text>
                  <Text style={styles.guideDescription}>{guide.description}</Text>
                </View>
              </View>
              <View style={styles.guideMeta}>
                <View
                  style={[
                    styles.difficultyBadge,
                    { backgroundColor: DIFFICULTY_COLORS[guide.difficulty] || colors.textSecondary },
                  ]}>
                  <Text style={styles.difficultyText}>{guide.difficulty}</Text>
                </View>
                <Text style={styles.timeEstimate}>{guide.estimatedTime}</Text>
                {guide.isCompleted && <Text style={styles.completedIcon}>✓</Text>}
              </View>
            </TouchableOpacity>

            {expandedGuide === guide.id && (
              <View style={styles.guideContent}>
                <View style={styles.tagsRow}>
                  {guide.tags.map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.stepsTitle}>Steps</Text>
                {guide.steps.map((step, index) => (
                  <View key={index} style={styles.stepCard}>
                    <TouchableOpacity
                      style={styles.stepHeader}
                      onPress={() =>
                        setExpandedStep(expandedStep === index ? null : index)
                      }>
                      <View style={styles.stepNumber}>
                        <Text style={styles.stepNumberText}>{index + 1}</Text>
                      </View>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.expandIcon}>
                        {expandedStep === index ? '▼' : '▶'}
                      </Text>
                    </TouchableOpacity>
                    {expandedStep === index && (
                      <View style={styles.stepContent}>
                        <Text style={styles.stepText}>{step.content}</Text>
                        {step.codeExample && (
                          <View style={styles.codeBlock}>
                            <Text style={styles.codeText}>{step.codeExample}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                ))}

                {!guide.isCompleted && (
                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => markGuideCompleted(guide.id)}>
                    <Text style={styles.completeButtonText}>Mark as Completed</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Card>
        ))}
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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  progressText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  categoryBar: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: colors.text,
  },
  guideCard: {
    gap: spacing.md,
  },
  guideHeader: {
    gap: spacing.sm,
  },
  guideTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  guideIcon: {
    fontSize: 24,
  },
  guideTitleContent: {
    flex: 1,
  },
  guideTitle: {
    ...typography.h3,
    color: colors.text,
  },
  guideDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  guideMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  difficultyBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.round,
  },
  difficultyText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  timeEstimate: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  completedIcon: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 16,
  },
  guideContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stepsTitle: {
    ...typography.h3,
    color: colors.text,
  },
  stepCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  stepTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
  expandIcon: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  stepContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  stepText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  codeBlock: {
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: {
    ...typography.caption,
    color: colors.text,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  completeButton: {
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  completeButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
});

export default IntegrationGuidesScreen;
