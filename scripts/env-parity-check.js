#!/usr/bin/env node
/**
 * Environment parity check (#2107).
 *
 * Every environment variable read by the mobile app (app.config.js, src/) or
 * the backend and workers (backend/) must be documented in .env.example, so all
 * three surfaces share one documented contract. Exits with status 1 when a
 * variable is read in code but missing from .env.example.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const SOURCE_ENTRIES = ['app.config.js', 'src', 'backend'];
const IGNORED_KEYS = new Set(['NODE_ENV']);

function documentedKeys() {
  const keys = new Set();
  for (const line of fs.readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function listSourceFiles(target) {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];

  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : listSourceFiles(child);
    }
    const isSource = /\.(ts|tsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name);
    return isSource ? [child] : [];
  });
}

function keysReadInCode() {
  const found = new Map();
  for (const entry of SOURCE_ENTRIES) {
    for (const file of listSourceFiles(path.join(ROOT, entry))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        const key = match[1];
        if (!IGNORED_KEYS.has(key) && !found.has(key)) {
          found.set(key, path.relative(ROOT, file));
        }
      }
    }
  }
  return found;
}

const documented = documentedKeys();
const undocumented = [...keysReadInCode()].filter(([key]) => !documented.has(key));

if (undocumented.length === 0) {
  console.log('Environment parity check passed.');
  process.exit(0);
}

for (const [key, file] of undocumented) {
  console.error(`undocumented: ${key} (read in ${file})`);
}
console.error(`\n${undocumented.length} environment variable(s) are read in code but missing from .env.example.`);
process.exit(1);
