/**
 * Lightweight Jest mock for expo-application.
 *
 * Exposes static app metadata used by src/services/auth/session.ts without
 * requiring the native module.
 */

module.exports = {
  __esModule: true,
  applicationName: 'SubTrackr (test)',
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  getApplicationIdAsync: jest.fn(() => Promise.resolve('com.subtrackr.test')),
  getInstallationTimeAsync: jest.fn(() => Promise.resolve(0)),
  getLastUpdateTimeAsync: jest.fn(() => Promise.resolve(0)),
  getIosIdForVendorAsync: jest.fn(() => Promise.resolve('ios-vendor-id')),
  getAndroidIdAsync: jest.fn(() => Promise.resolve('android-id')),
  getApplicationNameAsync: jest.fn(() => Promise.resolve('SubTrackr (test)')),
};
