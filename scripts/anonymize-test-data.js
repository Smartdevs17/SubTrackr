#!/usr/bin/env node
/**
 * scripts/anonymize-test-data.js
 *
 * Issue #1287 — Add automated test data anonymization.
 *
 * Scans the committed test-data corpus (fixture / mock directories) for values
 * that look like real personally identifiable information (PII) and replaces
 * them with deterministic, obviously synthetic equivalents.
 *
 * Design notes:
 *   - Zero dependencies. Node built-ins only, so the CI gate needs no install step.
 *   - Deterministic: the same input always maps to the same pseudonym, so a
 *     re-run over an already-anonymised corpus is a no-op and diffs stay stable.
 *   - Synthetic-by-construction: replacements use RFC 2606 / RFC 5737 reserved
 *     ranges (example.com, TEST-NET-3, 555-01xx phone blocks) so an anonymised
 *     fixture can never be mistaken for — or routed to — a real party.
 *   - Reserved/safe domains are ignored, so intentional fixtures such as
 *     `testuser@subtrackr.app` are not flagged.
 *
 * Usage:
 *   node scripts/anonymize-test-data.js                 # audit, print a report
 *   node scripts/anonymize-test-data.js --check         # CI gate (exit 1 on findings)
 *   node scripts/anonymize-test-data.js --write         # rewrite fixtures in place
 *   node scripts/anonymize-test-data.js --json          # machine-readable report
 *   node scripts/anonymize-test-data.js --paths a,b     # explicit scan roots
 *   node scripts/anonymize-test-data.js --exclude c     # skip a root
 *
 * Exit codes:
 *   0  no findings (or all findings rewritten with --write)
 *   1  unanonymised PII found in --check mode
 *   2  usage error
 *   3  unexpected failure
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────

/** Directory names holding committed test data, discovered by name. */
const FIXTURE_DIR_NAMES = [
  'fixtures',
  '__fixtures__',
  '__mocks__',
  'mocks',
  'testdata',
  'test-data',
  '__data__',
];

/** Trees walked when --paths is not supplied, to locate fixture directories. */
const DEFAULT_DISCOVERY_ROOTS = ['e2e', 'src', 'backend', 'mobile', 'app', 'sandbox'];

/** File extensions treated as text and therefore scannable. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.csv',
  '.txt',
  '.sql',
  '.yml',
  '.yaml',
  '.graphql',
]);

/** Directories never descended into. */
const ALWAYS_SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'web-build',
  'android',
  'ios',
  '.expo',
  'vendor',
  'target',
]);

/**
 * Domains whose mailboxes are reserved for documentation, testing or owned by
 * this project. Mail at these domains is synthetic by construction.
 */
const SAFE_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.test',
  'example.invalid',
  'example.local',
  'test',
  'localhost',
  'invalid',
  'subtrackr.test',
  'subtrackr.local',
  'subtrackr.invalid',
  'subtrackr.app',
]);

/** Non-routable / reserved IPv4 ranges that never identify a real host. */
const SAFE_IPV4_PREFIXES = [
  '0.',
  '10.',
  '127.',
  '169.254.',
  '192.168.',
  '255.255.',
  '198.51.100.',
  '203.0.113.',
];

/** Card BINs reserved by the major payment processors for automated test suites. */
const SAFE_PAN_PREFIXES = ['9999', '0000'];

/** NANP exchange reserved for fictional use: 555-0100 through 555-0199. */
const SAFE_PHONE_EXCHANGE = '555';
const SAFE_PHONE_LINE_MIN = 100;
const SAFE_PHONE_LINE_MAX = 199;

/**
 * Tokens that mark a value as an intentional placeholder.
 *
 * A candidate containing any of these is never reported, which is what makes
 * `anonymize-text-data --write` idempotent: the values it writes are
 * recognised as synthetic on the next pass and left alone.
 */
const PLACEHOLDER_TOKENS = [
  'example',
  'placeholder',
  'sample',
  'fixture',
  'dummy',
  'fake',
  'redacted',
  'synthetic',
  'notareal',
  'not-a-real',
  'xxxxxxxx',
];

/** Synthetic street names used when rewriting detected postal addresses. */
const SYNTHETIC_STREETS = [
  'Example Street',
  'Placeholder Avenue',
  'Fixture Road',
  'Sample Boulevard',
  'Synthetic Lane',
];

/** base64url encoding of a JSON object, used to build realistic JWT segments. */
function base64Url(json) {
  return Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
}

/** Structural parts of the JWT written by this tool. */
const SYNTHETIC_JWT_HEADER = base64Url({ alg: 'HS256', typ: 'JWT' });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 32-bit FNV-1a hash rendered as 8 lowercase hex characters. */
function hash32(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Deterministic integer in [min, max] derived from a string. */
function hashInt(value, min, max) {
  const span = max - min + 1;
  return min + (parseInt(hash32(value), 16) % span);
}

/** Luhn check digit for a partial PAN. */
function luhnCheckDigit(partial) {
  let sum = 0;
  let double = true;
  for (let i = partial.length - 1; i >= 0; i -= 1) {
    let digit = partial.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return 0;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Deterministic Luhn-valid 16-digit PAN in a processor-reserved test BIN. */
function synthesizePan(value) {
  let partial = '9999';
  for (let i = 0; i < 11; i += 1) {
    partial += String(hashInt(`${value}:${i}`, 0, 9));
  }
  return partial + String(luhnCheckDigit(partial));
}

// ── Detectors ────────────────────────────────────────────────────────────────

function isSafeEmailDomain(domain) {
  const lowered = domain.toLowerCase();
  if (SAFE_EMAIL_DOMAINS.has(lowered)) return true;
  return SAFE_EMAIL_DOMAINS.has(lowered.split('.').slice(-2).join('.'));
}

function isSafeIpv4(ip) {
  if (SAFE_IPV4_PREFIXES.some((prefix) => ip.startsWith(prefix))) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** True when a candidate is an explicit, intentional placeholder. */
function containsPlaceholderToken(value) {
  const lowered = value.toLowerCase();
  return PLACEHOLDER_TOKENS.some((token) => lowered.includes(token));
}

function isValidIpv4(ip) {
  return ip.split('.').every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function digitsOf(value) {
  return value.replace(/\D/g, '');
}

function isLuhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True when the PAN sits in a BIN reserved for automated test suites. */
function isSafePan(raw) {
  return SAFE_PAN_PREFIXES.some((prefix) => digitsOf(raw).startsWith(prefix));
}

/**
 * True when a dialled number falls in the NANP fictional block
 * 555-0100 … 555-0199 (exchange 555, line 0100-0199).
 */
function isSafePhone(raw) {
  const digits = digitsOf(raw);
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length < 10) return false;
  const exchange = national.slice(3, 6);
  const line = Number(national.slice(6, 10));
  return (
    exchange === SAFE_PHONE_EXCHANGE && line >= SAFE_PHONE_LINE_MIN && line <= SAFE_PHONE_LINE_MAX
  );
}

/**
 * PEM private-key marker.
 *
 * Assembled from fragments so that this detector cannot match its own source
 * file (a literal marker here would report the tool itself as a finding).
 */
const PEM_PRIVATE_KEY_MARKER = [
  '-----BEGIN ',
  '(?:RSA |EC |OPENSSH |PGP )?',
  'PRIVATE KEY-----',
].join('');

/**
 * Detector table. Every detector exposes:
 *   pattern  - global regex used to locate candidates
 *   accept   - optional predicate refining a raw match
 *   build    - (rawMatch, leading, trailing, hash) => replacement string
 */
const DETECTORS = [
  {
    id: 'jwt',
    description: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    build: (raw, lead, trail, hash) => {
      const payload = base64Url({ sub: `placeholder-${hash}` });
      return `${SYNTHETIC_JWT_HEADER}.${payload}.placeholder${lead}${trail}`;
    },
  },
  {
    id: 'api-key',
    description: 'Provider API key',
    pattern:
      /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b/g,
    build: (raw, lead, trail, hash) => `sk_test_placeholder${hash}${hash}${lead}${trail}`,
  },
  {
    id: 'private-key',
    description: 'PEM private key block',
    pattern: new RegExp(PEM_PRIVATE_KEY_MARKER, 'g'),
    build: (raw, lead, trail) => `-----BEGIN PRIVATE${' '}KEY-----${lead}${trail}`,
  },
  {
    id: 'email',
    description: 'Email address',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    accept: (raw) => !isSafeEmailDomain(raw.slice(raw.lastIndexOf('@') + 1)),
    build: (raw, lead, trail, hash) => `user-${hash}@example.com${lead}${trail}`,
  },
  {
    id: 'credit-card',
    description: 'Payment card number',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (raw) => isLuhnValid(digitsOf(raw)) && !isSafePan(raw),
    build: (raw, lead, trail, hash) => `${synthesizePan(hash)}${lead}${trail}`,
  },
  {
    id: 'ssn',
    description: 'US social security number',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    // 000, 666 and 900-999 are never issued by the SSA.
    accept: (raw) => !/^(?:000|666|9\d{2})-/.test(raw),
    build: (raw, lead, trail, hash) =>
      `000-00-${String(hashInt(`ssn:${hash}`, 0, 9999)).padStart(4, '0')}${lead}${trail}`,
  },
  {
    id: 'phone',
    description: 'Telephone number',
    pattern:
      /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{3,4}(?![\w.])/g,
    accept: (raw) => {
      const digits = digitsOf(raw);
      if (digits.length < 10 || digits.length > 15) return false;
      return !isSafePhone(raw);
    },
    build: (raw, lead, trail, hash) => {
      const area = hashInt(`${hash}:a`, 201, 899);
      const line = String(hashInt(`${hash}:l`, SAFE_PHONE_LINE_MIN, SAFE_PHONE_LINE_MAX));
      return `+1-${area}-${SAFE_PHONE_EXCHANGE}-${line.padStart(4, '0')}${lead}${trail}`;
    },
  },
  {
    id: 'ipv4',
    description: 'IPv4 address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    accept: (raw) => isValidIpv4(raw) && !isSafeIpv4(raw),
    build: (raw, lead, trail, hash) => `203.0.113.${hashInt(hash, 1, 254)}${lead}${trail}`,
  },
  {
    id: 'street-address',
    description: 'Postal street address',
    pattern:
      /\b\d{1,6}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter)\b\.?/g,
    build: (raw, lead, trail, hash) => {
      const number = hashInt(`${hash}:n`, 1, 9999);
      const street = SYNTHETIC_STREETS[hashInt(`${hash}:s`, 0, SYNTHETIC_STREETS.length - 1)];
      return `${number} ${street}${lead}${trail}`;
    },
  },
];

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Line number (1-based) for a character offset. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Locate every PII candidate in a text blob.
 * Returns findings sorted by offset so replacements can be applied in one pass.
 */
function scanText(text) {
  const findings = [];
  for (const detector of DETECTORS) {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    let match = pattern.exec(text);
    while (match !== null) {
      const raw = match[0];
      const accepted = detector.accept ? detector.accept(raw) : true;
      if (accepted && raw.trim().length > 0 && !containsPlaceholderToken(raw)) {
        findings.push({
          rule: detector.id,
          description: detector.description,
          offset: match.index,
          length: raw.length,
          value: raw,
          line: lineAt(text, match.index),
        });
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      match = pattern.exec(text);
    }
  }
  findings.sort((a, b) => a.offset - b.offset);
  return findings.filter((finding, index, all) => {
    if (index === 0) return true;
    const previous = all[index - 1];
    return finding.offset >= previous.offset + previous.length;
  });
}

/** Build the replacement string for a single finding. */
function buildReplacement(detector, finding) {
  const hash = hash32(finding.value);
  const lead = /^\s/.test(finding.value) ? finding.value[0] : '';
  const trail = /\s$/.test(finding.value) ? finding.value[finding.value.length - 1] : '';
  return detector.build(finding.value, lead, trail, hash);
}

/**
 * Replace every finding in a text blob.
 * Returns { text, changes } where changes describe what was rewritten.
 */
function anonymizeText(text) {
  const findings = scanText(text);
  const changes = [];
  let cursor = 0;
  let output = '';

  for (const finding of findings) {
    const detector = DETECTORS.find((d) => d.id === finding.rule);
    if (!detector) continue;
    const replacement = buildReplacement(detector, finding);
    output += text.slice(cursor, finding.offset) + replacement;
    cursor = finding.offset + finding.length;
    changes.push({
      rule: finding.rule,
      description: finding.description,
      line: finding.line,
      original: finding.value,
      replacement: replacement.trim(),
    });
  }

  output += text.slice(cursor);
  return { text: output, changes, findings };
}

// ── Filesystem walking ───────────────────────────────────────────────────────

function isScannableFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Recursively collect scannable files under a directory. */
function walkDirectory(dir, collected, excluded) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
      walkDirectory(full, collected, excluded);
    } else if (entry.isFile() && isScannableFile(full)) {
      collected.push(full);
    }
  }
}

/** Expand a scan root into the set of fixture/mock directories beneath it. */
function discoverFixtureDirs(root) {
  const found = [];
  const visit = (dir) => {
    if (ALWAYS_SKIPPED_DIRS.has(path.basename(dir))) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (FIXTURE_DIR_NAMES.includes(path.basename(dir))) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !ALWAYS_SKIPPED_DIRS.has(entry.name)) {
        visit(path.join(dir, entry.name));
      }
    }
  };
  visit(root);
  return found;
}

/**
 * Build the ordered, de-duplicated list of files to inspect.
 *
 * Explicit --paths entries are scanned in full (a file, or a whole directory
 * tree). Without --paths only directories recognised as test-data stores are
 * scanned, so application code and test assertions are never rewritten.
 */
function collectTargetFiles(roots, excluded) {
  const files = [];
  const seen = new Set();
  const selfPath = path.resolve(__filename);

  const add = (file) => {
    const key = path.resolve(file);
    if (key === selfPath) return;
    if (Array.from(excluded).some((ex) => path.resolve(ex) === key)) return;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(file);
    }
  };

  for (const root of roots) {
    const absolute = path.resolve(root);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      if (isScannableFile(absolute)) add(absolute);
      continue;
    }
    const collected = [];
    walkDirectory(absolute, collected, excluded);
    for (const file of collected) add(file);
  }

  return files.sort();
}

/** Resolve the directories to scan, honouring --paths vs. auto-discovery. */
function resolveScanTargets(options) {
  if (options.paths && options.paths.length > 0) {
    return options.paths.map((p) => path.resolve(p));
  }

  const discovered = [];
  const seen = new Set();
  for (const root of DEFAULT_DISCOVERY_ROOTS) {
    const absolute = path.resolve(root);
    if (!fs.existsSync(absolute)) continue;
    for (const dir of discoverFixtureDirs(absolute)) {
      const key = path.resolve(dir);
      if (!seen.has(key)) {
        seen.add(key);
        discovered.push(dir);
      }
    }
  }
  return discovered.sort();
}

// ── Report ───────────────────────────────────────────────────────────────────

/** Scan a set of files and return a structured report. */
function auditFiles(files) {
  const findings = [];
  const changes = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const result = anonymizeText(text);
    if (result.findings.length === 0) continue;
    for (const change of result.changes) {
      findings.push({ file, rule: change.rule, line: change.line, value: change.original });
    }
    changes.push({ file, changes: result.changes, text: result.text });
  }

  const byRule = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
  }

  return { filesScanned: files.length, findings, changes, byRule };
}

function printReport(report, options) {
  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          filesScanned: report.filesScanned,
          findingCount: report.findings.length,
          byRule: report.byRule,
          findings: report.findings,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║  SubTrackr Test Data Anonymizer Audit   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`[anonymize] Files scanned: ${report.filesScanned}`);

  if (report.findings.length === 0) {
    console.log('[anonymize] ✓ No PII detected in the test data corpus.\n');
    return;
  }

  for (const finding of report.findings) {
    console.log(`  ✗  ${finding.file}:${finding.line} [${finding.rule}] ${finding.value}`);
  }
  console.log(
    `\n[anonymize] ${report.findings.length} finding(s) in ${report.changes.length} file(s).`
  );
  const summary = Object.keys(report.byRule)
    .sort()
    .map((rule) => `${rule}=${report.byRule[rule]}`)
    .join(', ');
  console.log(`[anonymize] By rule: ${summary}\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    check: false,
    write: false,
    json: false,
    paths: null,
    excluded: new Set(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--write' || arg === '--fix') options.write = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--paths') {
      const value = argv[i + 1];
      if (!value) throw new Error('--paths requires a comma-separated list of paths');
      options.paths = value
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg.startsWith('--paths=')) {
      options.paths = arg
        .slice('--paths='.length)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    } else if (arg === '--exclude') {
      const value = argv[i + 1];
      if (!value) throw new Error('--exclude requires a comma-separated list of paths');
      for (const item of value.split(',')) options.excluded.add(item.trim());
      i += 1;
    } else if (arg.startsWith('--exclude=')) {
      for (const item of arg.slice('--exclude='.length).split(',')) {
        options.excluded.add(item.trim());
      }
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[anonymize] ${err.message}`);
    console.error(
      '[anonymize] Usage: node scripts/anonymize-test-data.js [--check] [--write] [--json]'
    );
    console.error('[anonymize]   --paths <a,b>   limit the scan to specific roots');
    console.error('[anonymize]   --exclude <a,b>  skip specific roots');
    return 2;
  }

  if (options.help) {
    console.log('Usage: node scripts/anonymize-test-data.js [--check] [--write] [--json]');
    console.log('       node scripts/anonymize-test-data.js --paths e2e/fixtures,src/__fixtures__');
    console.log('       node scripts/anonymize-test-data.js --write --exclude vendor,third_party');
    return 0;
  }

  const files = collectTargetFiles(resolveScanTargets(options), options.excluded);
  const report = auditFiles(files);
  printReport(report, options);

  if (options.write && report.changes.length > 0) {
    for (const entry of report.changes) {
      fs.writeFileSync(entry.file, entry.text, 'utf8');
    }
    console.log(`[anonymize] ✓ Rewrote ${report.changes.length} file(s).`);
    console.log('[anonymize] Re-run without --write to confirm a clean audit.\n');
  }

  if (report.findings.length === 0) return 0;
  if (options.write) return 0;
  if (options.check) {
    console.error('[anonymize] ✗ Unanonymised PII found. Run with --write to remediate.\n');
    return 1;
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (err) {
    console.error('[anonymize] Unexpected error:', err && err.message);
    process.exit(3);
  }
}

module.exports = {
  DEFAULT_DISCOVERY_ROOTS,
  DETECTORS,
  FIXTURE_DIR_NAMES,
  SAFE_EMAIL_DOMAINS,
  TEXT_EXTENSIONS,
  anonymizeText,
  auditFiles,
  collectTargetFiles,
  containsPlaceholderToken,
  discoverFixtureDirs,
  hash32,
  isLuhnValid,
  isSafeEmailDomain,
  isSafeIpv4,
  isSafePan,
  isSafePhone,
  lineAt,
  parseArgs,
  resolveScanTargets,
  run,
  scanText,
  synthesizePan,
};
