// Global Jest setup for React Native snapshot/component tests.
// Fixes:
// - @react-native-async-storage/async-storage native module null in Jest
// - Hermes parser crashes when RN internals are loaded during tests

jest.mock('@react-native-async-storage/async-storage', () => {
  return require('./src/__mocks__/@react-native-async-storage/async-storage');
});

// Mock ViewConfigIgnore to prevent Hermes parser from choking on Flow syntax
// in react-native/Libraries/NativeComponent/ViewConfigIgnore.js.
// This module uses `const T: {+[name: string]: true}` Flow syntax that the
// version of hermes-parser used by @react-native/babel-preset cannot handle.
jest.mock('react-native/Libraries/NativeComponent/ViewConfigIgnore', () => ({
  DynamicallyInjectedByGestureHandler: (object) => object,
  ConditionallyIgnoredEventHandlers: (value) => value,
  isIgnored: () => false,
}));
