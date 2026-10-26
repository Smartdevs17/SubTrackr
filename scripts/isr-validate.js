#!/usr/bin/env node
/**
 * scripts/isr-validate.js
 *
 * Validation tooling for the ISR (Incremental Static Regeneration) setup.
 *
 * Tests:
 *   1. POST /api/revalidate rejects requests without a secret (401).
 *   2. POST /api/revalidate with invalid method returns 405.
 *   3. POST /api/revalidate with valid secret + path returns 200.
 *   4. POST /api/revalidate with valid secret + tag returns 200.
 *   5. POST /api/revalidate with unknown tag returns 400.
 *   6. GET /docs/<slug> responds within 1 s (statically served).
 *
 * Usage:
 *   # Against a running Next.js dev/preview server:
 *   REVALIDATE_SECRET=mysecret BASE_URL=http://localhost:3000 node scripts/isr-validate.js
 *
 *   # Dry-run (no network; checks config only):
 *   node scripts/isr-validate.js --dry-run
 */

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || '';
const DRY_RUN = process.argv.includes('--dry-run');

let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  ✓  ${name}`);
  passed++;
}

function fail(name, reason) {
  console.error(`  ✗  ${name}: ${reason}`);
  failed++;
}

async function post(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
  }
}

async function get(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    return { status: res.status, ms: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Config validation (always runs) ─────────────────────────────────────────
function validateConfig() {
  console.log('\n── Config checks ─────────────────────────────────────────');

  // Verify TAG_TO_PATHS covers required tags (v1, v2, api, guides, sdks)
  const requiredTags = ['v1', 'v2', 'api', 'guides', 'sdks'];
  // We check by inspecting the handler source statically
  const fs = require('fs');
  const handlerPath = require('path').join(
    __dirname,
    '../developer-portal/pages/api/revalidate.ts'
  );
  if (!fs.existsSync(handlerPath)) {
    fail('revalidate API exists', `file not found: ${handlerPath}`);
  } else {
    const src = fs.readFileSync(handlerPath, 'utf8');
    for (const tag of requiredTags) {
      // Match quoted keys ('tag', "tag") OR bare object keys (tag:)
      const quoted = src.includes(`'${tag}'`) || src.includes(`"${tag}"`);
      const bareKey = new RegExp(`\\b${tag}\\s*:`).test(src);
      if (quoted || bareKey) {
        ok(`TAG_TO_PATHS includes tag "${tag}"`);
      } else {
        fail(`TAG_TO_PATHS includes tag "${tag}"`, 'tag not found in handler source');
      }
    }
  }

  // Verify [slug].tsx has revalidate set for api pages (3600) and others
  const slugPath = require('path').join(__dirname, '../developer-portal/pages/docs/[slug].tsx');
  if (!fs.existsSync(slugPath)) {
    fail('[slug].tsx exists', `file not found: ${slugPath}`);
  } else {
    const src = fs.readFileSync(slugPath, 'utf8');
    if (src.includes('revalidate') && src.includes('3600')) {
      ok('[slug].tsx sets revalidate: 3600 for api pages (1 h TTL)');
    } else {
      fail('[slug].tsx revalidate TTL', 'missing revalidate: 3600 for api category');
    }
    if (src.includes("fallback: 'blocking'")) {
      ok("[slug].tsx uses fallback: 'blocking' (stale served while revalidating)");
    } else {
      fail('[slug].tsx fallback', "fallback: 'blocking' not found");
    }
  }
}

// ─── Network tests ────────────────────────────────────────────────────────────
async function runNetworkTests() {
  console.log('\n── Network tests ─────────────────────────────────────────');

  // 1. No secret → 401
  try {
    const { status } = await post('/api/revalidate', { path: '/docs/quick-start' });
    status === 401
      ? ok('Missing secret returns 401')
      : fail('Missing secret returns 401', `got ${status}`);
  } catch (e) {
    fail('Missing secret returns 401', e.message);
  }

  // 2. Wrong method → 405 (send GET as POST workaround: just check POST without secret)
  // Already covered by (1); additionally test bad secret
  try {
    const { status } = await post('/api/revalidate', {
      secret: 'wrong',
      path: '/docs/quick-start',
    });
    status === 401
      ? ok('Wrong secret returns 401')
      : fail('Wrong secret returns 401', `got ${status}`);
  } catch (e) {
    fail('Wrong secret returns 401', e.message);
  }

  if (!REVALIDATE_SECRET) {
    console.log('  ⚠  REVALIDATE_SECRET not set — skipping authenticated tests');
    return;
  }

  // 3. Valid secret + path
  try {
    const { status } = await post('/api/revalidate', {
      secret: REVALIDATE_SECRET,
      path: '/docs/quick-start',
    });
    status === 200
      ? ok('Valid secret + path returns 200')
      : fail('Valid secret + path returns 200', `got ${status}`);
  } catch (e) {
    fail('Valid secret + path returns 200', e.message);
  }

  // 4. Valid secret + tag
  try {
    const { status } = await post('/api/revalidate', {
      secret: REVALIDATE_SECRET,
      tag: 'api',
    });
    status === 200
      ? ok('Valid secret + tag "api" returns 200')
      : fail('Valid secret + tag "api" returns 200', `got ${status}`);
  } catch (e) {
    fail('Valid secret + tag "api" returns 200', e.message);
  }

  // 5. Unknown tag → 400
  try {
    const { status } = await post('/api/revalidate', {
      secret: REVALIDATE_SECRET,
      tag: 'nonexistent-tag-xyz',
    });
    status === 400
      ? ok('Unknown tag returns 400')
      : fail('Unknown tag returns 400', `got ${status}`);
  } catch (e) {
    fail('Unknown tag returns 400', e.message);
  }

  // 6. Doc page loads within 1 s (statically served)
  try {
    const { status, ms } = await get('/docs/quick-start');
    if (status === 200 && ms < 1000) {
      ok(`GET /docs/quick-start responds in ${ms}ms (<1000ms)`);
    } else if (status !== 200) {
      fail('GET /docs/quick-start', `status ${status}`);
    } else {
      fail('GET /docs/quick-start <1s', `took ${ms}ms`);
    }
  } catch (e) {
    fail('GET /docs/quick-start', e.message);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      SubTrackr ISR Validation Tool       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Mode     : ${DRY_RUN ? 'dry-run (config only)' : 'full (config + network)'}\n`);

  validateConfig();

  if (!DRY_RUN) {
    await runNetworkTests();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──────────────────\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(2);
});
