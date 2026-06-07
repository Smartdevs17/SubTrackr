import React from 'react';
import {
  ActivityIndicator,
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  InteractionManager,
} from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from './constants';

export function lazyWithRetry<T extends React.ComponentType<Record<string, unknown>>>(
  componentImport: () => Promise<{ default: T }>,
  retries = 3,
  delay = 1500
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    componentImport().catch((_error) => {
      return new Promise<{ default: T }>((resolve, reject) => {
        let attempts = 0;
        const executeAttempt = () => {
          attempts++;
          componentImport()
            .then(resolve)
            .catch((err) => {
              if (attempts >= retries) {
                reject(err);
              } else {
                setTimeout(executeAttempt, delay);
              }
            });
        };
        setTimeout(executeAttempt, delay);
      });
    })
  );
}

export function SuspenseLoadingFallback() {
  return (
    <View style={styles.loadingContainer} testID="lazy-loading-fallback">
      <View style={styles.card}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Preparing premium modules...</Text>
      </View>
    </View>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class LazyErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[LazyErrorBoundary] Caught dynamic import failure:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer} testID="lazy-error-fallback">
          <View style={styles.errorCard}>
            <Text style={styles.errorEmoji}>📡</Text>
            <Text style={styles.errorTitle}>Connection Interrupted</Text>
            <Text style={styles.errorSubtitle}>
              We couldn't load this section of the app. Check your connection and try again.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

export function lazyScreen<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
) {
  const LazyComponent = lazyWithRetry(importFn);

  const WrappedScreen = (props: React.ComponentPropsWithRef<T>) => (
    <LazyErrorBoundary>
      <React.Suspense fallback={<SuspenseLoadingFallback />}>
        <LazyComponent {...props} />
      </React.Suspense>
    </LazyErrorBoundary>
  );

  WrappedScreen.displayName = `lazyScreen(${importFn.toString().replace(/\s+/g, ' ')})`;
  return WrappedScreen;
}

const prefetchedModules = new Set<string>();

export function prefetchModule(name: string, importFn: () => Promise<unknown>) {
  if (prefetchedModules.has(name)) return;

  const idleRunner =
    (global as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb: () => void) => setTimeout(cb, 1200));

  idleRunner(() => {
    InteractionManager.runAfterInteractions(() => {
      importFn()
        .then(() => {
          prefetchedModules.add(name);
          // eslint-disable-next-line no-console
          console.log(`[Prefetch] Successfully cached chunk: ${name}`);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[Prefetch] Failed to cache chunk ${name}:`, err);
        });
    });
  });
}
export { prefetchedModules };

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.md,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorCard: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error + '40',
    ...shadows.lg,
    maxWidth: 320,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  errorTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  retryButtonText: {
    color: colors.onPrimary,
    fontWeight: 'bold',
    fontSize: typography.button.fontSize,
  },
});
