module.exports = {
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: './babel.config.test.js' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/', '<rootDir>/contracts/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
