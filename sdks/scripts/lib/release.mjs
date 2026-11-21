/**
 * SDK release library: one version for the JavaScript, Python and Go SDKs.
 *
 * `sdks/VERSION` is the single source of truth. Everything here is pure or
 * takes its I/O (file reads/writes, fetch) as arguments so it can be unit
 * tested without touching the repo or the network. The CLI lives in
 * ../release.mjs.
 */

// ── Versions ──────────────────────────────────────────────────────────────────

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

/**
 * Parses `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-(alpha|beta|rc).N`.
 * Other pre-release labels are rejected because they have no PEP 440 form.
 */
export function parseVersion(input) {
  const version = String(input).trim();
  const m = SEMVER_RE.exec(version);
  if (!m) {
    throw new Error(
      `Invalid SDK version "${version}". Expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-(alpha|beta|rc).N`
    );
  }
  return {
    raw: version,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? { label: m[4], number: Number(m[5]) } : null,
  };
}

/** PEP 440 spelling used by PyPI: `2.1.0-rc.1` → `2.1.0rc1`. */
export function toPep440(v) {
  if (!v.pre) return `${v.major}.${v.minor}.${v.patch}`;
  const label = { alpha: 'a', beta: 'b', rc: 'rc' }[v.pre.label];
  return `${v.major}.${v.minor}.${v.patch}${label}${v.pre.number}`;
}

/** npm dist-tag: pre-releases go to `next` so `npm install` keeps getting stable. */
export function npmDistTag(v) {
  return v.pre ? 'next' : 'latest';
}

// ── Go module path (semantic import versioning) ───────────────────────────────

export const GO_MODULE_BASE = 'github.com/Smartdevs17/SubTrackr/sdks/go';

/** Go requires a `/vN` suffix on the module path from v2 onwards. */
export function goModulePath(v) {
  return v.major >= 2 ? `${GO_MODULE_BASE}/v${v.major}` : GO_MODULE_BASE;
}

/** Tag Go resolves for a module in the `sdks/go` subdirectory. */
export function goTag(v) {
  return `sdks/go/v${v.raw}`;
}

/** proxy.golang.org path escaping: each upper-case letter becomes `!` + lower-case. */
export function escapeGoModulePath(path) {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

// ── Version-bearing files ─────────────────────────────────────────────────────

/**
 * Every file that carries the SDK version, with how to read and rewrite it.
 * Paths are relative to `sdks/`. `expected(v)` is the value that file must
 * hold for version `v`.
 */
export const VERSION_TARGETS = [
  {
    file: 'javascript/package.json',
    label: 'npm package version',
    pattern: /("version"\s*:\s*")([^"]+)(")/,
    expected: (v) => v.raw,
  },
  {
    file: 'javascript/src/version.ts',
    label: 'SDK_VERSION',
    pattern: /(export const SDK_VERSION = ')([^']+)(')/,
    expected: (v) => v.raw,
  },
  {
    file: 'javascript/src/version.ts',
    label: 'SDK_VERSION_INFO',
    pattern: /(export const SDK_VERSION_INFO = \{\s*major: )(\d+,\s*minor: \d+,\s*patch: \d+)(,)/,
    expected: (v) => `${v.major},\n  minor: ${v.minor},\n  patch: ${v.patch}`,
    normalize: (s) => s.replace(/\s+/g, ' '),
  },
  {
    file: 'python/setup.py',
    label: 'setup() version',
    pattern: /(version=")([^"]+)(")/,
    expected: toPep440,
  },
  {
    file: 'python/subtrackr/version.py',
    label: 'SDK_VERSION',
    pattern: /(SDK_VERSION: str = ")([^"]+)(")/,
    expected: toPep440,
  },
  {
    file: 'python/subtrackr/version.py',
    label: 'SDK_VERSION_TUPLE',
    pattern: /(SDK_VERSION_TUPLE: tuple\[int, int, int\] = \()([^)]+)(\))/,
    expected: (v) => `${v.major}, ${v.minor}, ${v.patch}`,
  },
  {
    file: 'go/version.go',
    label: 'SDKVersion',
    pattern: /(const SDKVersion = ")([^"]+)(")/,
    expected: (v) => v.raw,
  },
  {
    file: 'go/go.mod',
    label: 'module path',
    pattern: /^(module )(\S+)()$/m,
    expected: goModulePath,
  },
];

/**
 * Compares every target against `version`.
 * @param readFile (relPath) => string
 * @returns list of human-readable mismatches (empty when in sync)
 */
export function checkVersions(version, readFile) {
  const v = parseVersion(version);
  const problems = [];
  for (const target of VERSION_TARGETS) {
    let content;
    try {
      content = readFile(target.file);
    } catch {
      problems.push(`${target.file}: file not found`);
      continue;
    }
    const m = target.pattern.exec(content);
    if (!m) {
      problems.push(`${target.file}: could not find ${target.label}`);
      continue;
    }
    const norm = target.normalize ?? ((s) => s);
    const want = target.expected(v);
    if (norm(m[2]) !== norm(want)) {
      problems.push(`${target.file}: ${target.label} is "${norm(m[2])}", expected "${norm(want)}"`);
    }
  }
  return problems;
}

/**
 * Rewrites every target to `version`.
 * @returns list of files that changed
 */
export function setVersions(version, readFile, writeFile) {
  const v = parseVersion(version);
  const contents = new Map();
  for (const target of VERSION_TARGETS) {
    const content = contents.get(target.file) ?? readFile(target.file);
    if (!target.pattern.test(content)) {
      throw new Error(`${target.file}: could not find ${target.label}`);
    }
    contents.set(
      target.file,
      content.replace(target.pattern, (_, pre, _old, post) => `${pre}${target.expected(v)}${post}`)
    );
  }
  const changed = [];
  for (const [file, content] of contents) {
    if (content !== readFile(file)) {
      writeFile(file, content);
      changed.push(file);
    }
  }
  return changed;
}

/** Whether CHANGELOG.md has a `## [x.y.z]` section for this version. */
export function changelogHasEntry(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog);
}

// ── Release planning ──────────────────────────────────────────────────────────

export const TAG_PREFIX = 'sdk-v';

/**
 * Decides what a workflow run should do.
 *
 * Only a pushed `sdk-vX.Y.Z` tag publishes, and only when it matches
 * `sdks/VERSION`. Every other trigger (pull request, branch push, manual run)
 * is a dry run that builds and verifies all three SDKs.
 */
export function planRelease({ version, eventName, ref }) {
  const v = parseVersion(version);
  const isTag = eventName === 'push' && typeof ref === 'string' && ref.startsWith('refs/tags/');
  let publish = false;
  if (isTag) {
    const tag = ref.slice('refs/tags/'.length);
    if (!tag.startsWith(TAG_PREFIX)) {
      throw new Error(`Tag "${tag}" is not an SDK release tag (expected ${TAG_PREFIX}${v.raw})`);
    }
    if (tag !== `${TAG_PREFIX}${v.raw}`) {
      throw new Error(`Tag "${tag}" does not match sdks/VERSION (${v.raw})`);
    }
    publish = true;
  }
  return {
    version: v.raw,
    pythonVersion: toPep440(v),
    npmTag: npmDistTag(v),
    goModule: goModulePath(v),
    goTag: goTag(v),
    prerelease: Boolean(v.pre),
    publish,
  };
}

// ── Registry state ────────────────────────────────────────────────────────────

export const NPM_PACKAGE = '@subtrackr/sdk';
export const PYPI_PACKAGE = 'subtrackr-sdk';

export function registryUrls(plan) {
  return {
    npm: `https://registry.npmjs.org/${NPM_PACKAGE.replace('/', '%2F')}/${plan.version}`,
    pypi: `https://pypi.org/pypi/${PYPI_PACKAGE}/${plan.pythonVersion}/json`,
    go: `https://proxy.golang.org/${escapeGoModulePath(plan.goModule)}/@v/v${plan.version}.info`,
  };
}

/**
 * Whether this version is already on each registry, so a re-run of a
 * partially failed release only publishes what is missing.
 *
 * 200 means published, 404/410 means not published. Anything else is
 * retried and then thrown: publishing blind could double-publish or skip.
 */
export async function registryStatus(
  plan,
  { fetchImpl = fetch, retries = 3, delayMs = 1000 } = {}
) {
  const urls = registryUrls(plan);
  const result = {};
  for (const [registry, url] of Object.entries(urls)) {
    result[registry] = await probe(url, fetchImpl, retries, delayMs);
  }
  return result;
}

async function probe(url, fetchImpl, retries, delayMs) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
      if (res.status === 200) return true;
      if (res.status === 404 || res.status === 410) return false;
      lastError = new Error(`${url} returned HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * attempt));
  }
  throw new Error(
    `Registry check failed after ${retries} attempts: ${lastError?.message ?? lastError}`
  );
}

// ── Run summary ───────────────────────────────────────────────────────────────

/**
 * Markdown for $GITHUB_STEP_SUMMARY: one row per SDK with its job result and
 * what happened on its registry.
 */
export function renderSummary(plan, jobs) {
  const action = (job) => {
    if (job.result !== 'success') return '—';
    if (!plan.publish) return 'dry run (not published)';
    return job.alreadyPublished ? 'already published, skipped' : 'published';
  };
  const rows = [
    ['JavaScript', `npm \`${NPM_PACKAGE}@${plan.version}\` (${plan.npmTag})`, jobs.javascript],
    ['Python', `PyPI \`${PYPI_PACKAGE}==${plan.pythonVersion}\``, jobs.python],
    ['Go', `\`${plan.goModule}@v${plan.version}\``, jobs.go],
  ];
  const icon = (r) => ({ success: '✅', skipped: '⏭️', cancelled: '⚪' })[r] ?? '❌';
  return [
    `## SDK release ${plan.version}${plan.publish ? '' : ' (dry run)'}`,
    '',
    '| SDK | Package | Result | Registry |',
    '|---|---|---|---|',
    ...rows.map(
      ([name, pkg, job]) =>
        `| ${name} | ${pkg} | ${icon(job.result)} ${job.result} | ${action(job)} |`
    ),
    '',
  ].join('\n');
}
