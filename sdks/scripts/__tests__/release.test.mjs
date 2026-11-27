/**
 * Tests for the SDK release library. Run with:
 *   node --test sdks/scripts/__tests__/release.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogHasEntry,
  checkVersions,
  escapeGoModulePath,
  goModulePath,
  goTag,
  npmDistTag,
  parseVersion,
  planRelease,
  registryStatus,
  registryUrls,
  renderSummary,
  setVersions,
  toPep440,
} from '../lib/release.mjs';

const SDK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRepo = (rel) => readFileSync(join(SDK_ROOT, rel), 'utf8');

/** In-memory copy of the real version-bearing files. */
function fixtureFs() {
  const files = new Map(
    [
      'javascript/package.json',
      'javascript/src/version.ts',
      'python/setup.py',
      'python/subtrackr/version.py',
      'go/version.go',
      'go/go.mod',
    ].map((f) => [f, readRepo(f)])
  );
  return {
    files,
    read: (f) => {
      if (!files.has(f)) throw new Error(`ENOENT ${f}`);
      return files.get(f);
    },
    write: (f, c) => files.set(f, c),
  };
}

const response = (status) => ({ status });

describe('versions', () => {
  test('parses stable and pre-release versions', () => {
    assert.deepEqual(parseVersion('2.1.3'), {
      raw: '2.1.3',
      major: 2,
      minor: 1,
      patch: 3,
      pre: null,
    });
    assert.deepEqual(parseVersion(' 3.0.0-rc.2\n').pre, { label: 'rc', number: 2 });
  });

  test('rejects malformed versions and unsupported pre-release labels', () => {
    for (const bad of ['2.1', 'v2.1.0', '02.1.0', '2.1.0-dev.1', '2.1.0-rc', '2.1.0-rc.01', '']) {
      assert.throws(() => parseVersion(bad), /Invalid SDK version/, bad);
    }
  });

  test('maps to PEP 440 and npm dist-tags', () => {
    assert.equal(toPep440(parseVersion('2.1.0')), '2.1.0');
    assert.equal(toPep440(parseVersion('2.1.0-alpha.1')), '2.1.0a1');
    assert.equal(toPep440(parseVersion('2.1.0-beta.3')), '2.1.0b3');
    assert.equal(toPep440(parseVersion('2.1.0-rc.2')), '2.1.0rc2');
    assert.equal(npmDistTag(parseVersion('2.1.0')), 'latest');
    assert.equal(npmDistTag(parseVersion('2.1.0-rc.1')), 'next');
  });

  test('applies Go semantic import versioning', () => {
    assert.equal(goModulePath(parseVersion('1.4.0')), 'github.com/Smartdevs17/SubTrackr/sdks/go');
    assert.equal(
      goModulePath(parseVersion('2.0.0')),
      'github.com/Smartdevs17/SubTrackr/sdks/go/v2'
    );
    assert.equal(
      goModulePath(parseVersion('3.0.0-rc.1')),
      'github.com/Smartdevs17/SubTrackr/sdks/go/v3'
    );
    assert.equal(goTag(parseVersion('2.0.1')), 'sdks/go/v2.0.1');
    assert.equal(
      escapeGoModulePath('github.com/Smartdevs17/SubTrackr/sdks/go/v2'),
      'github.com/!smartdevs17/!sub!trackr/sdks/go/v2'
    );
  });
});

describe('manifest sync', () => {
  test('the committed SDK files match sdks/VERSION', () => {
    const version = readRepo('VERSION').trim();
    assert.deepEqual(checkVersions(version, readRepo), []);
    assert.ok(changelogHasEntry(readRepo('CHANGELOG.md'), version));
  });

  test('reports every file that disagrees', () => {
    const fs = fixtureFs();
    const problems = checkVersions('2.4.0', fs.read);
    assert.equal(problems.length, 7); // all but go.mod, whose /v2 path still holds
    assert.ok(problems.some((p) => p.startsWith('python/setup.py: setup() version is "2.0.0"')));
  });

  test('reports missing files and missing markers', () => {
    const fs = fixtureFs();
    fs.files.delete('go/version.go');
    fs.write('python/setup.py', 'setup(name="x")');
    const problems = checkVersions('2.0.0', fs.read);
    assert.ok(problems.includes('go/version.go: file not found'));
    assert.ok(problems.includes('python/setup.py: could not find setup() version'));
  });

  test('set rewrites every file so check passes', () => {
    const fs = fixtureFs();
    const changed = setVersions('3.1.0-rc.1', fs.read, fs.write);
    assert.deepEqual(changed.sort(), [...fs.files.keys()].sort());
    assert.deepEqual(checkVersions('3.1.0-rc.1', fs.read), []);
    assert.match(fs.read('python/setup.py'), /version="3\.1\.0rc1"/);
    assert.match(
      fs.read('python/subtrackr/version.py'),
      /SDK_VERSION_TUPLE: tuple\[int, int, int\] = \(3, 1, 0\)/
    );
    assert.match(fs.read('javascript/src/version.ts'), /major: 3,\n {2}minor: 1,\n {2}patch: 0,/);
    assert.match(
      fs.read('go/go.mod'),
      /^module github\.com\/Smartdevs17\/SubTrackr\/sdks\/go\/v3$/m
    );
  });

  test('set is idempotent', () => {
    const fs = fixtureFs();
    setVersions('2.0.0', fs.read, fs.write);
    assert.deepEqual(setVersions('2.0.0', fs.read, fs.write), []);
  });

  test('set leaves everything untouched when a marker is missing', () => {
    const fs = fixtureFs();
    const before = new Map(fs.files);
    fs.write('go/version.go', 'package subtrackr\n');
    assert.throws(() => setVersions('2.1.0', fs.read, fs.write), /go\/version\.go/);
    assert.equal(fs.read('javascript/package.json'), before.get('javascript/package.json'));
  });

  test('changelog entries must match the exact version', () => {
    const log = '# Changelog\n\n## [2.1.0]\n\n- x\n\n## [2.0.0]\n';
    assert.ok(changelogHasEntry(log, '2.1.0'));
    assert.ok(!changelogHasEntry(log, '2.1'));
    assert.ok(!changelogHasEntry(log, '2.1.0-rc.1'));
    assert.ok(!changelogHasEntry('see [2.1.0] notes', '2.1.0'));
  });
});

describe('release plan', () => {
  test('publishes only for a matching sdk tag push', () => {
    const plan = planRelease({ version: '2.1.0', eventName: 'push', ref: 'refs/tags/sdk-v2.1.0' });
    assert.deepEqual(plan, {
      version: '2.1.0',
      pythonVersion: '2.1.0',
      npmTag: 'latest',
      goModule: 'github.com/Smartdevs17/SubTrackr/sdks/go/v2',
      goTag: 'sdks/go/v2.1.0',
      prerelease: false,
      publish: true,
    });
  });

  test('every other trigger is a dry run', () => {
    for (const [eventName, ref] of [
      ['pull_request', 'refs/pull/12/merge'],
      ['push', 'refs/heads/main'],
      ['workflow_dispatch', 'refs/heads/main'],
      ['workflow_dispatch', 'refs/tags/sdk-v2.1.0'],
      ['local', ''],
    ]) {
      assert.equal(
        planRelease({ version: '2.1.0', eventName, ref }).publish,
        false,
        `${eventName} ${ref}`
      );
    }
  });

  test('rejects tags that do not match sdks/VERSION', () => {
    assert.throws(
      () => planRelease({ version: '2.1.0', eventName: 'push', ref: 'refs/tags/sdk-v2.0.9' }),
      /does not match sdks\/VERSION \(2\.1\.0\)/
    );
    assert.throws(
      () => planRelease({ version: '2.1.0', eventName: 'push', ref: 'refs/tags/v2.1.0' }),
      /not an SDK release tag/
    );
  });

  test('routes pre-releases to the next dist-tag', () => {
    const plan = planRelease({
      version: '2.2.0-beta.1',
      eventName: 'push',
      ref: 'refs/tags/sdk-v2.2.0-beta.1',
    });
    assert.equal(plan.npmTag, 'next');
    assert.equal(plan.pythonVersion, '2.2.0b1');
    assert.equal(plan.prerelease, true);
  });
});

describe('registry status', () => {
  const plan = planRelease({ version: '2.1.0', eventName: 'local', ref: '' });

  test('builds the per-registry version URLs', () => {
    assert.deepEqual(registryUrls(plan), {
      npm: 'https://registry.npmjs.org/@subtrackr%2Fsdk/2.1.0',
      pypi: 'https://pypi.org/pypi/subtrackr-sdk/2.1.0/json',
      go: 'https://proxy.golang.org/github.com/!smartdevs17/!sub!trackr/sdks/go/v2/@v/v2.1.0.info',
    });
  });

  test('treats 200 as published and 404/410 as not published', async () => {
    const codes = { 'registry.npmjs.org': 200, 'pypi.org': 404, 'proxy.golang.org': 410 };
    const fetchImpl = async (url) => response(codes[new URL(url).host]);
    assert.deepEqual(await registryStatus(plan, { fetchImpl }), {
      npm: true,
      pypi: false,
      go: false,
    });
  });

  test('retries transient failures', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new Error('ECONNRESET');
      if (calls === 2) return response(503);
      return response(404);
    };
    const status = await registryStatus(plan, { fetchImpl, delayMs: 0 });
    assert.equal(status.npm, false);
    assert.equal(calls, 5); // 3 for npm, then 1 each for PyPI and Go
  });

  test('fails closed when a registry keeps erroring', async () => {
    const fetchImpl = async () => response(500);
    await assert.rejects(
      registryStatus(plan, { fetchImpl, retries: 2, delayMs: 0 }),
      /Registry check failed after 2 attempts: .* returned HTTP 500/
    );
  });
});

describe('summary', () => {
  const ok = { result: 'success', alreadyPublished: false };

  test('reports published, skipped and failed SDKs', () => {
    const plan = planRelease({ version: '2.1.0', eventName: 'push', ref: 'refs/tags/sdk-v2.1.0' });
    const md = renderSummary(plan, {
      javascript: ok,
      python: { result: 'success', alreadyPublished: true },
      go: { result: 'failure', alreadyPublished: false },
    });
    assert.match(md, /^## SDK release 2\.1\.0\n/);
    assert.match(
      md,
      /\| JavaScript \| npm `@subtrackr\/sdk@2\.1\.0` \(latest\) \| ✅ success \| published \|/
    );
    assert.match(
      md,
      /\| Python \| PyPI `subtrackr-sdk==2\.1\.0` \| ✅ success \| already published, skipped \|/
    );
    assert.match(md, /\| Go \| .* \| ❌ failure \| — \|/);
  });

  test('labels dry runs', () => {
    const plan = planRelease({ version: '2.1.0', eventName: 'pull_request', ref: '' });
    const md = renderSummary(plan, { javascript: ok, python: ok, go: ok });
    assert.match(md, /\(dry run\)/);
    assert.equal(md.match(/dry run \(not published\)/g).length, 3);
  });
});
