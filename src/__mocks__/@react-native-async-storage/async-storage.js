/**
 * Mock for @react-native-async-storage/async-storage
 * Prevents "NativeModule: AsyncStorage is null" errors in Jest
 */
const mockStorage = {};
const AsyncStorage = {
  getItem: jest.fn((key) => Promise.resolve(mockStorage[key] || null)),
  setItem: jest.fn((key, value) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve(Object.keys(mockStorage))),
  multiGet: jest.fn((keys) => Promise.resolve(keys.map((key) => [key, mockStorage[key] || null]))),
  multiSet: jest.fn((pairs) => {
    pairs.forEach(([key, value]) => {
      mockStorage[key] = value;
    });
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys) => {
    keys.forEach((key) => delete mockStorage[key]);
    return Promise.resolve();
  }),
  __mockReset: () => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    Object.values(AsyncStorage).forEach((fn) => {
      if (jest.isMockFunction(fn)) fn.mockClear();
    });
  },
};

module.exports = AsyncStorage;
