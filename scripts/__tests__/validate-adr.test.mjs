import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-adr.mjs');

const VALID = `# 0001: Use ADRs

- Status: Accepted
- Date: 2026-11-23

## Context

We need a record of decisions.

## Decision

We keep ADRs under docs/adr.

## Consequences

Reviews gain context.
`;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-validate-'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, 'utf8');
  }
  return dir;
}

function run(dir) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--dir', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('accepts a valid ADR listed in the index', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID,
    'README.md': '# ADR index\n\n- [0001](0001-use-adrs.md)\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, true, result.stderr);
    assert.match(result.stdout, /1 record\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a placeholder date', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID.replace('2026-11-23', 'YYYY-MM-DD'),
    'README.md': '- [0001](0001-use-adrs.md)\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /Date is still a placeholder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a missing section heading', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID.replace('## Consequences', '## Notes'),
    'README.md': '- [0001](0001-use-adrs.md)\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /missing '## Consequences'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an ADR missing from the index', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID,
    'README.md': '# ADR index\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /missing index entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects duplicate ADR numbers', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID,
    '0001-other.md': VALID.replace('Use ADRs', 'Other'),
    'README.md': '- [0001](0001-use-adrs.md)\n- [0001](0001-other.md)\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /duplicate ADR number/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a malformed filename but ignores README and template', () => {
  const dir = fixture({
    '0001-use-adrs.md': VALID,
    'Bad Name.md': VALID,
    '0000-template.md': 'template\n',
    'README.md': '- [0001](0001-use-adrs.md)\n',
  });
  try {
    const result = run(dir);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /Bad Name\.md: expected NNNN-lowercase-slug\.md/);
    assert.doesNotMatch(result.stderr, /README\.md: expected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
