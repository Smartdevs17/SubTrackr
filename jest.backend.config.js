/** Minimal Jest config for running backend-only TypeScript tests without Expo. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^bullmq$': '<rootDir>/backend/shared/queue/__mocks__/bullmq.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/backend/__tests__/setup.ts'],
  testMatch: [
    '**/backend/**/__tests__/**/*.test.ts',
    '**/backend/tests/**/*.test.ts',
    '**/backend/billing/tests/**/*.test.ts',
    '**/backend/billing/tests/**/*.spec.ts',
    '**/developer-portal/__tests__/**/*.test.ts',
    '**/packages/ui/**/__tests__/**/*.test.ts',
    '**/packages/flags/**/__tests__/**/*.test.ts',
    '**/shared/types/__tests__/**/*.test.ts',
    '**/shared/errors/__tests__/**/*.test.ts',
    '**/scripts/__tests__/**/*.test.ts',
    '**/src/services/__tests__/usageMeteringClient.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: { strict: false, skipLibCheck: true },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Coverage settings — aligned with Stryker break threshold (issue #914)
  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.test.ts',
    '!backend/**/*.spec.ts',
    '!backend/**/__tests__/**',
    '!backend/**/*.d.ts',
    '!backend/migrations/**',
    '!backend/server.ts',
    '!backend/server/**',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
