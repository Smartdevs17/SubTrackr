/**
 * Jest configuration for backend-only tests.
 *
 * The main jest.config.js intentionally excludes backend/ because it uses the
 * @react-native/jest-preset which is incompatible with pure Node.js modules.
 * This config targets Node directly and uses babel-jest (already installed)
 * with the project's standard TypeScript preset.
 *
 * Run all backend tests:
 *   npx jest --config jest.backend.config.js
 *
 * Run with coverage:
 *   npx jest --config jest.backend.config.js --coverage
 *
 * Run a specific pattern:
 *   npx jest --config jest.backend.config.js --testPathPatterns etagCache
 */

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'backend',
  testEnvironment: 'node',
  rootDir: '.',

  testMatch: [
    '<rootDir>/backend/**/__tests__/**/*.test.ts',
    '<rootDir>/backend/**/__tests__/**/*.spec.ts',
    '<rootDir>/backend/**/*.test.ts',
  ],

  transform: {
    '^.+\\.(js|ts|tsx)$': [
      'babel-jest',
      { configFile: './babel.config.backend.js' },
    ],
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Prevent transformIgnore from blocking node:* built-ins
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/)',
  ],

  // Stub out React Native / mobile-only deps that backend code never uses
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/@react-native-async-storage/async-storage.js',
  },

  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.d.ts',
    '!backend/**/dist/**',
    '!backend/**/__tests__/**',
    '!backend/**/__mocks__/**',
  ],

  coverageDirectory: '<rootDir>/coverage/backend',
  coverageReporters: ['text', 'lcov', 'html'],

  passWithNoTests: true,
};
