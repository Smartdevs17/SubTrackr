#!/usr/bin/env node
/**
 * Issue #1289: validate the Kubernetes autoscaling manifests.
 *
 * `kubectl apply -s` will happily accept an HPA that can never scale, so this
 * checks the invariants that only fail at runtime:
 *
 *  - the HPA targets a Deployment that exists in the same manifest set
 *  - minReplicas / maxReplicas are usable integers
 *  - every Resource metric has a matching container resources.requests entry,
 *    because a Resource metric with no request always reports 0% and the HPA
 *    silently pins at minReplicas
 *  - utilisation targets are percentages
 *  - scale-up and scale-down behaviour is defined
 *  - the Service targets a port the container actually declares
 *  - a PodDisruptionBudget protects the replicas
 *
 * Zero dependencies on purpose: this runs in CI before any install step, so a
 * missing node_modules can never hide a broken manifest.
 *
 * Usage:
 *   node scripts/validate-autoscaling.js [--dir <path>] [--json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join('infra', 'kubernetes');
const MANIFEST_FILES = ['api-deployment.yaml', 'api-autoscaling.yaml'];

/* -------------------------------------------------------------------------- */
/* Minimal YAML subset parser                                                 */
/* -------------------------------------------------------------------------- */

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitDocuments(text) {
  return text.split(/^\s*---\s*$/m);
}

function tokenize(text) {
  const tokens = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    tokens.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return tokens;
}

function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ':' && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      return { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
    }
  }
  return { key: text.replace(/:$/, '').trim(), value: '' };
}

function splitFlow(body) {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return null;
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/s.test(value)) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlow(value.slice(1, -1)).map(parseScalar);
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const map = {};
    for (const entry of splitFlow(value.slice(1, -1))) {
      const { key, value: item } = splitKey(entry);
      if (key) map[key] = parseScalar(item);
    }
    return map;
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function isSequenceItem(token) {
  const text = typeof token === 'string' ? token : token.text;
  return text === '-' || text.startsWith('- ');
}

function parseSequence(tokens, index, indent) {
  const items = [];
  let i = index;
  while (i < tokens.length && tokens[i].indent === indent && isSequenceItem(tokens[i])) {
    const rest = tokens[i].text.replace(/^-\s*/, '');
    // A bare scalar item (`- ALL`) has no colon, so it cannot start a block.
    if (rest && !/:\s/.test(rest) && !/:$/.test(rest)) {
      items.push(parseScalar(rest));
      i += 1;
      continue;
    }
    const childIndent = indent + 2;
    const sub = rest ? [{ indent: childIndent, text: rest }] : [];
    i += 1;
    while (i < tokens.length && tokens[i].indent > indent) {
      sub.push(tokens[i]);
      i += 1;
    }
    items.push(sub.length === 0 ? null : parseTokens(sub, 0, childIndent)[0]);
  }
  return [items, i];
}

function parseMapping(tokens, index, indent) {
  const map = {};
  let i = index;
  while (i < tokens.length && tokens[i].indent === indent && !isSequenceItem(tokens[i])) {
    const { key, value } = splitKey(tokens[i].text);
    i += 1;
    if (value !== '') {
      map[key] = parseScalar(value);
      continue;
    }
    if (i < tokens.length && tokens[i].indent > indent) {
      const [child, next] = parseTokens(tokens, i, tokens[i].indent);
      map[key] = child;
      i = next;
    } else if (i < tokens.length && tokens[i].indent === indent && isSequenceItem(tokens[i])) {
      const [child, next] = parseSequence(tokens, i, indent);
      map[key] = child;
      i = next;
    } else {
      map[key] = null;
    }
  }
  return [map, i];
}

function parseTokens(tokens, index, indent) {
  if (index >= tokens.length || tokens[index].indent < indent) return [null, index];
  if (isSequenceItem(tokens[index])) return parseSequence(tokens, index, indent);
  return parseMapping(tokens, index, indent);
}

function parseYaml(text) {
  return splitDocuments(text)
    .map((chunk) => tokenize(chunk))
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => parseTokens(tokens, 0, tokens[0].indent)[0])
    .filter((doc) => doc && typeof doc === 'object');
}

/* -------------------------------------------------------------------------- */
/* Validation rules                                                            */
/* -------------------------------------------------------------------------- */

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' ? value : {});
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

const podLabels = (deployment) =>
  asObject(asObject(asObject(asObject(deployment.spec).template).metadata).labels);

const podSpec = (deployment) => asObject(asObject(asObject(deployment.spec).template).spec);

const containersOf = (deployment) => asArray(podSpec(deployment).containers);

const containerOf = (deployment) => containersOf(deployment)[0] || {};

function findResource(documents, kind, name) {
  return documents.find((doc) => doc.kind === kind && asObject(doc.metadata).name === name);
}

function validateHpaSizing(hpa, errors) {
  const spec = asObject(hpa.spec);
  if (!isPositiveInt(spec.minReplicas)) {
    errors.push('spec.minReplicas must be a positive integer (no floor during a scale-down).');
  }
  if (!isPositiveInt(spec.maxReplicas)) {
    errors.push('spec.maxReplicas must be a positive integer.');
  } else if (isPositiveInt(spec.minReplicas) && spec.maxReplicas <= spec.minReplicas) {
    errors.push(
      `spec.maxReplicas (${spec.maxReplicas}) must be greater than minReplicas (${spec.minReplicas}); ` +
        'the HPA would be pinned and never scale.'
    );
  } else if (spec.maxReplicas < 3) {
    errors.push('spec.maxReplicas below 3 leaves no headroom for a burst beyond steady state.');
  }
}

function validateHpaMetrics(hpa, deployment, errors) {
  const metrics = asArray(asObject(hpa.spec).metrics);
  const container = containerOf(deployment);
  const requests = asObject(asObject(container.resources).requests);

  if (metrics.length === 0) {
    errors.push('spec.metrics is empty; the HPA has nothing to scale on.');
    return;
  }

  let resourceMetrics = 0;
  for (const metric of metrics) {
    const entry = asObject(metric);
    if (entry.type === 'Resource') {
      resourceMetrics += 1;
      const resource = asObject(entry.resource);
      const name = resource.name;
      const target = asObject(resource.target);
      if (target.type !== 'Utilization') {
        errors.push(`Resource metric "${name}" must target Utilization to be request-relative.`);
        continue;
      }
      const utilization = target.averageUtilization;
      if (!isPositiveInt(utilization) || utilization > 100) {
        errors.push(`Resource metric "${name}" averageUtilization must be a percentage in 1-100.`);
      }
      if (requests[name] === undefined || requests[name] === null) {
        errors.push(
          `Resource metric "${name}" has no matching container resources.requests.${name}; ` +
            'utilization cannot be computed and the HPA will stay pinned at minReplicas.'
        );
      }
    } else if (entry.type === 'Pods') {
      const target = asObject(entry.pods.target);
      if (!isPositiveInt(target.averageValue ?? target.value)) {
        errors.push('Pods metric must declare averageValue or value as a positive integer.');
      }
    } else if (entry.type !== 'External' && entry.type !== 'ContainerResource') {
      errors.push(`Unsupported metric type "${entry.type}".`);
    }
  }

  if (resourceMetrics === 0) {
    errors.push(
      'At least one Resource metric is required; custom metrics need a metrics server.'
    );
  }
}

function validateBehavior(hpa, errors, warnings) {
  const behavior = asObject(asObject(hpa.spec).behavior);
  for (const direction of ['scaleUp', 'scaleDown']) {
    const block = asObject(behavior[direction]);
    if (Object.keys(block).length === 0) {
      errors.push(`spec.behavior.${direction} is required; defaults flap on spiky traffic.`);
      continue;
    }
    if (asArray(block.policies).length === 0) {
      errors.push(`spec.behavior.${direction}.policies must not be empty.`);
    }
    if (
      block.stabilizationWindowSeconds !== undefined &&
      !isPositiveInt(block.stabilizationWindowSeconds)
    ) {
      errors.push(`spec.behavior.${direction}.stabilizationWindowSeconds must be positive.`);
    }
  }
  const scaleDownWindow = asObject(behavior.scaleDown).stabilizationWindowSeconds;
  if (isPositiveInt(scaleDownWindow) && scaleDownWindow < 60) {
    warnings.push(
      'scaleDown.stabilizationWindowSeconds under 60s will flap; a removed pod costs a cold start.'
    );
  }
}

function validateDeployment(deployment, service, pdb, hpa, errors, warnings) {
  const spec = asObject(deployment.spec);
  const selector = asObject(spec.selector).matchLabels;
  const labels = podLabels(deployment);
  const containers = containersOf(deployment);

  if (containers.length === 0) errors.push('Deployment has no containers.');
  if (!selector || Object.keys(selector).length === 0) {
    errors.push('spec.selector.matchLabels is required.');
  } else {
    for (const [key, value] of Object.entries(selector)) {
      if (labels[key] !== value) {
        errors.push(`Pod label ${key}=${labels[key]} does not satisfy selector ${key}=${value}.`);
      }
    }
  }

  const container = containerOf(deployment);
  const ports = asArray(container.ports);
  if (ports.length === 0) {
    errors.push('Container declares no ports, so the Service has nothing to target.');
  }

  const probes = ['startupProbe', 'readinessProbe', 'livenessProbe'];
  for (const probe of probes) {
    if (probe === 'startupProbe') continue;
    const block = asObject(container[probe]);
    if (!block.httpGet) {
      errors.push(`container.${probe} must use httpGet against the API health endpoint.`);
      continue;
    }
    const target = block.httpGet.port;
    if (!ports.some((port) => port.containerPort === target || port.name === target)) {
      errors.push(`container.${probe} targets port ${target}, not a declared containerPort.`);
    }
  }

  const servicePorts = asArray(asObject(service.spec).ports);
  if (servicePorts.length === 0) {
    errors.push('Service declares no ports.');
  }
  for (const port of servicePorts) {
    const target = port.targetPort;
    if (!ports.some((entry) => entry.containerPort === target || entry.name === target)) {
      errors.push(`Service targetPort ${target} does not match any declared containerPort.`);
    }
  }

  if (service) {
    const serviceSelector = asObject(service.spec).selector;
    for (const [key, value] of Object.entries(selector || {})) {
      if (serviceSelector[key] !== value) {
        errors.push(`Service selector ${key}=${serviceSelector[key]} != pod label ${value}.`);
      }
    }
  }

  const replicas = spec.replicas;
  const minReplicas = asObject(hpa.spec).minReplicas;
  if (isPositiveInt(replicas) && isPositiveInt(minReplicas) && replicas > minReplicas) {
    warnings.push(
      `Deployment replicas (${replicas}) exceeds HPA minReplicas (${minReplicas}); ` +
        'kubectl apply will reset it.'
    );
  }

  // Scale-down safety: a pod removed by the HPA must first leave the Service.
  const gracePeriod = asObject(asObject(spec.template).spec).terminationGracePeriodSeconds;
  if (!isPositiveInt(gracePeriod)) {
    warnings.push(
      'No terminationGracePeriodSeconds: scaled-down pods are killed mid-request.'
    );
  }
  if (Object.keys(asObject(asObject(container.lifecycle).preStop)).length === 0) {
    warnings.push(
      'No preStop hook: readiness is not withdrawn before SIGTERM, so a dying pod still gets traffic.'
    );
  }

  validatePdb(pdb, selector, errors);
}

function validatePdb(pdb, selector, errors) {
  if (!pdb) {
    errors.push('No PodDisruptionBudget found; a node drain can evict every API pod.');
    return;
  }
  if (pdb.apiVersion !== 'policy/v1') {
    errors.push(`PodDisruptionBudget must use policy/v1, found ${pdb.apiVersion || 'none'}.`);
  }
  const spec = asObject(pdb.spec);
  const hasMax = spec.maxUnavailable !== undefined && spec.maxUnavailable !== null;
  const hasMin = spec.minAvailable !== undefined && spec.minAvailable !== null;
  if (hasMax === hasMin) {
    errors.push('PodDisruptionBudget must set exactly one of maxUnavailable or minAvailable.');
  }
  const pdbSelector = asObject(asObject(spec.selector).matchLabels);
  if (Object.keys(pdbSelector).length === 0) {
    errors.push('PodDisruptionBudget spec.selector.matchLabels is required.');
    return;
  }
  for (const [key, value] of Object.entries(pdbSelector)) {
    if (!selector || selector[key] !== value) {
      errors.push(`PodDisruptionBudget selects ${key}=${value}, which the pods do not carry.`);
    }
  }
}

function validateAutoscaling(documents) {
  const errors = [];
  const warnings = [];
  const hpas = documents.filter((doc) => doc.kind === 'HorizontalPodAutoscaler');
  const deployments = documents.filter((doc) => doc.kind === 'Deployment');
  const services = documents.filter((doc) => doc.kind === 'Service');
  const pdbs = documents.filter((doc) => doc.kind === 'PodDisruptionBudget');

  if (hpas.length === 0) {
    errors.push('No HorizontalPodAutoscaler found in the manifest set.');
    return { errors, warnings, hpa: null, deployment: null };
  }

  let primaryHpa = null;
  let primaryDeployment = null;
  let primaryService = null;
  let primaryPdb = null;

  for (const hpa of hpas) {
    const hpaName = asObject(hpa.metadata).name;
    if (hpa.apiVersion !== 'autoscaling/v2') {
      errors.push(`HorizontalPodAutoscaler ${hpaName} must be autoscaling/v2, not ${hpa.apiVersion}.`);
      continue;
    }
    const ref = asObject(hpa.spec.scaleTargetRef);
    if (ref.kind !== 'Deployment' || !String(ref.apiVersion || '').startsWith('apps/')) {
      errors.push(`scaleTargetRef must be an apps/v1 Deployment, not ${ref.apiVersion}/${ref.kind}.`);
      continue;
    }
    const deployment = findResource(deployments, 'Deployment', ref.name);
    if (!deployment) {
      errors.push(`scaleTargetRef names Deployment "${ref.name}", not in the manifest set.`);
      continue;
    }
    const hpaNamespace = asObject(hpa.metadata).namespace;
    const deploymentNamespace = asObject(deployment.metadata).namespace;
    if (hpaNamespace && deploymentNamespace && hpaNamespace !== deploymentNamespace) {
      errors.push(
        `HPA namespace ${hpaNamespace} does not match Deployment namespace ${deploymentNamespace}.`
      );
    }
    if (!hpaName) {
      errors.push('HorizontalPodAutoscaler metadata.name is required.');
    }

    const service = findResource(services, 'Service', asObject(deployment.metadata).name);
    if (!service) {
      errors.push(`No Service found for Deployment ${ref.name}; replicas would get no traffic.`);
    }
    const pdb = findResource(pdbs, 'PodDisruptionBudget', hpaName);

    validateHpaSizing(hpa, errors);
    validateHpaMetrics(hpa, deployment, errors);
    validateBehavior(hpa, errors, warnings);
    validateDeployment(deployment, service, pdb, hpa, errors, warnings);

    if (primaryHpa === null) {
      primaryHpa = hpa;
      primaryDeployment = deployment;
      primaryService = service;
      primaryPdb = pdb;
    }
  }

  return {
    errors,
    warnings,
    hpa: primaryHpa,
    deployment: primaryDeployment,
    service: primaryService,
    pdb: primaryPdb,
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

const USAGE = `
Usage: node scripts/validate-autoscaling.js [options]

Validates the API horizontal autoscaling manifests (issue #1289).

Options:
  --dir <path>   Directory to read manifests from (default: ${DEFAULT_DIR})
  --json         Emit machine-readable JSON
  -h, --help     Show this help

Exit codes: 0 valid, 1 validation errors found, 2 usage or I/O error
`.trim();

function parseArgs(argv) {
  const options = { dir: DEFAULT_DIR, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--dir') {
      i += 1;
      if (i >= argv.length) throw new Error('--dir requires a path');
      options.dir = argv[i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function loadDocuments(dir) {
  return MANIFEST_FILES.map((file) => {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new Error(`Missing manifest: ${full}`);
    return { file, documents: parseYaml(fs.readFileSync(full, 'utf8')) };
  }).flatMap((entry) => entry.documents);
}

function run(argv = []) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[autoscaling] ${error.message}`);
    console.error(USAGE);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  let documents;
  try {
    documents = loadDocuments(options.dir);
  } catch (error) {
    console.error(`[autoscaling] ${error.message}`);
    return 2;
  }

  const { errors, warnings, hpa, deployment } = validateAutoscaling(documents);
  const report = {
    manifestDir: options.dir,
    documents: documents.length,
    hpa: hpa ? asObject(hpa.metadata).name : null,
    deployment: deployment ? asObject(deployment.metadata).name : null,
    minReplicas: hpa ? asObject(hpa.spec).minReplicas : null,
    maxReplicas: hpa ? asObject(hpa.spec).maxReplicas : null,
    errors,
    warnings,
    valid: errors.length === 0,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return errors.length === 0 ? 0 : 1;
  }

  console.log('\n[autoscaling] Validating API horizontal autoscaling\n');
  console.log(`  Manifests : ${options.dir} (${documents.length} document(s))`);
  console.log(`  HPA       : ${report.hpa || 'none'}`);
  console.log(`  Target    : ${report.deployment || 'none'}`);
  if (hpa) {
    console.log(`  Replicas  : ${report.minReplicas} - ${report.maxReplicas}`);
  }
  for (const warning of warnings) console.log(`  ⚠  ${warning}`);
  for (const error of errors) console.log(`  ✗  ${error}`);
  if (errors.length === 0) {
    console.log('\n✓  Autoscaling manifests are valid.\n');
    return 0;
  }
  console.error(`\n✗  ${errors.length} validation error(s).\n`);
  return 1;
}

module.exports = {
  DEFAULT_DIR,
  MANIFEST_FILES,
  USAGE,
  loadDocuments,
  parseArgs,
  parseScalar,
  parseYaml,
  run,
  validateAutoscaling,
};

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
