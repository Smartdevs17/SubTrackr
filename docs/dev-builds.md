# Development Builds

SubTrackr uses `expo-dev-client` for native-module debugging, WalletConnect testing, Detox, and local simulator/device workflows that cannot run inside Expo Go.

## Local Development

```bash
npm install
npm run ios
npm run android
npm start
```

Use device-specific launch commands when testing native behavior on hardware:

```bash
npm run ios:device
npm run android:device
```

`npm start` launches the dev-client Metro target. Use `npm run start:expo-go` only for screens that do not depend on native modules.

## EAS Profiles

- `development`: internal dev-client builds, simulator-compatible iOS, Android APK output, sandbox API.
- `preview`: internal QA builds against sandbox services.
- `production`: store-ready builds against production services with version auto-increment.

```bash
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
npx eas build --profile preview --platform all
npx eas build --profile production --platform all
```

## Environment Configuration

Set `APP_ENV` and `EXPO_PUBLIC_API_URL` to override defaults:

```bash
APP_ENV=preview EXPO_PUBLIC_API_URL=https://sandbox.api.subtrackr.app npm run ios
```

The app config automatically changes the native bundle/package identifier for non-production builds so dev, preview, and production installs can coexist on the same device.

## Native Debugging

Run a development build, open the dev menu, and use the React Native debugger, network inspector, and native logs. For clean native dependency state after changing plugins or native packages:

```bash
npx expo prebuild --clean
cd ios && pod install --repo-update
```
