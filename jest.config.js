module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    // Transform all RN, Expo and related packages whether installed directly or
    // via pnpm's virtual store (.pnpm/<pkg>@<ver>/node_modules/<pkg>).
    'node_modules/(?!(' +
      // pnpm virtual-store paths for packages we must transform
      '\\.pnpm/(jest-)?react-native[^/]|' +
      '\\.pnpm/@react-native[^/]|' +
      '\\.pnpm/expo[^/]|' +
      '\\.pnpm/@expo[^/]|' +
      '\\.pnpm/@unimodules[^/]|' +
      '\\.pnpm/react-navigation[^/]|' +
      '\\.pnpm/@react-navigation[^/]|' +
      '\\.pnpm/@sentry[^/]|' +
      '\\.pnpm/native-base[^/]|' +
      '\\.pnpm/react-native-svg[^/]|' +
      '\\.pnpm/@walletconnect[^/]|' +
      // Standard (non-pnpm) paths
      '(jest-)?react-native|@react-native(-community)?|' +
      'expo(nent)?|@expo(nent)?/|@expo-google-fonts/|' +
      '@unimodules/|react-navigation|@react-navigation/|' +
      '@sentry/react-native|native-base|react-native-svg|@walletconnect/' +
      '))',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  modulePathIgnorePatterns: ['<rootDir>/e2e'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/e2e/',
    '<rootDir>/src/animations/',
    '<rootDir>/app/',
    '<rootDir>/backend/',
    '<rootDir>/developer-portal/',
    '<rootDir>/contracts/',
    '<rootDir>/chaos/',
    '<rootDir>/babel.config.test.js',
  ],
  moduleNameMapper: {
    '^bullmq$': '<rootDir>/backend/shared/queue/__mocks__/bullmq.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@react-native-community/netinfo$':
      '<rootDir>/src/__mocks__/@react-native-community/netinfo.js',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/@react-native-async-storage/async-storage.js',
    '^expo-haptics$': '<rootDir>/src/__mocks__/expo-haptics.js',
    '^expo-notifications$': '<rootDir>/src/__mocks__/expo-notifications.js',
    '^expo-linear-gradient$': '<rootDir>/src/__mocks__/expo-linear-gradient.js',
    '^expo-application$': '<rootDir>/src/__mocks__/expo-application.js',
    '^expo-clipboard$': '<rootDir>/src/__mocks__/expo-clipboard.js',
    '^expo-image$': '<rootDir>/src/__mocks__/expo-image.js',
    '^expo-linking$': '<rootDir>/src/__mocks__/expo-linking.js',
    '^@expo/vector-icons$': '<rootDir>/src/__mocks__/@expo/vector-icons.js',
    '^@expo/vector-icons/(.*)$': '<rootDir>/src/__mocks__/@expo/vector-icons.js',
    ViewConfigIgnore$: '<rootDir>/src/__mocks__/ViewConfigIgnore.js',
  },
  transform: {
    '^.+\\.(js|ts|tsx)$': ['babel-jest', { configFile: './babel.config.test.js' }],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'node',
};
