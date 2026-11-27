#!/usr/bin/env node
/**
 * SDK release CLI. See sdks/docs/releasing.md.
 *
 *   node sdks/scripts/release.mjs check            # manifests + changelog match sdks/VERSION
 *   node sdks/scripts/release.mjs set 2.1.0        # write a new version everywhere
 *   node sdks/scripts/release.mjs plan             # decide dry run vs publish (CI)
 *   node sdks/scripts/release.mjs registry-status  # which registries already have it (CI)
 *   node sdks/scripts/release.mjs summary          # job summary table (CI)
 *
 * In GitHub Actions, `plan` and `registry-status` write to $GITHUB_OUTPUT and
 * `summary` writes to $GITHUB_STEP_SUMMARY. Logs are `[sdk-release]` lines
 * with `::error::` annotations on failure.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogHasEntry,
  checkVersions,
  parseVersion,
  planRelease,
  registryStatus,
  renderSummary,
  setVersions,
} from './lib/release.mjs';

const SDK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(SDK_ROOT, rel), 'utf8');
const write = (rel, content) => writeFileSync(join(SDK_ROOT, rel), content);

const log = (msg) => console.log(`[sdk-release] ${msg}`);
const fail = (msg) => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${msg}` : `[sdk-release] ERROR: ${msg}`);
  process.exitCode = 1;
};

function setOutputs(outputs) {
  for (const [k, v] of Object.entries(outputs)) log(`${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([k, v]) => `${k}=${v}\n`)
        .join('')
    );
  }
}

const currentVersion = () => read('VERSION').trim();

function currentPlan() {
  return planRelease({
    version: currentVersion(),
    eventName: process.env.GITHUB_EVENT_NAME ?? 'local',
    ref: process.env.GITHUB_REF ?? '',
  });
}

const commands = {
  check() {
    const version = currentVersion();
    parseVersion(version);
    const problems = checkVersions(version, read);
    if (!changelogHasEntry(read('CHANGELOG.md'), version)) {
      problems.push(`CHANGELOG.md: no "## [${version}]" section`);
    }
    if (problems.length > 0) {
      problems.forEach(fail);
      fail(
        `SDK versions are out of sync with sdks/VERSION (${version}). Run: node sdks/scripts/release.mjs set ${version}`
      );
      return;
    }
    log(`all SDK manifests match ${version}`);
  },

  set(version) {
    if (!version) throw new Error('Usage: release.mjs set <version>');
    parseVersion(version);
    write('VERSION', `${version}\n`);
    const changed = setVersions(version, read, write);
    log(`set SDK version to ${version}; updated ${['VERSION', ...changed].join(', ')}`);
    if (!changelogHasEntry(read('CHANGELOG.md'), version)) {
      log(`next: add a "## [${version}]" section to sdks/CHANGELOG.md`);
    }
  },

  plan() {
    const plan = currentPlan();
    setOutputs({
      version: plan.version,
      python_version: plan.pythonVersion,
      npm_tag: plan.npmTag,
      go_module: plan.goModule,
      go_tag: plan.goTag,
      prerelease: plan.prerelease,
      publish: plan.publish,
    });
  },

  async 'registry-status'() {
    const status = await registryStatus(currentPlan());
    setOutputs({
      npm_published: status.npm,
      pypi_published: status.pypi,
      go_published: status.go,
    });
  },

  summary() {
    const env = process.env;
    const job = (name) => ({
      result: env[`${name.toUpperCase()}_RESULT`] ?? 'skipped',
      alreadyPublished: env[`${name.toUpperCase()}_ALREADY_PUBLISHED`] === 'true',
    });
    const markdown = renderSummary(currentPlan(), {
      javascript: job('javascript'),
      python: job('python'),
      go: job('go'),
    });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);
    if (['javascript', 'python', 'go'].some((n) => job(n).result !== 'success')) {
      fail('one or more SDK jobs did not succeed');
    }
  },
};

const [command, ...args] = process.argv.slice(2);
const run = commands[command];
if (!run) {
  console.error(`Usage: release.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
try {
  await run(...args);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
