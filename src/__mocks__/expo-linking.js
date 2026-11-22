/**
 * Lightweight Jest mock for expo-linking.
 *
 * Provides the deep-linking helpers used by src/navigation/linking.ts
 * without requiring the native module. Tests that need specific behavior
 * should call `jest.mock('expo-linking', ...)` in their own file.
 */

const LinkingMock = {
  createURL: jest.fn((path) => `subtrackr://${path ?? ''}`),
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  removeEventListener: jest.fn(),
  openURL: jest.fn(() => Promise.resolve(true)),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
  getLinkingURL: jest.fn(() => Promise.resolve(null)),
};

module.exports = {
  __esModule: true,
  ...LinkingMock,
  default: LinkingMock,
};
