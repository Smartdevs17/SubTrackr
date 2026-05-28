import React, { ReactNode, useEffect } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, spacing, typography } from '../../utils/constants';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

interface ScreenTemplateProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  analyticsName?: string;
  rightAction?: ReactNode;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const trackScreenView = (screenName?: string): void => {
  if (screenName) {
    console.info('[analytics] screen_view', { screenName });
  }
};

export const ScreenTemplate: React.FC<ScreenTemplateProps> = ({
  title,
  subtitle,
  children,
  analyticsName,
  rightAction,
  isLoading = false,
  error,
  onRetry,
  style,
  contentStyle,
  testID,
}) => {
  useEffect(() => {
    trackScreenView(analyticsName ?? title);
  }, [analyticsName, title]);

  return (
    <SafeAreaView style={[styles.container, style]} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {rightAction}
      </View>
      <View style={[styles.content, contentStyle]}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorText}>{error}</Text>
            {onRetry ? <Button title="Try again" onPress={onRetry} variant="outline" /> : null}
          </View>
        ) : (
          children
        )}
      </View>
    </SafeAreaView>
  );
};

interface ListScreenProps<T> extends Omit<ScreenTemplateProps, 'children'> {
  data: T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  emptyTitle: string;
  emptyMessage: string;
  emptyActionText?: string;
  onEmptyAction?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function ListScreen<T>({
  data,
  renderItem,
  keyExtractor,
  emptyTitle,
  emptyMessage,
  emptyActionText,
  onEmptyAction,
  refreshing = false,
  onRefresh,
  ...templateProps
}: ListScreenProps<T>) {
  return (
    <ScreenTemplate {...templateProps}>
      <ScrollView
        style={styles.scroll}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          ) : undefined
        }>
        {data.length === 0 ? (
          <EmptyState
            icon="[]"
            title={emptyTitle}
            message={emptyMessage}
            actionText={emptyActionText}
            onAction={onEmptyAction}
          />
        ) : (
          data.map((item, index) => <View key={keyExtractor(item, index)}>{renderItem(item, index)}</View>)
        )}
      </ScrollView>
    </ScreenTemplate>
  );
}

export const DetailScreen: React.FC<ScreenTemplateProps> = ({ children, ...templateProps }) => (
  <ScreenTemplate {...templateProps}>
    <ScrollView style={styles.scroll}>{children}</ScrollView>
  </ScreenTemplate>
);

export const FormScreen: React.FC<ScreenTemplateProps> = ({ children, ...templateProps }) => (
  <ScreenTemplate {...templateProps}>
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  </ScreenTemplate>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    paddingRight: spacing.md,
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
  content: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
