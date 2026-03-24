import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { useSubscriptionStore } from '../store';
import {
  attachNotificationResponseListeners,
  getPermissionStatus,
  requestNotificationPermissions,
  syncRenewalReminders,
  navigateToSubscriptionFromNotification,
} from '../services/notificationService';

const FIRST_LAUNCH_PROMPT_KEY = '@subtrackr_notifications_prompt_v1';

export function useNotifications(): {
  permissionStatus: Notifications.PermissionStatus | null;
  refreshPermission: () => Promise<void>;
} {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(
    null
  );

  const refreshPermission = useCallback(async () => {
    setPermissionStatus(await getPermissionStatus());
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  /** First app launch: ask for notification permission once, then keep schedules in sync. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const alreadyPrompted = await AsyncStorage.getItem(FIRST_LAUNCH_PROMPT_KEY);
      if (!alreadyPrompted) {
        await requestNotificationPermissions();
        if (!cancelled) {
          await AsyncStorage.setItem(FIRST_LAUNCH_PROMPT_KEY, '1');
        }
      } else {
        await getPermissionStatus();
      }

      if (!cancelled) {
        await refreshPermission();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void syncRenewalReminders(subscriptions);
  }, [subscriptions]);

  useEffect(() => {
    const remove = attachNotificationResponseListeners();

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as
        | { subscriptionId?: string }
        | undefined;
      if (data?.subscriptionId) {
        navigateToSubscriptionFromNotification(data.subscriptionId);
      }
    });

    return remove;
  }, []);

  return { permissionStatus, refreshPermission };
}
