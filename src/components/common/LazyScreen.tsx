import React, { ComponentType, Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { colors, spacing, typography } from '../../utils/constants';

interface LazyScreenProps {
  component: React.LazyExoticComponent<ComponentType<any>>;
  fallback?: React.ReactNode;
}

const DefaultFallback = () => (
  <View style={styles.container}>
    <ActivityIndicator size="large" color={colors.primary} />
    <Text style={styles.text}>Loading...</Text>
  </View>
);

const ErrorFallback = ({ error, retry }: { error: Error; retry: () => void }) => (
  <View style={styles.container}>
    <Text style={styles.errorText}>Failed to load</Text>
    <Text style={styles.errorDetail}>{error.message}</Text>
    <Text style={styles.retryText} onPress={retry}>
      Tap to retry
    </Text>
  </View>
);

interface LazyScreenState {
  error: Error | null;
}

class LazyScreenInner extends React.Component<{ children: React.ReactNode }, LazyScreenState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} retry={this.handleRetry} />;
    }
    return <>{this.props.children}</>;
  }
}

export const LazyScreen: React.FC<LazyScreenProps> = ({ component: Component, fallback }) => {
  return (
    <LazyScreenInner>
      <Suspense fallback={fallback ?? <DefaultFallback />}>
        <Component />
      </Suspense>
    </LazyScreenInner>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  text: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.h3,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  errorDetail: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
});
