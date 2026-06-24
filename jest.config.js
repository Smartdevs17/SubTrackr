module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@walletconnect/.*)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'chaos/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  modulePathIgnorePatterns: ['<rootDir>/e2e'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/e2e/',
    '<rootDir>/load-tests/',
    '<rootDir>/src/animations/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@react-native-community/netinfo$':
      '<rootDir>/src/__mocks__/@react-native-community/netinfo.js',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/@react-native-async-storage/async-storage.js',
  },
  setupFilesAfterEnv: [],
  testEnvironment: 'node',
};
