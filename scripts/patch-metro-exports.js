const fs = require('fs');
const path = require('path');
const metroPkgPath = path.join(__dirname, '..', 'node_modules', 'metro', 'package.json');
if (!fs.existsSync(metroPkgPath)) process.exit(0);
const pkg = JSON.parse(fs.readFileSync(metroPkgPath, 'utf8'));
if (pkg.exports && !pkg.exports['./src/*']) {
  pkg.exports['./src/*'] = './src/*';
  fs.writeFileSync(metroPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('patched metro exports: added ./src/*');
}
