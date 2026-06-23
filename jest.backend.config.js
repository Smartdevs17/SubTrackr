/** Minimal Jest config for running backend-only TypeScript tests without Expo. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/backend/**/__tests__/**/*.test.ts', '**/backend/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false, skipLibCheck: true } }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
