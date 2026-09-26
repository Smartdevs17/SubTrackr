#!/usr/bin/env node
/**
 * generate-api-changelog.js
 *
 * Issue #1179 — Add API changelog generation from spec diffs
 *
 * Diffs two OpenAPI 3.x spec files (previous vs current) and emits a
 * human-readable changelog section that matches the format already used in
 * developer-portal/docs/changelog.md.
 *
 * Usage:
 *   node scripts/generate-api-changelog.js [options]
 *
 * Options:
 *   --prev <path>      Path to the previous OpenAPI spec (JSON or YAML).
 *                      Defaults to spec/openapi.previous.json if it exists,
 *                      otherwise falls back to git show HEAD~1 of the current spec.
 *   --curr <path>      Path to the current OpenAPI spec.
 *                      Defaults to developer-portal/docs/openapi.json.
 *   --version <ver>    Version label for the new changelog section (e.g. "1.3.0").
 *                      Defaults to the `info.version` field in the current spec.
 *   --date <date>      ISO date for the section header (e.g. "2026-09-24").
 *                      Defaults to today's date.
 *   --output <path>    Append the generated section to this file.
 *                      Defaults to developer-portal/docs/changelog.md.
 *   --stdout           Print to stdout only; do not write to the output file.
 *   --breaking         Exit with code 1 if breaking changes are detected.
 *   --help             Show this help text.
 *
 * Examples:
 *   # Auto-diff using git history and append to changelog
 *   node scripts/generate-api-changelog.js
 *
 *   # Diff two explicit files, print to stdout only
 *   node scripts/generate-api-changelog.js \
 *     --prev spec/openapi.v1.2.0.json \
 *     --curr developer-portal/docs/openapi.json \
 *     --stdout
 *
 *   # CI gate: fail if breaking changes are present
 *   node scripts/generate-api-changelog.js --breaking
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    prev: null,
    curr: null,
    version: null,
    date: null,
    output: null,
    stdout: false,
    breaking: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--prev':
        args.prev = argv[++i];
        break;
      case '--curr':
        args.curr = argv[++i];
        break;
      case '--version':
        args.version = argv[++i];
        break;
      case '--date':
        args.date = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--stdout':
        args.stdout = true;
        break;
      case '--breaking':
        args.breaking = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }

  return args;
}

// ── Spec loading ─────────────────────────────────────────────────────────────

/**
 * Loads an OpenAPI spec from a file path.
 * Supports JSON only (YAML parsing would require a dependency).
 * For YAML specs, the caller should convert to JSON first via `yq` or similar.
 */
function loadSpec(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Spec file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf8').trim();
  // Attempt JSON parse
  try {
    return JSON.parse(content);
  } catch (_) {
    // Basic YAML-to-object for simple flat values (paths, info.version)
    // We only need the paths and info sections so a full YAML parser is not required.
    throw new Error(
      `Could not parse spec at ${resolved}. Only JSON specs are supported directly. ` +
        `Convert YAML to JSON first: node -e "const y=require('js-yaml'); ` +
        `const f=require('fs'); f.writeFileSync('out.json', JSON.stringify(y.load(f.readFileSync('${resolved}','utf8')),null,2))"`
    );
  }
}

/**
 * Attempts to read the previous version of the current spec from git history.
 * Returns null if git is unavailable or the file has no prior history.
 */
function loadPrevSpecFromGit(currPath) {
  try {
    const relPath = path.relative(process.cwd(), path.resolve(currPath)).replace(/\\/g, '/');
    const output = execSync(`git show HEAD~1:"${relPath}" 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!output || !output.trim()) return null;
    return JSON.parse(output);
  } catch (_) {
    return null;
  }
}

// ── Diffing helpers ──────────────────────────────────────────────────────────

/**
 * Returns a stable sorted key list from an object, filtering out undefined entries.
 */
function keys(obj) {
  return obj ? Object.keys(obj).sort() : [];
}

/**
 * Deeply compares two scalar/object values for equality (JSON-level).
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Collects all HTTP method+path pairs from a paths object.
 * Returns a Map of `"METHOD /path"` → operation object.
 */
function collectEndpoints(paths) {
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const map = new Map();
  if (!paths) return map;

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        map.set(`${method.toUpperCase()} ${pathKey}`, pathItem[method]);
      }
    }
  }
  return map;
}

/**
 * Diffs the parameters of two operations and returns change descriptions.
 */
function diffParameters(prevOp, currOp) {
  const changes = [];
  const prevParams = (prevOp.parameters || []).reduce((m, p) => {
    m.set(`${p.in}:${p.name}`, p);
    return m;
  }, new Map());
  const currParams = (currOp.parameters || []).reduce((m, p) => {
    m.set(`${p.in}:${p.name}`, p);
    return m;
  }, new Map());

  for (const [key, p] of currParams) {
    if (!prevParams.has(key)) {
      const required = p.required ? ' *(required)*' : ' *(optional)*';
      changes.push(`  - Added parameter \`${p.name}\` (${p.in})${required}`);
    }
  }
  for (const [key, p] of prevParams) {
    if (!currParams.has(key)) {
      changes.push(`  - **[Breaking]** Removed parameter \`${p.name}\` (${p.in})`);
    }
  }
  // Check required flag changes
  for (const [key, currP] of currParams) {
    const prevP = prevParams.get(key);
    if (prevP && !prevP.required && currP.required) {
      changes.push(
        `  - **[Breaking]** Parameter \`${currP.name}\` (${currP.in}) is now required`
      );
    } else if (prevP && prevP.required && !currP.required) {
      changes.push(`  - Parameter \`${currP.name}\` (${currP.in}) is now optional`);
    }
  }

  return changes;
}

/**
 * Diffs the request body schemas of two operations.
 */
function diffRequestBody(prevOp, currOp) {
  const changes = [];
  const prevBody = prevOp.requestBody;
  const currBody = currOp.requestBody;

  if (!prevBody && currBody) {
    const required = currBody.required ? ' *(required)*' : ' *(optional)*';
    changes.push(`  - Added request body${required}`);
  } else if (prevBody && !currBody) {
    changes.push(`  - **[Breaking]** Removed request body`);
  } else if (prevBody && currBody) {
    const prevSchema = getSchemaFromContent(prevBody.content);
    const currSchema = getSchemaFromContent(currBody.content);
    if (prevSchema && currSchema) {
      const fieldChanges = diffSchemaProperties(prevSchema, currSchema);
      changes.push(...fieldChanges.map((c) => `  - Request body: ${c}`));
    }
  }

  return changes;
}

/**
 * Extracts the first schema found in a content map (application/json preferred).
 */
function getSchemaFromContent(content) {
  if (!content) return null;
  if (content['application/json'] && content['application/json'].schema) {
    return content['application/json'].schema;
  }
  // Fallback to first content type
  const first = Object.values(content)[0];
  return first && first.schema ? first.schema : null;
}

/**
 * Diffs properties of two schema objects (shallow, no $ref resolution).
 */
function diffSchemaProperties(prevSchema, currSchema) {
  const changes = [];
  const prevProps = prevSchema.properties || {};
  const currProps = currSchema.properties || {};
  const prevRequired = new Set(prevSchema.required || []);
  const currRequired = new Set(currSchema.required || []);

  // Added fields
  for (const field of keys(currProps)) {
    if (!(field in prevProps)) {
      const req = currRequired.has(field) ? ' *(required)*' : ' *(optional)*';
      changes.push(`Added field \`${field}\`${req}`);
    }
  }
  // Removed fields
  for (const field of keys(prevProps)) {
    if (!(field in currProps)) {
      changes.push(`**[Breaking]** Removed field \`${field}\``);
    }
  }
  // Type changes on existing fields
  for (const field of keys(currProps)) {
    if (field in prevProps) {
      const prevType = prevProps[field].type || prevProps[field]['$ref'] || '';
      const currType = currProps[field].type || currProps[field]['$ref'] || '';
      if (prevType !== currType && prevType && currType) {
        changes.push(
          `**[Breaking]** Field \`${field}\` type changed from \`${prevType}\` to \`${currType}\``
        );
      }
      // Required → optional or vice versa
      if (!prevRequired.has(field) && currRequired.has(field)) {
        changes.push(`**[Breaking]** Field \`${field}\` is now required`);
      } else if (prevRequired.has(field) && !currRequired.has(field)) {
        changes.push(`Field \`${field}\` is now optional`);
      }
    }
  }

  return changes;
}

/**
 * Diffs the responses of two operations.
 */
function diffResponses(prevOp, currOp) {
  const changes = [];
  const prevResponses = prevOp.responses || {};
  const currResponses = currOp.responses || {};

  for (const code of keys(currResponses)) {
    if (!(code in prevResponses)) {
      changes.push(`  - Added response \`${code}\``);
    }
  }
  for (const code of keys(prevResponses)) {
    if (!(code in currResponses)) {
      changes.push(`  - **[Breaking]** Removed response \`${code}\``);
    }
  }

  // Diff response schemas for existing codes
  for (const code of keys(currResponses)) {
    if (code in prevResponses) {
      const prevSchema = getSchemaFromContent((prevResponses[code] || {}).content);
      const currSchema = getSchemaFromContent((currResponses[code] || {}).content);
      if (prevSchema && currSchema && !deepEqual(prevSchema, currSchema)) {
        const fieldChanges = diffSchemaProperties(prevSchema, currSchema);
        if (fieldChanges.length > 0) {
          changes.push(`  - Response \`${code}\` schema changed:`);
          fieldChanges.forEach((c) => changes.push(`    - ${c}`));
        }
      }
    }
  }

  return changes;
}

/**
 * Diffs security requirements on an operation.
 */
function diffSecurity(prevOp, currOp) {
  const changes = [];
  const prevSec = JSON.stringify(prevOp.security || []);
  const currSec = JSON.stringify(currOp.security || []);
  if (prevSec !== currSec) {
    changes.push(`  - Security requirements changed`);
  }
  return changes;
}

// ── Schema component diffing ─────────────────────────────────────────────────

/**
 * Diffs the components/schemas section and returns change descriptions.
 */
function diffSchemas(prevSpec, currSpec) {
  const prevSchemas = (prevSpec.components && prevSpec.components.schemas) || {};
  const currSchemas = (currSpec.components && currSpec.components.schemas) || {};
  const added = [];
  const removed = [];
  const changed = [];

  for (const name of keys(currSchemas)) {
    if (!(name in prevSchemas)) {
      added.push(`- Added schema \`${name}\``);
    } else if (!deepEqual(prevSchemas[name], currSchemas[name])) {
      const fieldChanges = diffSchemaProperties(prevSchemas[name], currSchemas[name]);
      if (fieldChanges.length > 0) {
        changed.push(`- Schema \`${name}\` changed:`);
        fieldChanges.forEach((c) => changed.push(`  - ${c}`));
      } else {
        changed.push(`- Schema \`${name}\` updated`);
      }
    }
  }
  for (const name of keys(prevSchemas)) {
    if (!(name in currSchemas)) {
      removed.push(`- **[Breaking]** Removed schema \`${name}\``);
    }
  }

  return { added, removed, changed };
}

// ── Security scheme diffing ──────────────────────────────────────────────────

function diffSecuritySchemes(prevSpec, currSpec) {
  const prevSchemes = (prevSpec.components && prevSpec.components.securitySchemes) || {};
  const currSchemes = (currSpec.components && currSpec.components.securitySchemes) || {};
  const changes = [];

  for (const name of keys(currSchemes)) {
    if (!(name in prevSchemes)) {
      changes.push(`- Added security scheme \`${name}\``);
    }
  }
  for (const name of keys(prevSchemes)) {
    if (!(name in currSchemes)) {
      changes.push(`- **[Breaking]** Removed security scheme \`${name}\``);
    }
  }
  for (const name of keys(currSchemes)) {
    if (name in prevSchemes && !deepEqual(prevSchemes[name], currSchemes[name])) {
      changes.push(`- Security scheme \`${name}\` updated`);
    }
  }

  return changes;
}

// ── Server diffing ───────────────────────────────────────────────────────────

function diffServers(prevSpec, currSpec) {
  const prevUrls = new Set((prevSpec.servers || []).map((s) => s.url));
  const currUrls = new Set((currSpec.servers || []).map((s) => s.url));
  const changes = [];

  for (const url of currUrls) {
    if (!prevUrls.has(url)) changes.push(`- Added server \`${url}\``);
  }
  for (const url of prevUrls) {
    if (!currUrls.has(url)) changes.push(`- **[Breaking]** Removed server \`${url}\``);
  }

  return changes;
}

// ── Main diff engine ─────────────────────────────────────────────────────────

/**
 * Produces a structured diff result from two OpenAPI spec objects.
 *
 * Returns:
 * {
 *   endpointsAdded:   [{ key, op }]
 *   endpointsRemoved: [{ key, op }]
 *   endpointsChanged: [{ key, op, changes: string[] }]
 *   schemasAdded:     string[]
 *   schemasRemoved:   string[]
 *   schemasChanged:   string[]
 *   securityChanges:  string[]
 *   serverChanges:    string[]
 *   hasBreaking:      boolean
 * }
 */
function diffSpecs(prevSpec, currSpec) {
  const prevEndpoints = collectEndpoints(prevSpec.paths);
  const currEndpoints = collectEndpoints(currSpec.paths);

  const endpointsAdded = [];
  const endpointsRemoved = [];
  const endpointsChanged = [];

  // Added
  for (const [key, op] of currEndpoints) {
    if (!prevEndpoints.has(key)) {
      endpointsAdded.push({ key, op });
    }
  }

  // Removed
  for (const [key, op] of prevEndpoints) {
    if (!currEndpoints.has(key)) {
      endpointsRemoved.push({ key, op });
    }
  }

  // Changed
  for (const [key, currOp] of currEndpoints) {
    if (prevEndpoints.has(key)) {
      const prevOp = prevEndpoints.get(key);
      const changes = [
        ...diffParameters(prevOp, currOp),
        ...diffRequestBody(prevOp, currOp),
        ...diffResponses(prevOp, currOp),
        ...diffSecurity(prevOp, currOp),
      ];
      if (changes.length > 0) {
        endpointsChanged.push({ key, op: currOp, changes });
      }
    }
  }

  const { added: schemasAdded, removed: schemasRemoved, changed: schemasChanged } =
    diffSchemas(prevSpec, currSpec);
  const securityChanges = diffSecuritySchemes(prevSpec, currSpec);
  const serverChanges = diffServers(prevSpec, currSpec);

  const breakingKeyword = '**[Breaking]**';
  const allText = [
    ...endpointsRemoved.map((e) => e.key),
    ...endpointsChanged.flatMap((e) => e.changes),
    ...schemasRemoved,
    ...schemasChanged,
    ...securityChanges,
    ...serverChanges,
  ].join('\n');

  const hasBreaking = allText.includes(breakingKeyword);

  return {
    endpointsAdded,
    endpointsRemoved,
    endpointsChanged,
    schemasAdded,
    schemasRemoved,
    schemasChanged,
    securityChanges,
    serverChanges,
    hasBreaking,
  };
}

// ── Markdown generation ──────────────────────────────────────────────────────

/**
 * Renders a diff result as a Markdown changelog section.
 */
function renderChangelog(diff, version, date) {
  const lines = [];

  lines.push(`## [${version}] - ${date}`);
  lines.push('');

  const hasAdded =
    diff.endpointsAdded.length > 0 ||
    diff.schemasAdded.length > 0 ||
    diff.serverChanges.some((c) => c.startsWith('- Added'));

  const hasChanged =
    diff.endpointsChanged.length > 0 ||
    diff.schemasChanged.length > 0 ||
    diff.securityChanges.length > 0 ||
    diff.serverChanges.some((c) => c.startsWith('- Security') || c.startsWith('- Updated'));

  const hasRemoved =
    diff.endpointsRemoved.length > 0 ||
    diff.schemasRemoved.length > 0 ||
    diff.serverChanges.some((c) => c.includes('**[Breaking]**'));

  // ── Added ────────────────────────────────────────────────────────────────
  if (hasAdded) {
    lines.push('### Added');
    lines.push('');

    if (diff.endpointsAdded.length > 0) {
      lines.push('**Endpoints**');
      lines.push('');
      for (const { key, op } of diff.endpointsAdded) {
        const summary = op.summary ? ` — ${op.summary}` : '';
        const tag = op.tags && op.tags[0] ? ` *(${op.tags[0]})*` : '';
        lines.push(`- \`${key}\`${tag}${summary}`);
      }
      lines.push('');
    }

    if (diff.schemasAdded.length > 0) {
      lines.push('**Schemas**');
      lines.push('');
      diff.schemasAdded.forEach((s) => lines.push(s));
      lines.push('');
    }

    const addedServers = diff.serverChanges.filter((c) => c.startsWith('- Added'));
    if (addedServers.length > 0) {
      lines.push('**Servers**');
      lines.push('');
      addedServers.forEach((s) => lines.push(s));
      lines.push('');
    }
  }

  // ── Changed ──────────────────────────────────────────────────────────────
  if (hasChanged) {
    lines.push('### Changed');
    lines.push('');

    if (diff.endpointsChanged.length > 0) {
      lines.push('**Endpoints**');
      lines.push('');
      for (const { key, op, changes } of diff.endpointsChanged) {
        const summary = op.summary ? ` — ${op.summary}` : '';
        lines.push(`- \`${key}\`${summary}`);
        changes.forEach((c) => lines.push(c));
      }
      lines.push('');
    }

    if (diff.schemasChanged.length > 0) {
      lines.push('**Schemas**');
      lines.push('');
      diff.schemasChanged.forEach((s) => lines.push(s));
      lines.push('');
    }

    if (diff.securityChanges.length > 0) {
      lines.push('**Security**');
      lines.push('');
      diff.securityChanges.forEach((s) => lines.push(s));
      lines.push('');
    }
  }

  // ── Removed / Breaking ───────────────────────────────────────────────────
  if (hasRemoved) {
    lines.push('### Removed');
    lines.push('');

    if (diff.endpointsRemoved.length > 0) {
      lines.push('**Endpoints**');
      lines.push('');
      for (const { key, op } of diff.endpointsRemoved) {
        const summary = op.summary ? ` — ${op.summary}` : '';
        lines.push(`- **[Breaking]** \`${key}\`${summary}`);
      }
      lines.push('');
    }

    if (diff.schemasRemoved.length > 0) {
      lines.push('**Schemas**');
      lines.push('');
      diff.schemasRemoved.forEach((s) => lines.push(s));
      lines.push('');
    }

    const removedServers = diff.serverChanges.filter((c) => c.includes('**[Breaking]**'));
    if (removedServers.length > 0) {
      lines.push('**Servers**');
      lines.push('');
      removedServers.forEach((s) => lines.push(s));
      lines.push('');
    }
  }

  if (!hasAdded && !hasChanged && !hasRemoved) {
    lines.push('_No API changes detected._');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Output helpers ───────────────────────────────────────────────────────────

/**
 * Prepends the new changelog section right after the `# Changelog` header in
 * the existing changelog file, so the newest version always appears first.
 */
function prependToChangelog(outputPath, section) {
  const resolved = path.resolve(outputPath);
  let existing = '';

  if (fs.existsSync(resolved)) {
    existing = fs.readFileSync(resolved, 'utf8');
  }

  // Find the end of the header block (first blank line after the `# Changelog` heading)
  const headerMatch = existing.match(/^(#[^\n]*\n(?:[^\n]*\n)*?\n)/);
  if (headerMatch) {
    const header = headerMatch[1];
    const rest = existing.slice(header.length);
    fs.writeFileSync(resolved, `${header}${section}\n${rest}`);
  } else {
    // No header found — just prepend
    fs.writeFileSync(resolved, `${section}\n\n${existing}`);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    const helpText = fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//);
    if (helpText) {
      console.log(helpText[0].replace(/^\s*\*\s?/gm, '').replace(/^\/\*\*|\*\/$/g, '').trim());
    }
    process.exit(0);
  }

  const root = process.cwd();

  // ── Resolve current spec ─────────────────────────────────────────────────
  const currPath =
    args.curr || path.join(root, 'developer-portal/docs/openapi.json');

  let currSpec;
  try {
    currSpec = loadSpec(currPath);
  } catch (err) {
    console.error(`[generate-api-changelog] Error loading current spec: ${err.message}`);
    process.exit(1);
  }

  // ── Resolve previous spec ────────────────────────────────────────────────
  let prevSpec = null;

  if (args.prev) {
    try {
      prevSpec = loadSpec(args.prev);
    } catch (err) {
      console.error(`[generate-api-changelog] Error loading previous spec: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Try snapshot file first
    const snapshotPath = path.join(root, 'spec/openapi.previous.json');
    if (fs.existsSync(snapshotPath)) {
      try {
        prevSpec = loadSpec(snapshotPath);
        console.log(`[generate-api-changelog] Using snapshot: spec/openapi.previous.json`);
      } catch (_) {
        prevSpec = null;
      }
    }

    // Fallback: git history
    if (!prevSpec) {
      console.log(
        `[generate-api-changelog] No --prev specified and no snapshot found. ` +
          `Trying git history for ${currPath}...`
      );
      prevSpec = loadPrevSpecFromGit(currPath);
      if (prevSpec) {
        console.log(`[generate-api-changelog] Loaded previous spec from git HEAD~1`);
      }
    }

    if (!prevSpec) {
      console.warn(
        `[generate-api-changelog] Warning: Could not find a previous spec to diff against. ` +
          `Treating all endpoints as newly added.`
      );
      prevSpec = { openapi: '3.1.0', info: {}, paths: {}, components: {} };
    }
  }

  // ── Version & date ───────────────────────────────────────────────────────
  const version =
    args.version || (currSpec.info && currSpec.info.version) || '0.0.0';
  const date =
    args.date || new Date().toISOString().slice(0, 10);

  // ── Diff ─────────────────────────────────────────────────────────────────
  console.log(
    `[generate-api-changelog] Diffing API specs — generating changelog for v${version} (${date})`
  );

  const diff = diffSpecs(prevSpec, currSpec);

  const totalEndpointChanges =
    diff.endpointsAdded.length + diff.endpointsRemoved.length + diff.endpointsChanged.length;
  const totalSchemaChanges =
    diff.schemasAdded.length + diff.schemasRemoved.length + diff.schemasChanged.length;

  console.log(
    `[generate-api-changelog] Results: ` +
      `${diff.endpointsAdded.length} endpoint(s) added, ` +
      `${diff.endpointsRemoved.length} removed, ` +
      `${diff.endpointsChanged.length} changed | ` +
      `${totalSchemaChanges} schema change(s) | ` +
      `breaking=${diff.hasBreaking}`
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const section = renderChangelog(diff, version, date);

  // ── Output ───────────────────────────────────────────────────────────────
  if (args.stdout) {
    process.stdout.write(section + '\n');
  } else {
    const outputPath =
      args.output || path.join(root, 'developer-portal/docs/changelog.md');

    prependToChangelog(outputPath, section);
    console.log(
      `[generate-api-changelog] Changelog section prepended to ${path.relative(root, outputPath)}`
    );
  }

  // ── Save current spec as snapshot for next run ──────────────────────────
  if (!args.stdout && !args.prev) {
    const snapshotDir = path.join(root, 'spec');
    const snapshotPath = path.join(snapshotDir, 'openapi.previous.json');
    try {
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.copyFileSync(path.resolve(currPath), snapshotPath);
      console.log(`[generate-api-changelog] Snapshot saved to spec/openapi.previous.json`);
    } catch (err) {
      console.warn(
        `[generate-api-changelog] Could not save snapshot: ${err.message}`
      );
    }
  }

  // ── Breaking change gate ─────────────────────────────────────────────────
  if (args.breaking && diff.hasBreaking) {
    console.error(
      `\n[generate-api-changelog] ⚠️  Breaking changes detected in this spec diff.\n` +
        `  Review the generated changelog before merging.\n` +
        `  Re-run without --breaking to skip this gate.`
    );
    process.exit(1);
  }

  process.exit(0);
}

main();
