/**
 * Lightweight Jest mock for expo-notifications.
 *
 * The native notifications module crashes Jest workers in the Node test
 * environment. This mock exposes the API surface used by
 * src/services/notificationService.ts and src/hooks/useNotifications.ts,
 * defaulting to granted permissions and successful scheduling.
 *
 * Tests that need specific behavior should call
 * `jest.mock('expo-notifications', ...)` in their own file to override it.
 */

const grantedPermissions = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
};

module.exports = {
  __esModule: true,
  AndroidImportance: {
    MAX: 5,
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
    MIN: 1,
    NONE: 0,
  },
  AndroidNotificationVisibility: {
    PUBLIC: 1,
    PRIVATE: 2,
    SECRET: 3,
  },
  PermissionStatus: {
    GRANTED: 'granted',
    UNDETERMINED: 'undetermined',
    DENIED: 'denied',
  },
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 'timeInterval',
    DATE: 'date',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    YEARLY: 'yearly',
    CALENDAR: 'calendar',
  },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve(grantedPermissions)),
  requestPermissionsAsync: jest.fn(() => Promise.resolve(grantedPermissions)),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('mock-notification-request-id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'expo-push-token' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  dismissAllNotificationsAsync: jest.fn(() => Promise.resolve()),
};
