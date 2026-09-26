import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useSandboxStore } from '../store/sandboxStore';
import { useThemeColors } from '../hooks/useThemeColors';
import { IntegrationStep } from '../types/sandbox';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function IntegrationGuideDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { selectedGuide } = useSandboxStore();

  if (!selectedGuide) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No guide selected</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner':
        return colors.status.success;
      case 'intermediate':
        return colors.status.warning;
      case 'advanced':
        return colors.status.error;
      default:
        return colors.textSecondary;
    }
  };

  const renderStep = (step: IntegrationStep, index: number) => (
    <View key={step.id} style={styles.stepCard}>
      <View style={styles.stepHeader}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>{index + 1}</Text>
        </View>
        <Text style={styles.stepTitle}>{step.title}</Text>
      </View>
      <Text style={styles.stepContent}>{step.content}</Text>
      {step.codeExample && (
        <View style={styles.codeContainer}>
          <View style={styles.codeHeader}>
            <Text style={styles.codeLanguage}>{step.language || 'code'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText} selectable>
              {step.codeExample}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <View style={styles.headerMeta}>
          <Text style={styles.category}>{selectedGuide.category}</Text>
          <View
            style={[
              styles.difficultyBadge,
              { backgroundColor: getDifficultyColor(selectedGuide.difficulty) + '20' },
            ]}>
            <Text
              style={[
                styles.difficultyText,
                { color: getDifficultyColor(selectedGuide.difficulty) },
              ]}>
              {selectedGuide.difficulty}
            </Text>
          </View>
        </View>
        <Text style={styles.title}>{selectedGuide.title}</Text>
        <Text style={styles.description}>{selectedGuide.description}</Text>
        <View style={styles.metaInfo}>
          <Text style={styles.metaItem}>⏱ {selectedGuide.estimatedTime}</Text>
          <Text style={styles.metaItem}>📝 {selectedGuide.steps.length} steps</Text>
        </View>
      </View>

      <View style={styles.tagContainer}>
        {selectedGuide.tags.map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>

      <View style={styles.stepsContainer}>
        <Text style={styles.stepsTitle}>Steps</Text>
        {selectedGuide.steps.map((step, index) => renderStep(step, index))}
      </View>

      <View style={styles.completionCard}>
        <Text style={styles.completionIcon}>🎉</Text>
        <Text style={styles.completionTitle}>Ready to Integrate?</Text>
        <Text style={styles.completionText}>
          You've learned how to {selectedGuide.title.toLowerCase()}. Start building your integration
          today!
        </Text>
        <TouchableOpacity style={styles.startButton}>
          <Text style={styles.startButtonText}>Start Building</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background.primary,
    },
    contentContainer: {
      padding: 16,
      paddingBottom: 32,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background.primary,
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    backButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    backButtonText: {
      color: colors.onPrimary,
      fontWeight: '600',
      fontSize: 16,
    },
    header: {
      marginBottom: 20,
    },
    headerMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    category: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    difficultyBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    difficultyText: {
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.text.primary,
      marginBottom: 8,
    },
    description: {
      fontSize: 16,
      color: colors.textSecondary,
      lineHeight: 24,
      marginBottom: 16,
    },
    metaInfo: {
      flexDirection: 'row',
    },
    metaItem: {
      fontSize: 14,
      color: colors.textSecondary,
      marginRight: 20,
    },
    tagContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 24,
    },
    tag: {
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 16,
    },
    tagText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    stepsContainer: {
      marginBottom: 24,
    },
    stepsTitle: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.text.primary,
      marginBottom: 16,
    },
    stepCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      shadowColor: colors.overlay,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    stepNumber: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    stepNumberText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: 'bold',
    },
    stepTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text.primary,
      flex: 1,
    },
    stepContent: {
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: 12,
    },
    codeContainer: {
      backgroundColor: colors.background.secondary,
      borderRadius: 8,
      overflow: 'hidden',
    },
    codeHeader: {
      backgroundColor: colors.background.card,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    codeLanguage: {
      fontSize: 12,
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    codeText: {
      fontSize: 13,
      fontFamily: 'monospace',
      color: colors.text.primary,
      padding: 12,
      lineHeight: 20,
    },
    completionCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      alignItems: 'center',
      shadowColor: colors.overlay,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    completionIcon: {
      fontSize: 48,
      marginBottom: 16,
    },
    completionTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: colors.text.primary,
      marginBottom: 8,
    },
    completionText: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 20,
    },
    startButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 32,
      paddingVertical: 14,
      borderRadius: 10,
    },
    startButtonText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
