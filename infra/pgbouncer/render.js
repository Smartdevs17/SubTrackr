#!/usr/bin/env node
/**
 * Render the SubTrackr PgBouncer ini template from a checked-in sizing preset.
 *
 * The presets in presets.json are the single source of truth shared by the
 * backend database config and the deployment configuration. This script keeps
 * the generated ini reproducible so a worker tier can be rolled out (or rolled
 * back to "standard") without hand-editing pool numbers.
 *
 * Usage:
 *   node infra/pgbouncer/render.js --preset standard
 *   node infra/pgbouncer/render.js --preset batch --db-host postgres.internal --output /etc/pgbouncer/pgbouncer.ini
 *   node infra/pgbouncer/render.js --check
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PRESETS_PATH = path.join(__dirname, 'presets.json');
const TEMPLATE_PATH = path.join(__dirname, 'pgbouncer.ini.tmpl');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'pgbouncer.ini');

function loadCatalog(filePath = PRESETS_PATH) {
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!catalog || typeof catalog !== 'object' || !catalog.presets) {
    throw new Error('Invalid PgBouncer preset catalog');
  }
  return catalog;
}

function positiveInt(value, fallback, label, warn = () => undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warn(`Invalid ${label}: ${String(value)}; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Resolve a preset name into a fully populated sizing object.
 * Unknown presets fall back to the catalog default so a bad deploy env var
 * cannot leave PgBouncer without a usable configuration.
 */
function resolvePreset(
  options = {},
  { warn = () => undefined, catalog = loadCatalog(), env = process.env } = {}
) {
  const fallbackName = catalog.defaultPreset;
  const requestedName = String(options.preset ?? env.PGBOUNCER_PRESET ?? fallbackName)
    .trim()
    .toLowerCase();
  const preset = catalog.presets[requestedName];

  if (!preset) {
    warn(`Unknown PgBouncer preset "${requestedName}"; falling back to "${fallbackName}"`);
  }

  const name = preset ? requestedName : fallbackName;
  const sizing = preset ?? catalog.presets[fallbackName];
  const envOverride = env.DB_REPLICA_POOL_SIZE;
  const defaultPoolSize = positiveInt(
    options.replicaPoolSize ?? envOverride,
    sizing.defaultPoolSize,
    'DB_REPLICA_POOL_SIZE',
    warn
  );

  return {
    name,
    requestedName,
    fallbackUsed: !preset,
    label: sizing.label,
    workerConcurrency: sizing.workerConcurrency,
    workerPoolMax: sizing.workerPoolMax,
    defaultPoolSize,
    poolSizeOverridden: defaultPoolSize !== sizing.defaultPoolSize,
    minPoolSize: sizing.minPoolSize,
    reservePoolSize: sizing.reservePoolSize,
    reservePoolTimeout: sizing.reservePoolTimeout,
    maxClientConn: sizing.maxClientConn,
    maxPreparedStatements: sizing.maxPreparedStatements,
    serverConnectionBudget: defaultPoolSize + sizing.reservePoolSize,
    poolMode: catalog.poolMode,
  };
}

/** Replace every template placeholder with values from the resolved preset. */
function renderConfig(options = {}, context = {}) {
  const catalog = context.catalog ?? loadCatalog();
  const warnings = context.warnings ?? [];
  const warn = context.warn ?? ((message) => warnings.push(message));
  const sizing = resolvePreset(options, { warn, catalog, env: context.env ?? process.env });
  const template = fs.readFileSync(options.templatePath ?? TEMPLATE_PATH, 'utf8');
  const host = String(
    options.dbHost ?? (context.env ?? process.env).PGBOUNCER_DB_HOST ?? '__PGBOUNCER_DB_HOST__'
  );

  const replacements = {
    __PGBOUNCER_PRESET__: sizing.name,
    __PGBOUNCER_PRESET_LABEL__: sizing.label,
    __WORKER_CONCURRENCY__: String(sizing.workerConcurrency),
    __WORKER_POOL_MAX__: String(sizing.workerPoolMax),
    __DEFAULT_POOL_SIZE__: String(sizing.defaultPoolSize),
    __MIN_POOL_SIZE__: String(sizing.minPoolSize),
    __RESERVE_POOL_SIZE__: String(sizing.reservePoolSize),
    __RESERVE_POOL_TIMEOUT__: String(sizing.reservePoolTimeout),
    __MAX_CLIENT_CONN__: String(sizing.maxClientConn),
    __MAX_PREPARED_STATEMENTS__: String(sizing.maxPreparedStatements),
    __PGBOUNCER_DB_HOST__: host,
  };

  const rendered = Object.entries(replacements).reduce(
    (text, [placeholder, value]) => text.split(placeholder).join(value),
    template
  );

  // The host is intentionally left as a placeholder in the committed template;
  // deployments substitute it at container start.
  const allowed = host === '__PGBOUNCER_DB_HOST__' ? new Set(['__PGBOUNCER_DB_HOST__']) : new Set();
  const unresolved = rendered.match(/__[A-Z_]+__/g);
  const unexpected = unresolved
    ? [...new Set(unresolved)].filter((placeholder) => !allowed.has(placeholder))
    : [];
  if (unexpected.length > 0) {
    throw new Error(`Unresolved PgBouncer template placeholders: ${unexpected.join(', ')}`);
  }

  return { rendered, sizing, warnings };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (['--preset', '--db-host', '--output', '--replica-pool-size'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      [
        'Usage: node infra/pgbouncer/render.js [options]',
        '  --preset <name>            small | standard | large | batch (default: standard)',
        '  --db-host <host>           Postgres host (default: PGBOUNCER_DB_HOST or template placeholder)',
        '  --replica-pool-size <n>    Override default_pool_size (same as DB_REPLICA_POOL_SIZE)',
        '  --output <file>            Write the rendered ini instead of stdout',
        '  --check                    Fail if the target file differs from the rendered config',
        '  --help                     Show this help',
        '',
      ].join('\n')
    );
    return 0;
  }

  const { rendered, sizing, warnings } = renderConfig(options);
  warnings.forEach((message) => process.stderr.write(`warning: ${message}\n`));

  if (options.check) {
    const target = options.output ?? DEFAULT_CONFIG_PATH;
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== rendered) {
      process.stderr.write(
        `PgBouncer config is stale for preset "${sizing.name}" (${target}). ` +
          'Regenerate it with node infra/pgbouncer/render.js.\n'
      );
      return 1;
    }
    process.stdout.write(`PgBouncer config is current for preset "${sizing.name}".\n`);
    return 0;
  }

  if (options.output) {
    fs.writeFileSync(options.output, rendered);
    process.stderr.write(`Wrote ${options.output} using preset "${sizing.name}".\n`);
  } else {
    process.stdout.write(rendered);
  }
  return 0;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  TEMPLATE_PATH,
  loadCatalog,
  resolvePreset,
  renderConfig,
  parseArgs,
  main,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
