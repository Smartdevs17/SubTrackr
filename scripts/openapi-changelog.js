#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_SPEC = path.join('developer-portal', 'docs', 'openapi.json');

const BREAKING = 'breaking';
const ADDED = 'added';
const CHANGED = 'changed';
const DEPRECATED = 'deprecated';
const REMOVED = 'removed';

const SECTION_TITLES = {
  [BREAKING]: 'Breaking changes',
  [ADDED]: 'Added',
  [CHANGED]: 'Changed',
  [DEPRECATED]: 'Deprecated',
  [REMOVED]: 'Removed',
};

const SECTION_ORDER = [BREAKING, ADDED, CHANGED, DEPRECATED, REMOVED];

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function parseArgs(argv) {
  const args = { spec: DEFAULT_SPEC };
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--previous-ref=')) {
      args.previousRef = arg.slice('--previous-ref='.length);
    } else if (arg.startsWith('--previous-file=')) {
      args.previousFile = arg.slice('--previous-file='.length);
    } else if (arg === '--fail-on-breaking') {
      args.failOnBreaking = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args.spec = arg;
    }
  }
  return args;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function readSpecFromGit(ref, specPath) {
  return JSON.parse(
    execSync(`git show ${ref}:${specPath}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  );
}

function getLatestTag() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return tag || null;
  } catch (error) {
    return null;
  }
}

function getCurrentRevision() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    return 'working tree';
  }
}

function resolveBaseline(args) {
  if (args.previousFile) {
    if (!fs.existsSync(args.previousFile)) {
      return { label: path.basename(args.previousFile), spec: null };
    }
    return { label: path.basename(args.previousFile), spec: readJson(args.previousFile) };
  }
  const ref = args.previousRef || getLatestTag();
  if (!ref) {
    return { label: 'the latest reachable git tag', spec: null };
  }
  try {
    return { label: ref, spec: readSpecFromGit(ref, args.spec) };
  } catch (error) {
    return { label: ref, spec: null };
  }
}

function createChangeLog() {
  const items = [];
  return {
    add(category, text) {
      items.push({ category, text });
    },
    has(category) {
      return items.some((item) => item.category === category);
    },
    get(category) {
      return items.filter((item) => item.category === category);
    },
    total() {
      return items.length;
    },
  };
}

function collectOperations(spec) {
  const operations = [];
  for (const [url, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      operations.push({ url, method, operation, pathItem });
    }
  }
  return operations;
}

const operationKey = (operation) => `${operation.method}:${operation.url}`;

function endpointLabel(method, url) {
  return `${method.toUpperCase()} ${url}`;
}

function operationSummary(operation) {
  if (operation.summary) return ` (${operation.summary})`;
  if (operation.operationId) return ` (${operation.operationId})`;
  return '';
}

function getParameters(operation) {
  const params = [];
  const seen = new Set();
  for (const param of operation.pathItem.parameters || []) {
    const key = `${param.in}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    params.push(param);
  }
  for (const param of operation.operation.parameters || []) {
    const key = `${param.in}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    params.push(param);
  }
  return params;
}

function paramLabel(param) {
  const required = param.required ? ' (required)' : '';
  return `${param.in} parameter \`${param.name}\`${required}`;
}

function schemaSummary(schema) {
  if (!schema) return null;
  if (schema.$ref) return schema.$ref;
  if (schema.type) return schema.type;
  return null;
}

function bodyRef(requestBody) {
  if (requestBody.$ref) return requestBody.$ref;
  for (const mediaType of Object.values(requestBody.content || {})) {
    const summary = schemaSummary(mediaType.schema);
    if (summary) return summary;
  }
  return null;
}

function responseRef(response) {
  for (const mediaType of Object.values(response.content || {})) {
    const summary = schemaSummary(mediaType.schema);
    if (summary) return summary;
  }
  if (response.$ref) return response.$ref;
  return null;
}

function diffOperation(oldOp, newOp, changes) {
  const label = endpointLabel(newOp.method, newOp.url);

  const oldParams = new Map(
    getParameters(oldOp).map((param) => [`${param.in}:${param.name}`, param])
  );
  const newParams = new Map(
    getParameters(newOp).map((param) => [`${param.in}:${param.name}`, param])
  );

  for (const [key, param] of newParams) {
    const oldParam = oldParams.get(key);
    if (!oldParam) {
      const required = param.required ? 'required ' : 'optional ';
      const category = param.required ? BREAKING : ADDED;
      changes.add(category, `Added ${required}${paramLabel(param)} to ${label}`, label);
      continue;
    }
    if (!oldParam.required && param.required) {
      changes.add(BREAKING, `${paramLabel(param)} of ${label} is now required`, label);
      continue;
    }
    const oldType = schemaSummary(oldParam.schema);
    const newType = schemaSummary(param.schema);
    if (oldType && newType && oldType !== newType) {
      changes.add(
        BREAKING,
        `Type of ${paramLabel(param)} in ${label} changed from ${oldType} to ${newType}`,
        label
      );
    }
  }
  for (const [key, param] of oldParams) {
    if (!newParams.has(key)) {
      changes.add(BREAKING, `Removed ${paramLabel(param)} from ${label}`, label);
    }
  }

  const hadBody = Boolean(oldOp.operation.requestBody);
  const hasBody = Boolean(newOp.operation.requestBody);
  if (!hadBody && hasBody) {
    const required = newOp.operation.requestBody.required ? 'required ' : '';
    const category = newOp.operation.requestBody.required ? BREAKING : ADDED;
    changes.add(category, `Added ${required}request body to ${label}`, label);
  } else if (hadBody && !hasBody) {
    changes.add(BREAKING, `Removed request body from ${label}`, label);
  } else if (hadBody && hasBody) {
    const wasRequired = Boolean(oldOp.operation.requestBody.required);
    if (!wasRequired && newOp.operation.requestBody.required) {
      changes.add(BREAKING, `Request body of ${label} is now required`, label);
    }
    const oldRef = bodyRef(oldOp.operation.requestBody);
    const newRef = bodyRef(newOp.operation.requestBody);
    if (oldRef && newRef && oldRef !== newRef) {
      changes.add(
        BREAKING,
        `Request body schema of ${label} changed from ${oldRef} to ${newRef}`,
        label
      );
    }
  }

  const oldResponses = oldOp.operation.responses || {};
  const newResponses = newOp.operation.responses || {};
  for (const code of Object.keys(newResponses)) {
    if (!oldResponses[code]) {
      changes.add(ADDED, `Added response ${code} to ${label}`, label);
    }
  }
  for (const code of Object.keys(oldResponses)) {
    if (!newResponses[code]) {
      const breaking = code === 'default' || code.startsWith('2');
      const success = breaking ? 'success ' : '';
      changes.add(
        breaking ? BREAKING : CHANGED,
        `Removed ${success}response ${code} from ${label}`,
        label
      );
    }
  }
  for (const code of Object.keys(newResponses)) {
    if (!oldResponses[code]) continue;
    const oldRef = responseRef(oldResponses[code]);
    const newRef = responseRef(newResponses[code]);
    if (oldRef && newRef && oldRef !== newRef) {
      changes.add(
        BREAKING,
        `Response ${code} of ${label} changed from ${oldRef} to ${newRef}`,
        label
      );
    }
  }

  if (!oldOp.operation.deprecated && newOp.operation.deprecated) {
    changes.add(DEPRECATED, `Deprecated ${label}`, label);
  }

  const hadSecurity = Boolean(oldOp.operation.security && oldOp.operation.security.length);
  const hasSecurity = Boolean(newOp.operation.security && newOp.operation.security.length);
  if (!hadSecurity && hasSecurity) {
    changes.add(BREAKING, `Added security requirement to ${label}`, label);
  } else if (hadSecurity && !hasSecurity) {
    changes.add(CHANGED, `Removed security requirement from ${label}`, label);
  }

  if (
    oldOp.operation.summary &&
    newOp.operation.summary &&
    oldOp.operation.summary !== newOp.operation.summary
  ) {
    changes.add(CHANGED, `Updated summary of ${label} to "${newOp.operation.summary}"`, label);
  }
}

function diffOperations(oldSpec, newSpec, changes) {
  const oldOperations = new Map(
    collectOperations(oldSpec).map((operation) => [operationKey(operation), operation])
  );
  const newOperations = new Map(
    collectOperations(newSpec).map((operation) => [operationKey(operation), operation])
  );

  for (const operation of newOperations.values()) {
    if (!oldOperations.has(operationKey(operation))) {
      const text = `Added ${endpointLabel(operation.method, operation.url)}${operationSummary(operation.operation)}`;
      changes.add(ADDED, text, operation.url);
    }
  }
  for (const operation of oldOperations.values()) {
    if (!newOperations.has(operationKey(operation))) {
      changes.add(
        BREAKING,
        `Removed ${endpointLabel(operation.method, operation.url)}`,
        operation.url
      );
    }
  }
  for (const operation of oldOperations.values()) {
    const next = newOperations.get(operationKey(operation));
    if (next) diffOperation(operation, next, changes);
  }
}

function diffInfo(oldSpec, newSpec, changes) {
  const oldInfo = oldSpec.info || {};
  const newInfo = newSpec.info || {};
  if (oldInfo.title && newInfo.title && oldInfo.title !== newInfo.title) {
    changes.add(CHANGED, `API title changed from "${oldInfo.title}" to "${newInfo.title}"`, 'api');
  }
  if (oldInfo.version && newInfo.version && oldInfo.version !== newInfo.version) {
    changes.add(
      CHANGED,
      `API version changed from ${oldInfo.version} to ${newInfo.version}`,
      'api'
    );
  }
  if (oldSpec.openapi && newSpec.openapi && oldSpec.openapi !== newSpec.openapi) {
    changes.add(
      BREAKING,
      `OpenAPI version changed from ${oldSpec.openapi} to ${newSpec.openapi}`,
      'api'
    );
  }
}

function diffSchema(newSchema, oldSchema, schemaPath, changes, depth) {
  if (depth > 6) return;
  const newSummary = schemaSummary(newSchema);
  const oldSummary = schemaSummary(oldSchema);
  if (newSummary && oldSummary && newSummary !== oldSummary) {
    changes.add(
      BREAKING,
      `Type of ${schemaPath} changed from ${oldSummary} to ${newSummary}`,
      'schemas'
    );
  }
  const oldRequired = new Set(oldSchema.required || []);
  for (const property of newSchema.required || []) {
    if (!oldRequired.has(property)) {
      changes.add(BREAKING, `Added required property \`${property}\` to ${schemaPath}`, 'schemas');
    }
  }
  if (oldSchema.properties && newSchema.properties) {
    for (const [name, value] of Object.entries(newSchema.properties)) {
      if (oldSchema.properties[name]) {
        diffSchema(
          value,
          oldSchema.properties[name],
          `${schemaPath}.\`${name}\``,
          changes,
          depth + 1
        );
      }
    }
  }
}

function diffSchemas(oldSpec, newSpec, changes) {
  const oldSchemas = (oldSpec.components || {}).schemas || {};
  const newSchemas = (newSpec.components || {}).schemas || {};
  for (const name of Object.keys(newSchemas)) {
    if (!oldSchemas[name]) changes.add(ADDED, `Added schema \`${name}\``, 'schemas');
  }
  for (const name of Object.keys(oldSchemas)) {
    if (!newSchemas[name]) changes.add(BREAKING, `Removed schema \`${name}\``, 'schemas');
  }
  for (const name of Object.keys(newSchemas)) {
    if (oldSchemas[name])
      diffSchema(newSchemas[name], oldSchemas[name], `schema \`${name}\``, changes, 0);
  }
}

function diffSecurity(oldSpec, newSpec, changes) {
  const oldSchemes = (oldSpec.components || {}).securitySchemes || {};
  const newSchemes = (newSpec.components || {}).securitySchemes || {};
  for (const name of Object.keys(newSchemes)) {
    if (!oldSchemes[name]) changes.add(CHANGED, `Added security scheme \`${name}\``, 'security');
  }
  for (const name of Object.keys(oldSchemes)) {
    if (!newSchemes[name]) changes.add(BREAKING, `Removed security scheme \`${name}\``, 'security');
  }
  const hadGlobal = Boolean(oldSpec.security && oldSpec.security.length);
  const hasGlobal = Boolean(newSpec.security && newSpec.security.length);
  if (!hadGlobal && hasGlobal) {
    changes.add(BREAKING, 'Added a global security requirement to every operation', 'security');
  } else if (hadGlobal && !hasGlobal) {
    changes.add(CHANGED, 'Removed the global security requirement', 'security');
  }
}

function buildMarkdown(changes, baselineLabel, currentRevision) {
  const lines = ['# API Changelog', ''];
  if (changes.total() === 0) {
    lines.push(
      `No API changes detected when comparing \`${baselineLabel}\` against \`${currentRevision}\`.`
    );
    return lines.join('\n');
  }
  lines.push(
    `API changes detected when comparing baseline \`${baselineLabel}\` against \`${currentRevision}\`.`
  );
  lines.push('');
  for (const category of SECTION_ORDER) {
    const items = changes.get(category);
    lines.push(`## ${SECTION_TITLES[category]}`, '');
    if (category === BREAKING && items.length === 0) {
      lines.push('No breaking changes detected.', '');
    } else {
      for (const item of items) {
        lines.push(`- ${item.text}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function writeOutput(outputPath, markdown) {
  if (!outputPath) {
    process.stdout.write(markdown);
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let currentSpec;
  try {
    currentSpec = readJson(args.spec);
  } catch (error) {
    console.error(`Unable to read OpenAPI spec ${args.spec}: ${error.message}`);
    return 1;
  }

  const baseline = resolveBaseline(args);
  const currentRevision = getCurrentRevision();

  if (!baseline.spec) {
    const markdown =
      '# API Changelog\n\n' +
      `No previous OpenAPI specification found at \`${baseline.label}\`. Skipped changelog generation.\n`;
    writeOutput(args.output, markdown);
    console.log('No previous OpenAPI specification baseline found; skipped changelog generation.');
    return 0;
  }

  const changes = createChangeLog();
  diffInfo(baseline.spec, currentSpec, changes);
  diffOperations(baseline.spec, currentSpec, changes);
  diffSchemas(baseline.spec, currentSpec, changes);
  diffSecurity(baseline.spec, currentSpec, changes);

  const markdown = buildMarkdown(changes, baseline.label, currentRevision);
  writeOutput(args.output, markdown);

  const breaking = changes.get(BREAKING);
  if (args.failOnBreaking && breaking.length > 0) {
    console.error(`Detected ${breaking.length} breaking API change(s).`);
    return 2;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
