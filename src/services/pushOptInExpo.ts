/**
 * Expo / Zustand wiring for the push opt-in flow.
 *
 * Kept apart from `pushOptInService.ts` so the flow itself stays free of
 * React Native imports and can be unit tested with fakes.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useNotificationPreferencesStore } from '../store/notificationPreferencesStore';
import { NOTIFICATION_TYPES } from '../types/notification';
import type { NotificationType } from '../types/notification';
import type { OsPushPermission, PushOptInGateway, PushPreferenceSink } from './pushOptInService';

function isPushSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Expo notifications implementation of the opt-in gateway. */
export function createExpoPushOptInGateway(): PushOptInGateway {
  return {
    isSupported: isPushSupported,

    async getPermission(): Promise<OsPushPermission> {
      if (!isPushSupported()) return { status: 'undetermined', canAskAgain: false };
      const settings = await Notifications.getPermissionsAsync();
      return { status: settings.status, canAskAgain: settings.canAskAgain };
    },

    async requestPermission(): Promise<OsPushPermission> {
      if (!isPushSupported()) return { status: 'undetermined', canAskAgain: false };
      const settings = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      return { status: settings.status, canAskAgain: settings.canAskAgain };
    },

    async getDeviceToken(): Promise<string | null> {
      if (!isPushSupported()) return null;
      try {
        const token = await Notifications.getDevicePushTokenAsync();
        const data = (token as { data?: unknown } | null)?.data;
        return data === undefined || data === null ? null : String(data);
      } catch {
        // A token can only be minted while the permission is granted; a
        // failure here is not fatal to the opt-in itself.
        return null;
      }
    },
  };
}

/** Preferences-store implementation of the opt-in sink. */
export function createStorePushPreferenceSink(): PushPreferenceSink {
  return {
    pushEnabledTypes(): NotificationType[] {
      const state = useNotificationPreferencesStore.getState();
      return NOTIFICATION_TYPES.filter((type) => {
        const preference = state.preferences.types[type];
        return preference ? preference.channels.push : false;
      });
    },

    setPushChannel(type: NotificationType, enabled: boolean): void {
      useNotificationPreferencesStore.getState().setChannelPreference(type, 'push', enabled);
    },
  };
}
