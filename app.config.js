const appJson = require('./app.json');

const env = process.env.APP_ENV || 'development';
const isProduction = env === 'production';

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  name: isProduction ? 'SubTrackr' : `SubTrackr ${env}`,
  scheme: 'subtrackr',
  ios: {
    ...appJson.expo.ios,
    bundleIdentifier: isProduction ? 'com.subtrackr.app' : `com.subtrackr.app.${env}`,
  },
  android: {
    ...appJson.expo.android,
    package: isProduction ? 'com.subtrackr.app' : `com.subtrackr.app.${env}`,
    jsEngine: 'hermes',
    hermesFlags: ['-g', '--minify', '--inline-store-on-put', '--allocation-profile'],
  },
  plugins: ['expo-dev-client', ...(appJson.expo.plugins || [])],
  extra: {
    ...appJson.expo.extra,
    appEnv: env,
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://sandbox.api.subtrackr.app',
    nativeDebuggingEnabled: !isProduction,
    hermesOptimizations: {
      enabled: true,
      inlineStoreOnPut: true,
      allocationProfile: true,
      bytecodeCache: true,
    },
  },
});