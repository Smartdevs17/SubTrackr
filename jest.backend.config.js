/** Minimal Jest config for running backend-only TypeScript tests without Expo. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/backend/__tests__/setup.ts'],
  testMatch: ['**/backend/**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false, skipLibCheck: true } }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
