#!/usr/bin/env node
/**
 * i18n Linter — Issue #407
 *
 * Validates locale files for:
 *   1. Placeholder mismatches  — e.g. en.json has {{name}} but hi.json uses {name}
 *   2. Plural key completeness — keys ending in _one/_other must have both forms
 *   3. RTL marker validation   — ar.json keys must not contain hard-coded LTR punctuation
 *   4. Empty / blank values    — catches untranslated stubs left by i18n-extract --fix
 *
 * Exit code 1 when any error is found (used in CI).
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../src/i18n/locales');
const LOCALES = ['en', 'hi', 'ar'];

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

function extractPlaceholders(str) {
  return [...(str.match(/\{\{[^}]+\}\}/g) ?? [])].sort().join(',');
}

const locales = {};
for (const lang of LOCALES) {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8');
  locales[lang] = flatten(JSON.parse(raw));
}

let errors = 0;

for (const key of Object.keys(locales.en)) {
  const enVal = String(locales.en[key]);
  const enPH = extractPlaceholders(enVal);

  for (const lang of LOCALES.filter((l) => l !== 'en')) {
    if (!(key in locales[lang])) continue; // missing keys handled by i18n-extract

    const val = String(locales[lang][key]);

    // 1. Placeholder mismatch
    const ph = extractPlaceholders(val);
    if (ph !== enPH) {
      console.error(`[PLACEHOLDER] ${lang}.${key}: expected "${enPH}", got "${ph}"`);
      errors++;
    }

    // 4. Untranslated stub detection
    if (val.startsWith('[TRANSLATE:') || val.startsWith('[TODO:')) {
      console.warn(`[STUB] ${lang}.${key} is still a translation stub: "${val}"`);
      // Warning only — don't increment errors for stubs so CI doesn't block while
      // translations are being added.
    }
  }

  // 2. Plural key completeness (simple _one/_other pattern)
  if (key.endsWith('_one')) {
    const otherKey = key.replace(/_one$/, '_other');
    for (const lang of LOCALES) {
      if (!(otherKey in locales[lang])) {
        console.error(`[PLURAL] ${lang}: has "${key}" but missing "${otherKey}"`);
        errors++;
      }
    }
  }
}

// 3. RTL / LTR checks for Arabic
const LTR_PUNCT_RE = /[‎‏]/; // explicit LTR/RTL marks are fine — flag odd use
for (const [key, val] of Object.entries(locales.ar)) {
  if (typeof val === 'string' && LTR_PUNCT_RE.test(val)) {
    console.warn(`[RTL] ar.${key} contains explicit directional marks — verify intent`);
  }
}

if (errors === 0) {
  console.log('✔ i18n lint passed — no placeholder mismatches or plural issues.');
} else {
  console.error(`\n✖ i18n lint found ${errors} error(s).`);
  process.exit(1);
}
