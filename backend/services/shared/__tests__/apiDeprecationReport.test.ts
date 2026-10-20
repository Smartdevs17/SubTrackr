/**
 * Unit tests for apiDeprecationReport.ts
 *
 * Covers:
 *  - severity classification at each threshold
 *  - days-until-sunset arithmetic, including a passed date
 *  - traffic share and the rows that still need attention
 *  - findings ordering and the health assertion
 *  - table and JSON rendering
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildDeprecationReport,
  severityFor,
  isHealthy,
  formatFindings,
  formatReportTable,
  toJson,
  SUNSET_WARNING_DAYS,
  SUNSET_CRITICAL_DAYS,
} from '../apiDeprecationReport';
import { ApiVersionRegistry, type VersionConfig } from '../apiVersioning';

const NOW = new Date('2026-03-15T00:00:00.000Z');
const DAY = 86_400_000;

/** An ISO date `days` after NOW. */
const inDays = (days: number): string => new Date(NOW.getTime() + days * DAY).toISOString();

const registryWith = (configs: VersionConfig[]): ApiVersionRegistry => {
  const registry = new ApiVersionRegistry();
  for (const config of configs) registry.register(config);
  return registry;
};

const active = (version: string): VersionConfig => ({
  version,
  lifecycle: 'active',
  releasedAt: '2025-01-01T00:00:00Z',
});

const deprecated = (overrides: Partial<VersionConfig> = {}): VersionConfig => ({
  version: 'v1',
  lifecycle: 'deprecated',
  releasedAt: '2024-01-01T00:00:00Z',
  deprecatedAt: '2025-01-01T00:00:00Z',
  sunsetAt: inDays(180),
  successorVersion: 'v2',
  migrationUrl: 'https://docs.subtrackr.io/migration',
  ...overrides,
});

describe('severityFor', () => {
  const config = deprecated();

  it('is ok for an active version', () => {
    expect(severityFor(active('v2'), 10, 5)).toBe('ok');
  });

  it('is ok for a deprecated version with a distant sunset and no traffic', () => {
    expect(severityFor(config, 180, 0)).toBe('ok');
  });

  it('is warning when a distant deprecation still has traffic', () => {
    expect(severityFor(config, 180, 3)).toBe('warning');
  });

  it('is warning inside the warning window', () => {
    expect(severityFor(config, SUNSET_WARNING_DAYS, 0)).toBe('warning');
  });

  it('is critical inside the critical window', () => {
    expect(severityFor(config, SUNSET_CRITICAL_DAYS, 0)).toBe('critical');
  });

  it('is overdue once the date has passed', () => {
    expect(severityFor(config, -1, 0)).toBe('overdue');
  });

  it('is warning for a deprecation with no sunset date at all', () => {
    expect(severityFor({ ...config, sunsetAt: undefined }, null, 0)).toBe('warning');
  });

  it('is sunset for a sunset version, whatever its dates or traffic', () => {
    expect(
      severityFor({ ...config, lifecycle: 'sunset', sunsetAt: inDays(10) }, 10, 100)
    ).toBe('sunset');
  });
});

describe('buildDeprecationReport', () => {
  it('reports a version per row, newest first', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated(), active('v2'), active('v3')]),
      { now: NOW }
    );
    expect(report.rows.map((row) => row.version)).toEqual(['v3', 'v2', 'v1']);
  });

  it('counts whole days until sunset', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(10) })]),
      { now: NOW }
    );
    expect(report.rows[0].daysUntilSunset).toBe(10);
  });

  it('reports a negative day count once the date has passed', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(-3) })]),
      { now: NOW }
    );
    expect(report.rows[0].daysUntilSunset).toBe(-3);
    expect(report.rows[0].severity).toBe('overdue');
  });

  it('reports null days when there is no sunset date', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: undefined })]),
      { now: NOW }
    );
    expect(report.rows[0].daysUntilSunset).toBeNull();
  });

  it('computes traffic share across versions', () => {
    const registry = registryWith([deprecated(), active('v2')]);
    registry.recordRequest('v1');
    registry.recordRequest('v1');
    registry.recordRequest('v2');
    const report = buildDeprecationReport(registry, { now: NOW });
    const v1 = report.rows.find((row) => row.version === 'v1')!;
    const v2 = report.rows.find((row) => row.version === 'v2')!;
    expect(v1.trafficShare).toBeCloseTo(2 / 3);
    expect(v2.trafficShare).toBeCloseTo(1 / 3);
  });

  it('reports a zero share when nothing has been served', () => {
    const report = buildDeprecationReport(registryWith([active('v2')]), { now: NOW });
    expect(report.rows[0].trafficShare).toBe(0);
  });

  it('lists a deprecated version still taking traffic as needing migration', () => {
    const registry = registryWith([deprecated(), active('v2')]);
    registry.recordRequest('v1');
    const report = buildDeprecationReport(registry, { now: NOW });
    expect(report.needsMigration.map((row) => row.version)).toEqual(['v1']);
  });

  it('does not list a deprecated version with no traffic', () => {
    const report = buildDeprecationReport(registryWith([deprecated(), active('v2')]), { now: NOW });
    expect(report.needsMigration).toEqual([]);
  });

  it('flags a sunset version still receiving requests', () => {
    const registry = registryWith([
      { ...deprecated(), lifecycle: 'sunset', sunsetAt: inDays(-10) },
      active('v2'),
    ]);
    registry.recordRequest('v1');
    const report = buildDeprecationReport(registry, { now: NOW });
    expect(report.stillServingSunset.map((row) => row.version)).toEqual(['v1']);
  });

  it('lists versions with no traffic as idle', () => {
    const registry = registryWith([deprecated(), active('v2')]);
    registry.recordRequest('v2');
    const report = buildDeprecationReport(registry, { now: NOW });
    expect(report.idle.map((row) => row.version)).toEqual(['v1']);
  });

  it('points at the nearest upcoming sunset', () => {
    const report = buildDeprecationReport(
      registryWith([
        deprecated({ version: 'v1', sunsetAt: inDays(200) }),
        deprecated({ version: 'v0', sunsetAt: inDays(20) }),
      ]),
      { now: NOW }
    );
    expect(report.nextSunsetAt).toBe(inDays(20));
    expect(report.daysUntilNextSunset).toBe(20);
  });

  it('ignores a passed sunset when looking for the next one', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(-1) }), active('v2')]),
      { now: NOW }
    );
    expect(report.nextSunsetAt).toBeUndefined();
    expect(report.daysUntilNextSunset).toBeNull();
  });

  it('summarises the fleet', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated(), active('v2'), active('v3')]),
      { now: NOW }
    );
    expect(report.summary).toMatchObject({ total: 3, active: 2, deprecated: 1, sunset: 0, draft: 0 });
  });

  it('raises an overdue finding for a passed sunset date', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(-5) })]),
      { now: NOW }
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('overdue');
    expect(report.findings[0].message).toContain('passed its sunset date');
  });

  it('raises a critical finding inside the critical window, quoting the traffic', () => {
    const registry = registryWith([deprecated({ sunsetAt: inDays(5) })]);
    registry.recordRequest('v1');
    const report = buildDeprecationReport(registry, { now: NOW });
    expect(report.findings[0].severity).toBe('critical');
    expect(report.findings[0].message).toContain('1 request(s)');
  });

  it('sorts overdue findings above critical ones', () => {
    const report = buildDeprecationReport(
      registryWith([
        deprecated({ version: 'v1', sunsetAt: inDays(2) }),
        deprecated({ version: 'v0', sunsetAt: inDays(-2) }),
      ]),
      { now: NOW }
    );
    expect(report.findings.map((f) => f.severity)).toEqual(['overdue', 'critical']);
  });

  it('raises nothing for a healthy fleet', () => {
    const registry = registryWith([deprecated(), active('v2')]);
    registry.recordRequest('v2');
    const report = buildDeprecationReport(registry, { now: NOW });
    expect(report.findings).toEqual([]);
    expect(isHealthy(report)).toBe(true);
  });

  it('is unhealthy when a sunset version is still served', () => {
    const registry = registryWith([
      { ...deprecated(), lifecycle: 'sunset', sunsetAt: inDays(-1) },
      active('v2'),
    ]);
    registry.recordRequest('v1');
    expect(isHealthy(buildDeprecationReport(registry, { now: NOW }))).toBe(false);
  });
});

describe('formatFindings', () => {
  it('confirms a healthy fleet', () => {
    const report = buildDeprecationReport(registryWith([active('v2')]), { now: NOW });
    expect(formatFindings(report)).toContain('No deprecation issues');
  });

  it('prefixes each problem with its severity', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(-1) })]),
      { now: NOW }
    );
    expect(formatFindings(report)).toMatch(/^\[OVERDUE]/);
  });
});

describe('formatReportTable', () => {
  it('renders a header and one line per version', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: inDays(10) }), active('v2')]),
      { now: NOW }
    );
    const table = formatReportTable(report);
    const lines = table.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('VERSION');
    expect(table).toContain('v1');
    expect(table).toContain('critical');
  });

  it('renders a dash when a version has no sunset date', () => {
    const report = buildDeprecationReport(
      registryWith([deprecated({ sunsetAt: undefined })]),
      { now: NOW }
    );
    expect(formatReportTable(report)).toMatch(/\s-\s/);
  });
});

describe('toJson', () => {
  it('flattens the migration and sunset lists to version strings', () => {
    const registry = registryWith([deprecated(), active('v2')]);
    registry.recordRequest('v1');
    const json = toJson(buildDeprecationReport(registry, { now: NOW }));
    expect(json.needsMigration).toEqual(['v1']);
    expect(json.stillServingSunset).toEqual([]);
  });

  it('includes the summary and health flag', () => {
    const json = toJson(buildDeprecationReport(registryWith([active('v2')]), { now: NOW }));
    expect(json.healthy).toBe(true);
    expect((json.summary as { total: number }).total).toBe(1);
  });

  it('serialises without losing the rows', () => {
    const report = buildDeprecationReport(registryWith([active('v2')]), { now: NOW });
    expect(() => JSON.stringify(toJson(report))).not.toThrow();
  });
});
