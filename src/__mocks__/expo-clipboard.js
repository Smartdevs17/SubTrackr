/**
 * Lightweight Jest mock for expo-clipboard.
 *
 * Provides both the named exports used via `import * as Clipboard` and the
 * default export used via dynamic `import('expo-clipboard').default`.
 */

const setStringAsync = jest.fn(() => Promise.resolve(true));
const getStringAsync = jest.fn(() => Promise.resolve(''));
const hasStringAsync = jest.fn(() => Promise.resolve(false));

const ClipboardMock = {
  setStringAsync,
  getStringAsync,
  hasStringAsync,
};

module.exports = {
  __esModule: true,
  ...ClipboardMock,
  default: ClipboardMock,
};
