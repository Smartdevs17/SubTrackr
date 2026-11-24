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

// Screen components have route-specific prop types, so this wrapper must stay prop-agnostic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyScreen<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  options: { displayName?: string } = {}
) {
  const LazyComponent = lazyWithRetry(importFn);

  const WrappedScreen = (props: React.ComponentPropsWithRef<T>) => (
    <LazyErrorBoundary>
      <React.Suspense fallback={<SuspenseLoadingFallback />}>
        <LazyComponent {...props} />
      </React.Suspense>
    </LazyErrorBoundary>
  );

  WrappedScreen.displayName =
    options.displayName ?? `lazyScreen(${importFn.toString().replace(/\s+/g, ' ')})`;
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

// ─── Route-level dynamic stack loading (issue #2212) ─────────────────────────
//
// Unlike lazyScreen (which lazy-loads individual screen components), lazyStack
// lazy-loads an entire navigator stack. This keeps the initial JS bundle lean:
// only the HomeTab stack loads at startup; every other stack is fetched on
// first navigation to its tab, or prefetched after the first frame.
//
// Usage:
//   const SettingsStack = lazyStack(
//     () => import('./modules/SettingsStack').then(m => ({ default: m.SettingsStack })),
//     { displayName: 'LazyStack(Settings)' }
//   );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyStack<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T } | Record<string, T>>,
  options: { displayName?: string; exportName?: string } = {}
) {
  const resolvedImport = (): Promise<{ default: T }> =>
    importFn().then((mod) => {
      if ('default' in mod && mod.default) {
        return mod as { default: T };
      }
      if (options.exportName && options.exportName in mod) {
        return { default: (mod as Record<string, T>)[options.exportName] };
      }
      const first = Object.values(mod).find(
        (v): v is T => typeof v === 'function' || (typeof v === 'object' && v !== null)
      );
      if (first) return { default: first };
      throw new Error('[lazyStack] Module has no usable component export');
    });

  const LazyStackComponent = lazyWithRetry(resolvedImport as () => Promise<{ default: T }>);

  const WrappedStack = (props: React.ComponentPropsWithRef<T>) => (
    <LazyErrorBoundary>
      <React.Suspense fallback={<SuspenseLoadingFallback />}>
        <LazyStackComponent {...props} />
      </React.Suspense>
    </LazyErrorBoundary>
  );

  WrappedStack.displayName =
    options.displayName ?? `lazyStack(${importFn.toString().replace(/\s+/g, ' ')})`;

  return WrappedStack;
}

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
