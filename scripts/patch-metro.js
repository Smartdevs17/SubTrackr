const fs = require('fs');
const path = require('path');

// Patch metro exports
const metroPkgPath = path.resolve(__dirname, '../node_modules/metro/package.json');
if (fs.existsSync(metroPkgPath)) {
  const m = JSON.parse(fs.readFileSync(metroPkgPath, 'utf8'));
  if (m.exports && !m.exports['./src/lib/TerminalReporter']) {
    m.exports['./src/lib/TerminalReporter'] = './src/lib/TerminalReporter.js';
    fs.writeFileSync(metroPkgPath, JSON.stringify(m, null, 2));
    console.log('Patched metro exports to add ./src/lib/TerminalReporter');
  }
}

// Patch metro-cache exports
const metroCachePkgPath = path.resolve(__dirname, '../node_modules/metro-cache/package.json');
if (fs.existsSync(metroCachePkgPath)) {
  const m = JSON.parse(fs.readFileSync(metroCachePkgPath, 'utf8'));
  if (m.exports && !m.exports['./src/stores/FileStore']) {
    m.exports['./src/stores/FileStore'] = './src/stores/FileStore.js';
    fs.writeFileSync(metroCachePkgPath, JSON.stringify(m, null, 2));
    console.log('Patched metro-cache exports to add ./src/stores/FileStore');
  }
}
