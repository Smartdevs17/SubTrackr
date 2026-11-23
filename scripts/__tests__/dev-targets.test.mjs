import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAKEFILE = join(ROOT, 'Makefile');
const DEV_SH = join(ROOT, 'scripts', 'dev.sh');

const makefile = readFileSync(MAKEFILE, 'utf8');
const devsh = readFileSync(DEV_SH, 'utf8');

function probe(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: result.status === 0 && !result.error, result };
}

function findBash() {
  if (probe('bash', ['-c', 'echo ok']).result.stdout?.trim() === 'ok') return 'bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    '/usr/bin/bash',
    '/bin/bash',
  ];
  for (const candidate of candidates) {
    if (probe(candidate, ['-c', 'echo ok']).result.stdout?.trim() === 'ok') return candidate;
  }
  return null;
}

test('Makefile exposes documented targets', () => {
  for (const target of ['help', 'dev', 'test', 'lint', 'check']) {
    assert.match(makefile, new RegExp(`^${target}:.*?## `, 'm'), `missing documented target ${target}`);
  }
});

test('test and lint targets delegate to the available package manager', () => {
  assert.match(makefile, /PKG_MANAGER\s*\?=\s*\$\(shell command -v pnpm/);
  assert.match(makefile, /^test:.*\n\t\$\(PKG_MANAGER\) run test/m);
  assert.match(makefile, /^lint:.*\n\t\$\(PKG_MANAGER\) run lint/m);
});

test('dev target delegates to scripts/dev.sh, tracked as executable', () => {
  assert.match(makefile, /^dev:.*\n\t\.\/scripts\/dev\.sh/m);
  const tracked = spawnSync('git', ['ls-files', '-s', 'scripts/dev.sh'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.equal(tracked.status, 0, tracked.stderr || '');
  assert.match(tracked.stdout, /^100755 /, 'dev.sh must be tracked with the executable bit');
});

test('dev.sh selects pnpm or npm and runs install + start', () => {
  assert.match(devsh, /^#!\/usr\/bin\/env bash/m);
  assert.match(devsh, /set -euo pipefail/);
  assert.match(devsh, /command -v pnpm/);
  assert.match(devsh, /command -v npm/);
  assert.match(devsh, /\$PM" install/);
  assert.match(devsh, /\$PM" run start/);
});

test('dev.sh passes bash syntax check', (t) => {
  const bash = findBash();
  if (!bash) t.skip('a real bash not available');
  const result = spawnSync(bash, ['-n', DEV_SH], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || '');
});

test('make can parse and dry-run every target when make is available', (t) => {
  if (!probe('make', ['--version']).ok) t.skip('make not available');
  const result = spawnSync('make', ['-n', 'help', 'test', 'lint', 'check'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || '');
  assert.match(result.stdout, /run test/);
  assert.match(result.stdout, /run lint/);
});
