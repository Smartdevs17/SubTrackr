/**
 * Tests for scripts/anonymize-test-data.js (issue #1287).
 *
 * Exercised through the root Jest project (`npm run test`), which picks up
 * `scripts/__tests__` via the `**\/__tests__/**` testMatch glob.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = require('../anonymize-test-data');

const {
  anonymizeText,
  auditFiles,
  collectTargetFiles,
  hash32,
  isLuhnValid,
  isSafeEmailDomain,
  isSafeIpv4,
  isSafePhone,
  lineAt,
  parseArgs,
  run,
  scanText,
  synthesizePan,
} = tool;

const PII_SAMPLE = [
  'contact: john.doe@gmail.com',
  'phone: +1 415 867 5309',
  'card: 4111111111111111',
  'ssn: 123-45-6789',
  'host: 8.8.8.8',
  'key: sk_live_abcdefghijklmnop1234',
  'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
  'office: 1600 Pennsylvania Avenue',
].join('\n');

const SAFE_SAMPLE = [
  'owner: testuser@subtrackr.app',
  'docs: someone@example.com',
  'loopback: 127.0.0.1',
  'private: 10.0.0.7',
  'documentation: 203.0.113.9',
  'fictional: +1 (415) 555-0198',
  'price: 15.49',
  'id: seed-netflix',
].join('\n');

function ruleSet(text) {
  return Array.from(new Set(scanText(text).map((finding) => finding.rule))).sort();
}

function makeFixtureDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-anon-'));
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'fixtures', name), contents, 'utf8');
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('anonymize-test-data :: helpers', () => {
  it('produces a stable 8-character hex hash', () => {
    expect(hash32('subtrackr')).toMatch(/^[0-9a-f]{8}$/);
    expect(hash32('subtrackr')).toBe(hash32('subtrackr'));
    expect(hash32('subtrackr')).not.toBe(hash32('subtrackr2'));
  });

  it('validates Luhn checksums and rejects malformed PANs', () => {
    expect(isLuhnValid('4111111111111111')).toBe(true);
    expect(isLuhnValid('4111111111111112')).toBe(false);
    expect(isLuhnValid('1234')).toBe(false);
  });

  it('always synthesizes a Luhn-valid PAN in a reserved test BIN', () => {
    const pan = synthesizePan('seed');
    expect(pan).toHaveLength(16);
    expect(pan.startsWith('9999')).toBe(true);
    expect(isLuhnValid(pan)).toBe(true);
    expect(synthesizePan('seed')).toBe(pan);
    expect(synthesizePan('other')).not.toBe(pan);
  });

  it('treats reserved and project-owned email domains as safe', () => {
    expect(isSafeEmailDomain('example.com')).toBe(true);
    expect(isSafeEmailDomain('subtrackr.local')).toBe(true);
    expect(isSafeEmailDomain('mail.subtrackr.test')).toBe(true);
    expect(isSafeEmailDomain('gmail.com')).toBe(false);
  });

  it('treats reserved IPv4 ranges as safe and routable ones as unsafe', () => {
    expect(isSafeIpv4('127.0.0.1')).toBe(true);
    expect(isSafeIpv4('192.168.1.1')).toBe(true);
    expect(isSafeIpv4('203.0.113.9')).toBe(true);
    expect(isSafeIpv4('8.8.8.8')).toBe(false);
  });

  it('treats the NANP 555-0100..555-0199 block as fictional', () => {
    expect(isSafePhone('+1 415 555 0198')).toBe(true);
    expect(isSafePhone('415-555-0100')).toBe(true);
    expect(isSafePhone('415-867-5309')).toBe(false);
  });

  it('maps character offsets to 1-based line numbers', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1);
    expect(lineAt('a\nb\nc', 2)).toBe(2);
    expect(lineAt('a\nb\nc', 4)).toBe(3);
  });
});

describe('anonymize-test-data :: detection', () => {
  it('detects every supported PII class in a realistic payload', () => {
    expect(ruleSet(PII_SAMPLE)).toEqual([
      'api-key',
      'credit-card',
      'email',
      'ipv4',
      'jwt',
      'phone',
      'ssn',
      'street-address',
    ]);
  });

  it('reports a line number for every finding', () => {
    const findings = scanText(PII_SAMPLE);
    const email = findings.find((finding) => finding.rule === 'email');
    expect(email.line).toBe(1);
    const ip = findings.find((finding) => finding.rule === 'ipv4');
    expect(ip.line).toBe(5);
  });

  it('ignores reserved, fictional and non-PII values', () => {
    expect(scanText(SAFE_SAMPLE)).toEqual([]);
  });

  it('returns non-overlapping findings in source order', () => {
    const findings = scanText(PII_SAMPLE);
    for (let i = 1; i < findings.length; i += 1) {
      const previous = findings[i - 1];
      expect(findings[i].offset).toBeGreaterThanOrEqual(previous.offset + previous.length);
    }
  });
});

describe('anonymize-test-data :: rewriting', () => {
  it('removes every detected value from the rewritten text', () => {
    const result = anonymizeText(PII_SAMPLE);
    for (const finding of scanText(PII_SAMPLE)) {
      expect(result.text).not.toContain(finding.value);
    }
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('is idempotent — a second pass finds nothing to change', () => {
    const first = anonymizeText(PII_SAMPLE);
    const second = anonymizeText(first.text);
    expect(second.text).toBe(first.text);
    expect(second.changes).toEqual([]);
  });

  it('is deterministic — identical input yields identical output', () => {
    expect(anonymizeText(PII_SAMPLE).text).toBe(anonymizeText(PII_SAMPLE).text);
  });

  it('leaves safe payloads byte-identical', () => {
    const result = anonymizeText(SAFE_SAMPLE);
    expect(result.text).toBe(SAFE_SAMPLE);
    expect(result.changes).toEqual([]);
  });

  it('preserves surrounding whitespace around a replaced value', () => {
    const result = anonymizeText('  john.doe@gmail.com  ');
    expect(result.text).toMatch(/^ {2}user-[0-9a-f]{8}@example\.com {2}$/);
  });

  it('keeps adjacent non-PII tokens intact', () => {
    const result = anonymizeText('{"id":"seed-netflix","price":15.49}');
    expect(result.text).toBe('{"id":"seed-netflix","price":15.49}');
  });
});

describe('anonymize-test-data :: CLI', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('parses documented flags', () => {
    const options = parseArgs(['--check', '--json', '--paths', 'a,b']);
    expect(options.check).toBe(true);
    expect(options.json).toBe(true);
    expect(options.paths).toEqual(['a', 'b']);
  });

  it('supports the --paths=value form and default exclusions', () => {
    const options = parseArgs(['--paths=x,y', '--exclude', 'z']);
    expect(options.paths).toEqual(['x', 'y']);
    expect(Array.from(options.excluded)).toEqual(['z']);
  });

  it('rejects an unknown argument and a missing --paths value', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--paths'])).toThrow(/requires/);
  });

  it('returns exit code 2 on a usage error', () => {
    expect(run(['--bogus'])).toBe(2);
  });

  it('fails --check when unanonymised PII is present', () => {
    const dir = makeFixtureDir({ 'leak.json': '{"email":"john.doe@gmail.com"}' });
    try {
      expect(run(['--paths', path.join(dir, 'fixtures'), '--check'])).toBe(1);
    } finally {
      cleanup(dir);
    }
  });

  it('rewrites with --write and then passes --check', () => {
    const dir = makeFixtureDir({ 'leak.json': '{"email":"john.doe@gmail.com"}' });
    const target = path.join(dir, 'fixtures');
    try {
      expect(run(['--paths', target, '--write'])).toBe(0);
      expect(fs.readFileSync(path.join(target, 'leak.json'), 'utf8')).not.toContain('gmail.com');
      expect(run(['--paths', target, '--check'])).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  it('returns exit code 0 for a clean corpus', () => {
    const dir = makeFixtureDir({ 'clean.json': '{"owner":"testuser@subtrackr.app"}' });
    try {
      expect(run(['--paths', path.join(dir, 'fixtures'), '--check'])).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  it('returns exit code 0 when the requested path does not exist', () => {
    expect(run(['--paths', path.join(os.tmpdir(), 'subtrackr-does-not-exist'), '--check'])).toBe(0);
  });
});

describe('anonymize-test-data :: discovery and reporting', () => {
  it('discovers fixture directories by name and skips vendored trees', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-discover-'));
    fs.mkdirSync(path.join(dir, 'src', '__fixtures__'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', '__fixtures__', 'a.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'b.json'), '{}', 'utf8');
    try {
      const files = collectTargetFiles([dir], new Set());
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('__fixtures__');
    } finally {
      cleanup(dir);
    }
  });

  it('ignores non-text extensions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-ext-'));
    fs.writeFileSync(path.join(dir, 'fixture.png'), 'binary', 'utf8');
    fs.writeFileSync(path.join(dir, 'fixture.json'), '{}', 'utf8');
    try {
      const files = collectTargetFiles([dir], new Set());
      expect(files.map((file) => path.basename(file))).toEqual(['fixture.json']);
    } finally {
      cleanup(dir);
    }
  });

  it('de-duplicates files reachable through several roots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-dedupe-'));
    const nested = path.join(dir, 'fixtures');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'a.json'), '{}', 'utf8');
    try {
      expect(collectTargetFiles([nested, dir], new Set())).toHaveLength(1);
    } finally {
      cleanup(dir);
    }
  });

  it('summarises findings per rule for the audit report', () => {
    const dir = makeFixtureDir({ 'leak.json': '{"a":"john.doe@gmail.com","b":"8.8.8.8"}' });
    const target = path.join(dir, 'fixtures');
    try {
      const report = auditFiles(collectTargetFiles([target], new Set()));
      expect(report.filesScanned).toBe(1);
      expect(report.findings).toHaveLength(2);
      expect(report.byRule).toEqual({ email: 1, ipv4: 1 });
    } finally {
      cleanup(dir);
    }
  });
});
