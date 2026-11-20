// jest-expo 58 imports this private module directly to install the global Expo
// polyfill. Expo SDK 53's expo-modules-core does not ship the module, so tests
// fail before any test code runs. Provide the minimal global shape that the
// jest-expo setup file needs.

class EventEmitter {}
class NativeModule {}
class SharedObject {}
class SharedRef {}

if (!globalThis.expo) {
  globalThis.expo = {
    EventEmitter,
    NativeModule,
    SharedObject,
    SharedRef,
    modules: {},
    uuidv4: () => '00000000-0000-4000-8000-000000000000',
    uuidv5: () => '00000000-0000-5000-8000-000000000000',
    getViewConfig: () => {
      throw new Error('Method not implemented.');
    },
    reloadAppAsync: async () => {},
    expoModulesCoreVersion: undefined,
    cacheDir: undefined,
    documentsDir: undefined,
  };
}

module.exports = {
  installExpoGlobalPolyfill() {},
};
