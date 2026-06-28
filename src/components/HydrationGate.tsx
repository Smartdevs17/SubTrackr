/**
 * HydrationGate.tsx
 *
 * Wraps the app and blocks rendering until all *critical* stores have finished
 * rehydrating from AsyncStorage. This eliminates the flash of null/default state
 * that occurs between mount and when persist middleware finishes its async read.
 *
 * Critical stores watched:
 *  - useAuthStore         (authentication state)
 *  - useSettingsStore     (preferred currency, notifications)
 *  - useSubscriptionStore (subscription list)
 *
 * Non-critical stores (dunning, invoices, wallet, etc.) are intentionally NOT
 * awaited here — they hydrate in the background after the app is interactive,
 * keeping cold-start hydration well under the 200ms performance budget.
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSubscriptionStore } from '../store/subscriptionStore';

interface HydrationGateProps {
  children: React.ReactNode;
}

export function HydrationGate({ children }: HydrationGateProps) {
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    // Check if all three critical stores are already hydrated (synchronous fast-path)
    const check = () => {
      const authHydrated = useAuthStore.persist.hasHydrated();
      const settingsHydrated = useSettingsStore.persist.hasHydrated();
      const subsHydrated = useSubscriptionStore.persist.hasHydrated();
      return authHydrated && settingsHydrated && subsHydrated;
    };

    if (check()) {
      setHydrated(true);
      return;
    }

    // Track how many of the three stores have finished
    let doneCount = 0;
    const total = 3;

    const onOneDone = () => {
      doneCount += 1;
      if (doneCount >= total && !cancelled) {
        setHydrated(true);
      }
    };

    // Register finish callbacks; each unsubscribes itself after firing once
    const unsubAuth = useAuthStore.persist.onFinishHydration(onOneDone);
    const unsubSettings = useSettingsStore.persist.onFinishHydration(onOneDone);
    const unsubSubs = useSubscriptionStore.persist.onFinishHydration(onOneDone);

    // Safety: if a store was already hydrated before we registered, count it now
    if (useAuthStore.persist.hasHydrated()) onOneDone();
    if (useSettingsStore.persist.hasHydrated()) onOneDone();
    if (useSubscriptionStore.persist.hasHydrated()) onOneDone();

    return () => {
      cancelled = true;
      unsubAuth();
      unsubSettings();
      unsubSubs();
    };
  }, []);

  if (!hydrated) {
    return (
      <View style={styles.splash} testID="hydration-gate-splash">
        <ActivityIndicator size="large" color="#6366f1" accessibilityLabel="Loading app data" />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a', // matches app dark background
  },
});
