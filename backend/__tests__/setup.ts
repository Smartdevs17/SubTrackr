/** Backend Jest setup – polyfill Expo/RN globals not present in Node. */
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
