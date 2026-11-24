import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(root, 'scripts', 'typecheck.sh');

function findBash() {
  for (const candidate of ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe',
                           'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
    const r = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && !/windows subsystem/i.test(r.stdout || '')) return candidate;
  }
  throw new Error('bash not found');
}
const BASH = findBash();
const run = (args, opts = {}) => spawnSync(BASH, [scriptPath, ...args], {
  encoding: 'utf8', cwd: opts.cwd || root,
  env: { ...process.env, ...(opts.env || {}) }, timeout: 20000,
});

function fixture(name, { stub = 'pnpm', stubExit = 0, turbo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'typecheck-test-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","scripts":{"typecheck":"true"}}\n');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, stub), `#!/usr/bin/env bash\necho "${stub.toUpperCase()}_TYPECHECK_CALLED"\nexit ${stubExit}\n`, { mode: 0o755 });
  if (turbo) {
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '.bin', 'turbo'), '#!/usr/bin/env bash\necho TURBO_CALLED\nexit 0\n', { mode: 0o755 });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('turbo.json declares a cacheable incremental typecheck task', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'));
  const task = cfg.tasks && cfg.tasks.typecheck;
  assert.ok(task, 'tasks.typecheck present');
  assert.equal(task.cache, true);
  assert.ok(task.dependsOn.includes('^typecheck'));
  assert.ok(task.inputs.includes('$TURBO_DEFAULT$'));
});

test('script exists and is committed executable', () => {
  assert.ok(existsSync(scriptPath));
  const git = spawnSync('git', ['ls-files', '-s', 'scripts/typecheck.sh'], { encoding: 'utf8', cwd: root });
  assert.match(git.stdout, /^100755 /);
});

test('--help documents usage and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: scripts\/typecheck\.sh/);
});

test('TYPECHECK_SKIP=1 skips without running a package manager', () => {
  const f = fixture('skip');
  try {
    const r = run([], { cwd: f.dir, env: { TYPECHECK_SKIP: '1', PATH: join(f.dir, 'bin') + ';' + process.env.PATH } });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /skipped via TYPECHECK_SKIP=1/);
    assert.doesNotMatch(r.stdout, /PNPM_TYPECHECK_CALLED/);
  } finally { f.cleanup(); }
});

test('missing package.json fails with a clear error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'typecheck-empty-'));
  try {
    const r = run([], { cwd: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no package\.json found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('falls back to package manager when turbo is absent', () => {
  const f = fixture('fallback');
  try {
    const r = run([], { cwd: f.dir, env: { PATH: join(f.dir, 'bin') + ';' + process.env.PATH } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /PNPM_TYPECHECK_CALLED/);
    assert.match(r.stdout, /falling back to pnpm run typecheck/);
  } finally { f.cleanup(); }
});

test('propagates a failing package manager exit code', () => {
  const f = fixture('fail', { stubExit: 3 });
  try {
    const r = run([], { cwd: f.dir, env: { PATH: join(f.dir, 'bin') + ';' + process.env.PATH } });
    assert.equal(r.status, 3);
  } finally { f.cleanup(); }
});

test('uses turbo when installed in the project', () => {
  const f = fixture('turbo', { turbo: true });
  try {
    const r = run([], { cwd: f.dir, env: { PATH: join(f.dir, 'bin') + ';' + process.env.PATH } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /TURBO_CALLED/);
    assert.match(r.stdout, /turbo incremental cache enabled/);
  } finally { f.cleanup(); }
});
