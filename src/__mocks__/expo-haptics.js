/**
 * Lightweight Jest mock for expo-haptics.
 *
 * The native haptics module crashes Jest workers in the Node test
 * environment, so all calls are no-ops. Enumerations mirror the real
 * expo-haptics API so components can reference them safely in tests.
 */

const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Rigid: 'rigid',
  Soft: 'soft',
};

const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
};

module.exports = {
  __esModule: true,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
};
