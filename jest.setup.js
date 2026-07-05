// Global Jest setup for React Native snapshot/component tests.
// Fixes:
// - @react-native-async-storage/async-storage native module null in Jest
// - Hermes parser crashes when RN internals are loaded during tests

jest.mock('@react-native-async-storage/async-storage', () => {
  return require('@react-native-async-storage/async-storage/jest/async-storage-mock');
});

// Mock RN Text to avoid importing RN native Text internals that can trigger
// Hermes parser issues in Node/Jest.
jest.mock('react-native/Libraries/Text/Text', () => {
  const React = require('react');
  return function MockText(props) {
    return React.createElement('Text', props, props.children);
  };
});



