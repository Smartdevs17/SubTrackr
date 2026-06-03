/**
 * AsyncStateView — single component that handles all four loading states.
 *
 * Wrap any async-driven content with this component and it will
 * automatically render the correct UI for each state:
 *
 *   idle    → renders nothing (or a custom idleFallback)
 *   loading → renders the skeleton prop (or a default spinner)
 *   error   → renders an error card with message, suggestions, and retry button
 *   success → renders children
 *
 * Example:
 *
 *   <AsyncStateView
 *     state={fetchState}
 *     onRetry={fetchSubscriptions}
 *     skeleton={<SubscriptionListSkeleton />}>
 *     <SubscriptionList />
 *   </AsyncStateView>
 */

import React, { ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LoadingState } from '../../types/loadingState';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AsyncStateViewProps {
  /** The LoadingState object from a store or local state. */
  state: LoadingState;
  /** Content to render when status === 'success'. */
  children: ReactNode;
  /**
   * Called when the user taps "Try Again".
   * If omitted the retry button is not shown.
   */
  onRetry?: () => void;
  /**
   * Skeleton UI shown while loading.
   * Falls back to a centred ActivityIndicator when not provided.
   */
  skeleton?: ReactNode;
  /**
   * Content shown when status === 'idle'.
   * Renders nothing by default.
   */
  idleFallback?: ReactNode;
  /**
   * Override the default error title.
   * @default "Something went wrong"
   */
  errorTitle?: string;
  /**
   * When true the error card is rendered inline (no ScrollView wrapper).
   * Useful inside FlatList headers or small card areas.
   * @default false
   */
  inline?: boolean;
  testID?: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ErrorCardProps {
  title: string;
  message: string;
  suggestions: string[];
  onRetry?: () => void;
  inline?: boolean;
}

const ErrorCard: React.FC<ErrorCardProps> = ({
  title,
  message,
  suggestions,
  onRetry,
  inline,
}) => {
  const content = (
    <View style={styles.errorCard}>
      <Text style={styles.errorIcon} accessibilityElementsHidden>
        ⚠️
      </Text>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorMessage}>{message}</Text>

      {suggestions.length > 0 && (
        <View style={styles.suggestionsBox}>
          <Text style={styles.suggestionsLabel}>What you can try:</Text>
          {suggestions.map((s, i) => (
            <Text key={i} style={styles.suggestion}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {onRetry && (
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again">
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (inline) return content;

  return (
    <ScrollView
      contentContainerStyle={styles.errorScrollContent}
      showsVerticalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const AsyncStateView: React.FC<AsyncStateViewProps> = ({
  state,
  children,
  onRetry,
  skeleton,
  idleFallback = null,
  errorTitle = 'Something went wrong',
  inline = false,
  testID,
}) => {
  switch (state.status) {
    case 'idle':
      return <>{idleFallback}</>;

    case 'loading':
      if (skeleton) return <>{skeleton}</>;
      return (
        <View style={styles.spinnerContainer} testID={testID ? `${testID}-loading` : undefined}>
          <ActivityIndicator
            size="large"
            color={colors.primary}
            accessibilityLabel="Loading"
          />
        </View>
      );

    case 'error':
      return (
        <View
          style={inline ? undefined : styles.errorContainer}
          testID={testID ? `${testID}-error` : undefined}>
          <ErrorCard
            title={errorTitle}
            message={state.errorMessage ?? 'An unexpected error occurred.'}
            suggestions={state.recoverySuggestions}
            onRetry={onRetry}
            inline={inline}
          />
        </View>
      );

    case 'success':
    default:
      return <>{children}</>;
  }
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  spinnerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  errorTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  errorMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  suggestionsBox: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  suggestionsLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  suggestion: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
});

export default AsyncStateView;
