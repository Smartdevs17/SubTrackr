import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = resolve(import.meta.dirname, '../..');
const guard = join(repoRoot, 'scripts', 'no-console.sh');
const hook = join(repoRoot, '.husky', 'pre-push');

function findBash() {
  for (const candidate of ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
    try {
      if (spawnSync(candidate, ['-c', 'true'], { stdio: 'ignore' }).status === 0) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

const bash = findBash();

function run(args = [], cwd = repoRoot, env = {}) {
  assert.ok(bash, 'a bash interpreter is required for this guard');
  return spawnSync(bash, [guard, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'subtrackr-noconsole-'));
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

test('guard ships as an executable file and the hook is wired to it', () => {
  assert.ok(existsSync(guard));
  assert.ok(existsSync(hook));
  const hookSource = readFileSync(hook, 'utf8');
  assert.match(hookSource, /scripts\/no-console\.sh/);
  assert.match(hookSource, /pre-push/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(guard).mode & 0o111, 0o111);
    assert.equal(statSync(hook).mode & 0o111, 0o111);
  }
});

test('--help documents usage without scanning', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr || '');
  assert.match(result.stdout, /Usage:\s*scripts\/no-console\.sh/);
});

test('clean application code passes and reports the scan', () => {
  const dir = fixture({ 'app/clean.ts': 'export const ok = 1;\n' });
  try {
    const result = run(['app'], dir);
    assert.equal(result.status, 0, result.stderr || '');
    assert.match(result.stdout, /no-console: clean/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('console.log in app code fails with file and line', () => {
  const dir = fixture({ 'app/bad.ts': 'const a = 1;\nconsole.log("debug", a);\n' });
  try {
    const result = run(['app'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /bad\.ts:2:/);
    assert.match(result.stderr, /1 console\.log call\(s\) found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('spaced and bracket-free variants are still detected', () => {
  const dir = fixture({ 'src/spaced.ts': "console . log ( 'x' );\n" });
  try {
    const result = run(['src'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /spaced\.ts:1:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('console.warn/error/debug are allowed', () => {
  const dir = fixture({ 'app/logs.ts': 'console.warn("w");\nconsole.error("e");\nconsole.debug("d");\n' });
  try {
    const result = run(['app'], dir);
    assert.equal(result.status, 0, result.stderr || '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('test files, mocks and tooling directories are ignored', () => {
  const dir = fixture({
    'src/feature.test.ts': 'console.log("test");\n',
    'src/__tests__/feature.ts': 'console.log("test");\n',
    'src/__mocks__/api.ts': 'console.log("mock");\n',
    'scripts/tool.mjs': 'console.log("tool");\n',
    'e2e/flow.ts': 'console.log("e2e");\n',
  });
  try {
    const result = run([], dir);
    assert.equal(result.status, 0, result.stderr || '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('node_modules and build output are ignored', () => {
  const dir = fixture({
    'app/real.ts': 'export const ok = 1;\n',
    'node_modules/pkg/index.js': 'console.log("dep");\n',
    'dist/bundle.js': 'console.log("bundle");\n',
  });
  try {
    const result = run([], dir);
    assert.equal(result.status, 0, result.stderr || '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('multiple paths are scanned and every hit is reported', () => {
  const dir = fixture({
    'app/a.ts': 'console.log("a");\n',
    'src/b.tsx': 'console.log("b");\n',
  });
  try {
    const result = run(['app', 'src'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /a\.ts:1:/);
    assert.match(result.stdout, /b\.tsx:1:/);
    assert.match(result.stderr, /2 console\.log call\(s\) found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('NO_CONSOLE_SKIP bypasses the guard with a visible warning', () => {
  const dir = fixture({ 'app/bad.ts': 'console.log("debug");\n' });
  try {
    const result = run(['app'], dir, { NO_CONSOLE_SKIP: '1' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /SKIPPED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
