#!/usr/bin/env node
/**
 * i18n Translation Key Extractor — Issue #407
 *
 * Scans the src/ directory for all t('key') / i18n.t('key') / useTranslation
 * usages and extracts translation keys. Compares against the English baseline
 * locale and reports:
 *   - Keys used in code but missing from en.json  (NEW — needs translation)
 *   - Keys present in en.json but not used in code (UNUSED — can be removed)
 *   - Keys present in en.json but missing from hi.json / ar.json (MISSING LOCALE)
 *
 * Exit codes:
 *   0  everything is in sync
 *   1  missing or unused keys found (use --fix to auto-stub missing keys)
 *
 * Usage:
 *   node scripts/i18n-extract.js
 *   node scripts/i18n-extract.js --fix          # stubs missing keys in all locales
 *   node scripts/i18n-extract.js --report-only  # never exits with code 1 (CI info only)
 */

const fs   = require('fs');
const path = require('path');

const SRC_DIR      = path.resolve(__dirname, '../src');
const LOCALES_DIR  = path.resolve(__dirname, '../src/i18n/locales');
const LOCALES      = ['en', 'hi', 'ar'];
const FIX_MODE     = process.argv.includes('--fix');
const REPORT_ONLY  = process.argv.includes('--report-only');

// ── 1. Extract keys from source code ─────────────────────────────────────────

const KEY_PATTERNS = [
  /\bt\(\s*['"`]([^'"`]+)['"`]/g,            // t('key')
  /i18n\.t\(\s*['"`]([^'"`]+)['"`]/g,        // i18n.t('key')
  /useTranslation.*?\bt\(\s*['"`]([^'"`]+)['"`]/gs, // useTranslation hook
];

function extractKeysFromFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  for (const pattern of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(src)) !== null) {
      // Strip leading namespace separator if present (e.g. "common:ok" → "common.ok")
      keys.add(m[1].replace(/:/g, '.'));
    }
  }
  return keys;
}

function walkDir(dir, ext = ['.ts', '.tsx', '.js', '.jsx']) {
  const results = new Set();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      for (const k of walkDir(full, ext)) results.add(k);
    } else if (entry.isFile() && ext.some(e => full.endsWith(e))) {
      for (const k of extractKeysFromFile(full)) results.add(k);
    }
  }
  return results;
}

// ── 2. Flatten / unflatten JSON locale ───────────────────────────────────────

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, full));
    } else {
      out[full] = v;
    }
  }
  return out;
}

function setNested(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ── 3. Main ───────────────────────────────────────────────────────────────────

function loadLocale(lang) {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveLocale(lang, data) {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  ✔ Saved ${filePath}`);
}

const codeKeys  = walkDir(SRC_DIR);
const enLocale  = loadLocale('en');
const enFlat    = flatten(enLocale);
const enKeys    = new Set(Object.keys(enFlat));

const newKeys    = [...codeKeys].filter(k => !enKeys.has(k));
const unusedKeys = [...enKeys].filter(k => !codeKeys.has(k));

let hasIssues = false;

// Report new keys (in code, missing from en.json)
if (newKeys.length > 0) {
  console.warn(`\n⚠  ${newKeys.length} key(s) used in code but missing from en.json:`);
  newKeys.forEach(k => console.warn(`   - ${k}`));
  hasIssues = true;
  if (FIX_MODE) {
    for (const key of newKeys) {
      for (const lang of LOCALES) {
        const loc = loadLocale(lang);
        setNested(loc, key, lang === 'en' ? `[TODO: ${key}]` : `[TRANSLATE: ${key}]`);
        saveLocale(lang, loc);
      }
    }
  }
}

// Report unused keys (in en.json, not used in code)
if (unusedKeys.length > 0) {
  console.warn(`\n⚠  ${unusedKeys.length} key(s) in en.json are not used in the codebase:`);
  unusedKeys.forEach(k => console.warn(`   - ${k}`));
  // Unused keys are a warning, not a hard failure
}

// Report per-locale missing keys
for (const lang of LOCALES.filter(l => l !== 'en')) {
  const loc    = loadLocale(lang);
  const flat   = flatten(loc);
  const missing = [...enKeys].filter(k => !(k in flat));
  if (missing.length > 0) {
    console.warn(`\n⚠  ${missing.length} key(s) missing from ${lang}.json:`);
    missing.forEach(k => console.warn(`   - ${k}`));
    hasIssues = true;
    if (FIX_MODE) {
      const locData = loadLocale(lang);
      for (const key of missing) setNested(locData, key, `[TRANSLATE: ${key}]`);
      saveLocale(lang, locData);
      hasIssues = false; // fixed in this run
    }
  } else {
    console.log(`✔ ${lang}.json is complete (${enKeys.size} keys)`);
  }
}

if (!hasIssues) {
  console.log('\n✔ All locale files are in sync with the codebase.');
}

if (hasIssues && !REPORT_ONLY) {
  console.error('\nRun with --fix to auto-stub missing keys, or add translations manually.');
  process.exit(1);
}
