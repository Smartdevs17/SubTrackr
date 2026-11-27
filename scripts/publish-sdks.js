#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const SPEC_PATH = path.join(root, 'developer-portal/docs/openapi.json');
const ENDPOINTS_PATH = path.join(root, 'sdks/generated/endpoints.json');
const MANIFEST_PATH = path.join(root, 'sdks/generated/publish-manifest.json');
const JS_SDK_DIR = path.join(root, 'sdks/javascript');

const TARGETS = {
  javascript: { package: '@subtrackr/sdk', registry: 'npm' },
  python: { package: 'subtrackr-sdk', registry: 'pypi' },
  go: {
    // Go semantic import versioning: the module path carries /vN from v2 on
    // (see sdks/go/go.mod and sdks/scripts/lib/release.mjs).
    package: 'github.com/Smartdevs17/SubTrackr/sdks/go/v2',
    registry: 'proxy.golang.org',
  },
};

// Matches the versions sdks/scripts/release.mjs accepts, pre-releases included.
const TAG_PATTERN = /^sdk-v(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)$/;

function assertOpenApi31(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('[sdk:publish] Missing OpenAPI document');
  }
  if (spec.openapi !== '3.1.0') {
    throw new Error(`[sdk:publish] Expected OpenAPI 3.1.0, received ${spec.openapi}`);
  }
  if (!spec.info || !spec.paths || typeof spec.paths !== 'object') {
    throw new Error('[sdk:publish] OpenAPI document is missing info or paths');
  }
}

function buildPublishPlan(spec, tag, languages = Object.keys(TARGETS)) {
  assertOpenApi31(spec);
  const match = TAG_PATTERN.exec(tag || '');
  if (!match) {
    throw new Error(
      `[sdk:publish] Invalid version tag "${tag}". Expected sdk-vX.Y.Z or sdk-vX.Y.Z-(alpha|beta|rc).N`
    );
  }
  if (!languages.length) {
    throw new Error('[sdk:publish] No SDK targets selected');
  }

  const version = match[1];
  return {
    tag,
    version,
    specVersion: spec.openapi,
    endpointCount: Object.keys(spec.paths).length,
    targets: languages.map((language) => {
      const target = TARGETS[language];
      if (!target) {
        throw new Error(`[sdk:publish] Unknown SDK target "${language}"`);
      }
      return { language, ...target, version };
    }),
  };
}

function writePublishManifest(plan, outputPath = MANIFEST_PATH) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  return outputPath;
}

function publishJavaScriptSdk() {
  execFileSync('npm', ['publish', '--access', 'public'], {
    cwd: JS_SDK_DIR,
    stdio: 'inherit',
  });
}

function parseArgs(argv) {
  const options = { tag: '', publish: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--version' || argv[i] === '--tag') {
      options.tag = argv[++i] || '';
    } else if (argv[i] === '--publish') {
      options.publish = true;
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const plan = buildPublishPlan(spec, options.tag);

  if (!fs.existsSync(ENDPOINTS_PATH)) {
    throw new Error('[sdk:publish] Run "npm run sdk:generate" before publishing');
  }

  const manifest = writePublishManifest(plan);
  console.log(`[sdk:publish] Wrote ${path.relative(root, manifest)} for ${plan.tag}`);

  if (!options.publish) {
    console.log('[sdk:publish] Dry run — no packages published.');
    return plan;
  }

  publishJavaScriptSdk();
  console.log('[sdk:publish] Published the JavaScript SDK.');
  return plan;
}

module.exports = {
  TARGETS,
  assertOpenApi31,
  buildPublishPlan,
  writePublishManifest,
  parseArgs,
  main,
};

if (require.main === module) {
  main();
}
