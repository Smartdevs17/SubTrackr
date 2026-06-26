import React, { ComponentType, Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../utils/constants';

/**
 * Lazy screen loader for differential bytecode / on-demand chunk loading.
 *
 * Critical-path screens (Home, SubscriptionDetail, Analytics, Payment) are
 * imported eagerly in AppNavigator so their bytecode is in the initial bundle.
 * Everything else is wrapped with `lazyScreen`, which defers evaluation behind a
 * dynamic `import()` — Metro emits those modules as separately-loadable chunks,
 * keeping startup parse/compile work and peak memory proportional to the screens
 * actually visited.
 *
 * Resilience: if a chunk fails to load (e.g. bytecode chunk unavailable after an
 * OTA mismatch), the error boundary shows a retry that re-attempts the import —
 * the safe fallback to fetching the module from the full bundle.
 *
 * Jank: the Suspense fallback is a trivial spinner, so swapping it in/out costs
 * far less than a 16ms frame budget.
 */

// Screens declare their own prop types; the navigator passes route props
// through, so the wrapper is intentionally prop-agnostic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;
type ScreenModuleFactory = () => Promise<{ default: AnyComponent }>;

export const ScreenFallback = (): React.ReactElement => (
  <View style={styles.center} testID="screen-loading">
    <ActivityIndicator size="large" color={colors.primary} />
  </View>
);

interface BoundaryProps {
  children: React.ReactNode;
  onRetry: () => void;
}

class ChunkErrorBoundary extends React.Component<BoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.center} testID="screen-load-error">
          <Text style={styles.errorText}>This screen could not be loaded.</Text>
          <TouchableOpacity
            testID="screen-load-retry"
            style={styles.retryButton}
            onPress={() => {
              this.setState({ hasError: false });
              this.props.onRetry();
            }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

/**
 * Wrap a dynamic screen import into a navigator-ready component. Use
 * `namedLazyScreen` when the screen is a named (not default) export.
 */
export function lazyScreen(factory: ScreenModuleFactory): AnyComponent {
  const Wrapped: AnyComponent = (props) => {
    // `attempt` recreates the lazy component on retry — React.lazy caches a
    // rejected import, so a fresh instance is required to re-fetch the chunk.
    const [attempt, setAttempt] = React.useState(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const LazyComponent = React.useMemo(() => React.lazy(factory), [attempt]);
    return (
      <ChunkErrorBoundary key={attempt} onRetry={() => setAttempt((a) => a + 1)}>
        <Suspense fallback={<ScreenFallback />}>
          <LazyComponent {...props} />
        </Suspense>
      </ChunkErrorBoundary>
    );
  };
  Wrapped.displayName = 'LazyScreen';
  return Wrapped;
}

/** Lazy-load a screen exported under a named export. */
export function namedLazyScreen<M>(
  importer: () => Promise<M>,
  pick: (module: M) => AnyComponent
): AnyComponent {
  return lazyScreen(() => importer().then((module) => ({ default: pick(module) })));
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  errorText: {
    color: colors.textSecondary,
    marginBottom: 12,
    fontSize: 15,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
});
