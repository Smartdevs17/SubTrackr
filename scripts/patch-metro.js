const fs = require('fs');
const path = require('path');

// Patch metro exports
const metroPkgPath = path.resolve(__dirname, '../node_modules/metro/package.json');
if (fs.existsSync(metroPkgPath)) {
  const m = JSON.parse(fs.readFileSync(metroPkgPath, 'utf8'));
  if (m.exports) {
    let changed = false;
    const targets = {
      './src/*': './src/*',
      './src/lib/TerminalReporter': './src/lib/TerminalReporter.js',
      './src/DeltaBundler/Serializers/sourceMapString':
        './src/DeltaBundler/Serializers/sourceMapString.js',
      './src/DeltaBundler/Serializers/bundleToString':
        './src/DeltaBundler/Serializers/bundleToString.js',
      './src/lib/bundleToString': './src/lib/bundleToString.js',
      './src/DeltaBundler/Graph': './src/DeltaBundler/Graph.js',
      './src/Bundler/util': './src/Bundler/util.js',
      './src/lib/CountingSet': './src/lib/CountingSet.js',
      './src/lib/countLines': './src/lib/countLines.js',
      './src/lib/getAppendScripts': './src/lib/getAppendScripts.js',
      './src/Assets': './src/Assets.js',
      './src/ModuleGraph/worker/JsFileWrapping': './src/ModuleGraph/worker/JsFileWrapping.js',
      './src/ModuleGraph/worker/importLocationsPlugin':
        './src/ModuleGraph/worker/importLocationsPlugin.js',
      './src/ModuleGraph/worker/generateImportNames':
        './src/ModuleGraph/worker/generateImportNames.js',
      './src/Server': './src/Server.js',
      './src/lib/splitBundleOptions': './src/lib/splitBundleOptions.js',
      './src/shared/output/bundle': './src/shared/output/bundle.js',
      './src/IncrementalBundler/RevisionNotFoundError':
        './src/IncrementalBundler/RevisionNotFoundError.js',
      './src/lib/formatBundlingError': './src/lib/formatBundlingError.js',
      './src/DeltaBundler/Serializers/hmrJSBundle': './src/DeltaBundler/Serializers/hmrJSBundle.js',
      './src/DeltaBundler/Serializers/baseJSBundle':
        './src/DeltaBundler/Serializers/baseJSBundle.js',
      './src/DeltaBundler/Serializers/sourceMapGenerator':
        './src/DeltaBundler/Serializers/sourceMapGenerator.js',
      './src/lib/getGraphId': './src/lib/getGraphId.js',
      './src/HmrServer': './src/HmrServer.js',
      './src/lib/createWebsocketServer': './src/lib/createWebsocketServer.js',
    };
    for (const [key, val] of Object.entries(targets)) {
      if (!m.exports[key]) {
        m.exports[key] = val;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(metroPkgPath, JSON.stringify(m, null, 2));
      console.log('Patched metro exports');
    }
  }
}

// Patch metro-cache exports
const metroCachePkgPath = path.resolve(__dirname, '../node_modules/metro-cache/package.json');
if (fs.existsSync(metroCachePkgPath)) {
  const m = JSON.parse(fs.readFileSync(metroCachePkgPath, 'utf8'));
  if (m.exports) {
    let changed = false;
    const targets = {
      './src/*': './src/*',
      './src/stores/FileStore': './src/stores/FileStore.js',
    };
    for (const [key, val] of Object.entries(targets)) {
      if (!m.exports[key]) {
        m.exports[key] = val;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(metroCachePkgPath, JSON.stringify(m, null, 2));
      console.log('Patched metro-cache exports');
    }
  }
}

// Patch metro-transform-worker exports
const metroTransformWorkerPkgPath = path.resolve(
  __dirname,
  '../node_modules/metro-transform-worker/package.json'
);
if (fs.existsSync(metroTransformWorkerPkgPath)) {
  const m = JSON.parse(fs.readFileSync(metroTransformWorkerPkgPath, 'utf8'));
  if (m.exports) {
    let changed = false;
    const targets = {
      './src/*': './src/*',
      './src/utils/getMinifier': './src/utils/getMinifier.js',
    };
    for (const [key, val] of Object.entries(targets)) {
      if (!m.exports[key]) {
        m.exports[key] = val;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(metroTransformWorkerPkgPath, JSON.stringify(m, null, 2));
      console.log('Patched metro-transform-worker exports');
    }
  }
}

// Patch expo-metro-config sourceMapString resolutions
const serializeChunksPath = path.resolve(
  __dirname,
  '../node_modules/@expo/metro-config/build/serializer/serializeChunks.js'
);
if (fs.existsSync(serializeChunksPath)) {
  let content = fs.readFileSync(serializeChunksPath, 'utf8');
  if (content.includes("typeof sourceMapString_1.default !== 'function'")) {
    content = content.replace(
      "typeof sourceMapString_1.default !== 'function'\n    ? sourceMapString_1.default.sourceMapString\n    : sourceMapString_1.default;",
      "sourceMapString_1.default\n    ? (typeof sourceMapString_1.default !== 'function' ? sourceMapString_1.default.sourceMapString : sourceMapString_1.default)\n    : sourceMapString_1.sourceMapString;"
    );
    fs.writeFileSync(serializeChunksPath, content, 'utf8');
    console.log('Patched serializeChunks.js');
  }
}

const withExpoSerializersPath = path.resolve(
  __dirname,
  '../node_modules/@expo/metro-config/build/serializer/withExpoSerializers.js'
);
if (fs.existsSync(withExpoSerializersPath)) {
  let content = fs.readFileSync(withExpoSerializersPath, 'utf8');
  if (content.includes("typeof sourceMapString_1.default !== 'function'")) {
    content = content.replace(
      "typeof sourceMapString_1.default !== 'function'\n    ? sourceMapString_1.default.sourceMapString\n    : sourceMapString_1.default;",
      "sourceMapString_1.default\n    ? (typeof sourceMapString_1.default !== 'function' ? sourceMapString_1.default.sourceMapString : sourceMapString_1.default)\n    : sourceMapString_1.sourceMapString;"
    );
    fs.writeFileSync(withExpoSerializersPath, content, 'utf8');
    console.log('Patched withExpoSerializers.js');
  }
}

const metroTransformWorkerPath = path.resolve(
  __dirname,
  '../node_modules/@expo/metro-config/build/transform-worker/metro-transform-worker.js'
);
if (fs.existsSync(metroTransformWorkerPath)) {
  let content = fs.readFileSync(metroTransformWorkerPath, 'utf8');
  let changed = false;
  if (content.includes('(0, metro_cache_key_1.default)(')) {
    content = content.replace(
      '(0, metro_cache_key_1.default)(',
      '(0, (metro_cache_key_1.default || metro_cache_key_1.getCacheKey || metro_cache_key_1))('
    );
    changed = true;
  }
  if (
    content.includes(
      'JsFileWrapping_1 = __importDefault(require("metro/src/ModuleGraph/worker/JsFileWrapping"))'
    )
  ) {
    content = content.replace(
      'JsFileWrapping_1 = __importDefault(require("metro/src/ModuleGraph/worker/JsFileWrapping"));',
      'JsFileWrapping_1 = __importDefault(require("metro/src/ModuleGraph/worker/JsFileWrapping"));\nif (JsFileWrapping_1 && !JsFileWrapping_1.default) { JsFileWrapping_1.default = JsFileWrapping_1; }'
    );
    changed = true;
  }
  if (
    content.includes(
      'generateImportNames_1 = __importDefault(require("metro/src/ModuleGraph/worker/generateImportNames"))'
    )
  ) {
    content = content.replace(
      'generateImportNames_1 = __importDefault(require("metro/src/ModuleGraph/worker/generateImportNames"));',
      'generateImportNames_1 = __importDefault(require("metro/src/ModuleGraph/worker/generateImportNames"));\nif (generateImportNames_1 && !generateImportNames_1.default) { generateImportNames_1.default = generateImportNames_1; }'
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(metroTransformWorkerPath, content, 'utf8');
    console.log('Patched metro-transform-worker.js (cache key & default imports)');
  }
}

// Patch expo cli instantiateMetro terminal logger private field access
const instantiateMetroPath = path.resolve(
  __dirname,
  '../node_modules/@expo/cli/build/src/start/server/metro/instantiateMetro.js'
);
if (fs.existsSync(instantiateMetroPath)) {
  let content = fs.readFileSync(instantiateMetroPath, 'utf8');
  if (content.includes('this._logLines.push(')) {
    content = content.replace(
      'this._logLines.push(// format args like console.log\n            _nodeutil().default.format(...args));\n            this._scheduleUpdate();',
      "this.log('%s', _nodeutil().default.format(...args));"
    );
    fs.writeFileSync(instantiateMetroPath, content, 'utf8');
    console.log('Patched instantiateMetro.js log terminal logger');
  }
}

// Patch react-native codegen error-utils to warn instead of crash when parsing Flow components event args
function findFilesRecursively(dir, fileName, results = []) {
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        findFilesRecursively(filePath, fileName, results);
      } else if (file === fileName) {
        results.push(filePath);
      }
    } catch (e) {
      // Ignore permission or other errors
    }
  }
  return results;
}

const nodeModulesPath = path.resolve(__dirname, '../node_modules');
const errorUtilsFiles = findFilesRecursively(nodeModulesPath, 'error-utils.js');

for (const errorUtilsPath of errorUtilsFiles) {
  let content = fs.readFileSync(errorUtilsPath, 'utf8');
  let changed = false;
  if (content.includes('function throwIfArgumentPropsAreNull(')) {
    content = content.replace(
      'function throwIfArgumentPropsAreNull(argumentProps, eventName) {\n  if (!argumentProps) {\n    throw new Error(`Unable to determine event arguments for "${eventName}"`);\n  }\n  return argumentProps;\n}',
      'function throwIfArgumentPropsAreNull(argumentProps, eventName) {\n  if (!argumentProps) {\n    console.warn(`Warning: Unable to determine event arguments for "${eventName}". Using fallback.`);\n    return [];\n  }\n  return argumentProps;\n}'
    );
    changed = true;
  }
  if (content.includes('function throwIfBubblingTypeIsNull(')) {
    content = content.replace(
      'function throwIfBubblingTypeIsNull(bubblingType, eventName) {\n  if (!bubblingType) {\n    throw new Error(\n      `Unable to determine event bubbling type for "${eventName}"`,\n    );\n  }\n  return bubblingType;\n}',
      'function throwIfBubblingTypeIsNull(bubblingType, eventName) {\n  if (!bubblingType) {\n    console.warn(`Warning: Unable to determine event bubbling type for "${eventName}". Using fallback.`);\n    return "bubble";\n  }\n  return bubblingType;\n}'
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(errorUtilsPath, content, 'utf8');
    console.log(`Patched react-native codegen at: ${errorUtilsPath}`);
  }
}

// Patch componentsUtils.js to handle ReadonlyArray and Readonly flow types in older codegen versions
const componentsUtilsFiles = findFilesRecursively(nodeModulesPath, 'componentsUtils.js');

for (const componentsUtilsPath of componentsUtilsFiles) {
  let content = fs.readFileSync(componentsUtilsPath, 'utf8');
  let changed = false;

  if (
    content.includes("parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnlyArray'") &&
    !content.includes("parser.getTypeAnnotationName(typeAnnotation) === 'ReadonlyArray'")
  ) {
    content = content.replace(
      "parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnlyArray'",
      "(parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnlyArray' || parser.getTypeAnnotationName(typeAnnotation) === 'ReadonlyArray')"
    );
    changed = true;
  }

  if (
    content.includes("parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnly'") &&
    !content.includes("parser.getTypeAnnotationName(typeAnnotation) === 'Readonly'")
  ) {
    content = content.replace(
      "parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnly'",
      "(parser.getTypeAnnotationName(typeAnnotation) === '$ReadOnly' || parser.getTypeAnnotationName(typeAnnotation) === 'Readonly')"
    );
    changed = true;
  }

  if (
    content.includes("objectType.id.name === '$ReadOnly'") &&
    !content.includes("objectType.id.name === 'Readonly'")
  ) {
    content = content.replace(
      "objectType.id.name === '$ReadOnly'",
      "(objectType.id.name === '$ReadOnly' || objectType.id.name === 'Readonly')"
    );
    changed = true;
  }

  if (
    content.includes("objectType.id.name === '$ReadOnlyArray'") &&
    !content.includes("objectType.id.name === 'ReadonlyArray'")
  ) {
    content = content.replace(
      "objectType.id.name === '$ReadOnlyArray'",
      "(objectType.id.name === '$ReadOnlyArray' || objectType.id.name === 'ReadonlyArray')"
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(componentsUtilsPath, content, 'utf8');
    console.log(`Patched componentsUtils at: ${componentsUtilsPath}`);
  }
}
