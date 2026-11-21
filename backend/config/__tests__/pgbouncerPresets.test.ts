import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const renderer = require('../../../infra/pgbouncer/render.js') as {
  DEFAULT_CONFIG_PATH: string;
  TEMPLATE_PATH: string;
  loadCatalog: () => {
    defaultPreset: string;
    poolMode: string;
    presets: Record<
      string,
      {
        label: string;
        workerConcurrency: number;
        workerPoolMax: number;
        defaultPoolSize: number;
        minPoolSize: number;
        reservePoolSize: number;
        reservePoolTimeout: number;
        maxClientConn: number;
        maxPreparedStatements: number;
      }
    >;
  };
  resolvePreset: (
    options?: { preset?: string; replicaPoolSize?: string | number },
    context?: {
      warn?: (message: string) => void;
      env?: NodeJS.ProcessEnv;
    },
  ) => {
    name: string;
    fallbackUsed: boolean;
    defaultPoolSize: number;
    serverConnectionBudget: number;
  };
  renderConfig: (
    options?: { preset?: string; dbHost?: string; templatePath?: string },
    context?: {
      env?: NodeJS.ProcessEnv;
      warnings?: string[];
    },
  ) => { rendered: string; sizing: { name: string } };
  main: (argv: string[]) => number;
};

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'infra/pgbouncer/render.js');

describe('PgBouncer worker sizing presets (issue #2076)', () => {
  const catalog = renderer.loadCatalog();

  it('keeps every preset internally consistent', () => {
    expect(catalog.defaultPreset).toBe('standard');
    expect(catalog.poolMode).toBe('transaction');

    for (const [name, preset] of Object.entries(catalog.presets)) {
      expect(preset.label).toBeTruthy();
      expect(preset.defaultPoolSize).toBeGreaterThanOrEqual(preset.workerConcurrency);
      expect(preset.workerPoolMax).toBeGreaterThanOrEqual(preset.workerConcurrency);
      expect(preset.minPoolSize).toBeGreaterThan(0);
      expect(preset.minPoolSize).toBeLessThan(preset.defaultPoolSize);
      expect(preset.reservePoolSize).toBeGreaterThan(0);
      expect(preset.reservePoolSize).toBeLessThan(preset.defaultPoolSize);
      expect(preset.maxClientConn).toBeGreaterThanOrEqual(preset.defaultPoolSize * 4);
      expect(preset.maxPreparedStatements).toBeGreaterThan(0);
      expect(`${name}:${preset.defaultPoolSize + preset.reservePoolSize}`).toMatch(/^\w+:\d+$/);
    }
  });

  it('falls back to the default preset for an unknown name', () => {
    const warnings: string[] = [];
    const sizing = renderer.resolvePreset(
      { preset: 'unknown-tier' },
      { env: {}, warn: (message) => warnings.push(message) },
    );

    expect(sizing.name).toBe('standard');
    expect(sizing.fallbackUsed).toBe(true);
    expect(warnings).toEqual([expect.stringContaining('Unknown PgBouncer preset "unknown-tier"')]);
  });

  it('uses the preset default when DB_REPLICA_POOL_SIZE is invalid', () => {
    const warnings: string[] = [];
    const sizing = renderer.resolvePreset(
      { preset: 'large', replicaPoolSize: '-5' },
      { env: {}, warn: (message) => warnings.push(message) },
    );

    expect(sizing.defaultPoolSize).toBe(catalog.presets.large.defaultPoolSize);
    expect(sizing.serverConnectionBudget).toBe(
      catalog.presets.large.defaultPoolSize + catalog.presets.large.reservePoolSize,
    );
    expect(warnings).toEqual([expect.stringContaining('Invalid DB_REPLICA_POOL_SIZE: -5')]);
  });

  it('honours a positive pool-size override without changing the preset', () => {
    const sizing = renderer.resolvePreset(
      { preset: 'small', replicaPoolSize: '18' },
      { env: {} },
    );

    expect(sizing.name).toBe('small');
    expect(sizing.defaultPoolSize).toBe(18);
    expect(sizing.serverConnectionBudget).toBe(18 + catalog.presets.small.reservePoolSize);
  });

  it.each(Object.keys(catalog.presets))('renders a transaction-safe ini for %s', (preset) => {
    const { rendered, sizing } = renderer.renderConfig(
      { preset, dbHost: 'postgres.internal' },
      { env: {} },
    );
    const expected = catalog.presets[preset];

    expect(sizing.name).toBe(preset);
    expect(rendered).toContain('pool_mode = transaction');
    expect(rendered).toContain('server_reset_query = DISCARD ALL');
    expect(rendered).toContain('server_reset_query_always = 1');
    expect(rendered).toContain(`host=postgres.internal`);
    expect(rendered).toContain(`default_pool_size = ${expected.defaultPoolSize}`);
    expect(rendered).toContain(`min_pool_size = ${expected.minPoolSize}`);
    expect(rendered).toContain(`reserve_pool_size = ${expected.reservePoolSize}`);
    expect(rendered).toContain(`max_client_conn = ${expected.maxClientConn}`);
    expect(rendered).toContain(`max_prepared_statements = ${expected.maxPreparedStatements}`);
    expect(rendered).not.toMatch(/__[A-Z_]+__/);
  });

  it('keeps the committed ini identical to the standard preset rendering', () => {
    const { rendered } = renderer.renderConfig({ preset: 'standard' }, { env: {} });
    const committed = fs.readFileSync(renderer.DEFAULT_CONFIG_PATH, 'utf8');

    expect(committed).toBe(rendered);
    expect(committed).toContain('host=__PGBOUNCER_DB_HOST__');
  });

  it('rolls back to the committed config by re-rendering the default preset', () => {
    const committed = fs.readFileSync(renderer.DEFAULT_CONFIG_PATH, 'utf8');
    const { rendered: bursty } = renderer.renderConfig({ preset: 'batch' }, { env: {} });
    expect(bursty).not.toBe(committed);

    const { rendered: rolledBack } = renderer.renderConfig(
      { preset: catalog.defaultPreset },
      { env: {} },
    );
    expect(rolledBack).toBe(committed);
  });

  it('supports --check for the committed config and detects drift', () => {
    expect(renderer.main(['--check'])).toBe(0);

    const stale = path.join(os.tmpdir(), `subtrackr-pgbouncer-stale-${process.pid}.ini`);
    fs.writeFileSync(stale, '# stale\n');
    try {
      expect(renderer.main(['--check', '--output', stale])).toBe(1);
    } finally {
      fs.unlinkSync(stale);
    }
  });

  it('writes a rendered config through the CLI and can check that output', () => {
    const output = path.join(os.tmpdir(), `subtrackr-pgbouncer-${process.pid}.ini`);
    try {
      expect(
        renderer.main([
          '--preset',
          'small',
          '--db-host',
          'replica.internal',
          '--output',
          output,
        ]),
      ).toBe(0);
      expect(fs.readFileSync(output, 'utf8')).toContain('default_pool_size = 10');
      expect(renderer.main(['--preset', 'small', '--db-host', 'replica.internal', '--check', '--output', output])).toBe(0);
    } finally {
      if (fs.existsSync(output)) fs.unlinkSync(output);
    }
  });

  it('logs a fallback warning for an unknown preset in the CLI', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--preset', 'nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Preset: standard (Default backend workers)');
    expect(result.stderr).toContain('Unknown PgBouncer preset "nope"');
  });
});
