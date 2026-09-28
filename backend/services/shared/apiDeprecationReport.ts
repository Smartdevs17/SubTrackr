/**
 * API version deprecation reporting.
 *
 * `apiVersioning.ts` knows how to *serve* a version: resolve it, attach
 * `Deprecation` and `Sunset` headers, refuse a sunset version. It has no way to
 * *report* on the fleet, which is what a team needs before a deprecation ships:
 * which versions are still taking traffic, how long each has until sunset, and
 * which ones are dangerously close.
 *
 * The report is built from the same registry the middleware uses, so what it
 * prints is what the server enforces. It is a pure function over
 * `VersionRegistryStats` plus the registry's version list — no I/O, no clock
 * beyond the injected `now` — which is what makes it safe to assert in CI.
 */

import {
  ApiVersionRegistry,
  parseVersionNumber,
  type VersionConfig,
  type VersionRegistryStats,
} from './apiVersioning';

// ─── Thresholds ─────────────────────────────────────────────────────

/** Days before a sunset date at which a version is flagged as approaching. */
export const SUNSET_WARNING_DAYS = 90;

/** Days before a sunset date at which a version is flagged as urgent. */
export const SUNSET_CRITICAL_DAYS = 30;

export type DeprecationSeverity = 'ok' | 'warning' | 'critical' | 'overdue' | 'sunset';

/** Worst first. Used to order findings and to rank rows in output. */
const SEVERITY_RANK: Record<DeprecationFinding['severity'] | 'ok' | 'sunset', number> = {
  overdue: 4,
  critical: 3,
  warning: 2,
  ok: 1,
  sunset: 0,
};

export interface VersionReportRow {
  version: string;
  lifecycle: VersionConfig['lifecycle'];
  deprecatedAt?: string;
  sunsetAt?: string;
  /** Whole days until sunset; negative once the date has passed. */
  daysUntilSunset: number | null;
  /** Requests seen since the last analytics reset. */
  requestCount: number;
  /** Share of requests on this version, 0-1. */
  trafficShare: number;
  /** Requests still arriving on a deprecated version. */
  deprecatedRequestCount: number;
  successorVersion?: string;
  migrationUrl?: string;
  severity: DeprecationSeverity;
  /** True while clients are still on a version that is going away. */
  hasRemainingTraffic: boolean;
}

export interface DeprecationReport {
  generatedAt: string;
  /** ISO date of the earliest sunset still in the future. */
  nextSunsetAt?: string;
  daysUntilNextSunset: number | null;
  rows: VersionReportRow[];
  /** Versions with traffic that are on their way out. */
  needsMigration: VersionReportRow[];
  /** Sunset versions still receiving requests: a support burden, not a bug. */
  stillServingSunset: VersionReportRow[];
  /** Registered versions that received no traffic at all. */
  idle: VersionReportRow[];
  summary: {
    total: number;
    active: number;
    deprecated: number;
    sunset: number;
    draft: number;
    totalRequests: number;
  };
  /** Problems worth failing a check on, worst first. */
  findings: DeprecationFinding[];
}

export interface DeprecationFinding {
  severity: 'warning' | 'critical' | 'overdue';
  version: string;
  message: string;
}

// ─── Severity ───────────────────────────────────────────────────────

/**
 * Classify one version.
 *
 * A sunset version is always `sunset` regardless of traffic: it is a fact about
 * the version, not a risk, and folding it into `overdue` would double-count a
 * date that has already been reported.
 */
export function severityFor(
  config: VersionConfig,
  daysUntilSunset: number | null,
  deprecatedRequestCount: number
): DeprecationSeverity {
  if (config.lifecycle === 'sunset') return 'sunset';
  if (config.lifecycle !== 'deprecated') return 'ok';
  if (daysUntilSunset === null) return 'warning';
  if (daysUntilSunset < 0) return 'overdue';
  if (daysUntilSunset <= SUNSET_CRITICAL_DAYS) return 'critical';
  if (daysUntilSunset <= SUNSET_WARNING_DAYS) return 'warning';
  return deprecatedRequestCount > 0 ? 'warning' : 'ok';
}

function wholeDaysUntil(date: string | undefined, now: Date): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

// ─── Report ─────────────────────────────────────────────────────────

export interface BuildReportOptions {
  /** Overrides "now", so a report over a fixed clock is deterministic. */
  now?: Date;
}

/**
 * Build a deprecation report for every version in the registry.
 *
 * Traffic share is computed over the versions that received traffic, so a
 * version nobody uses reads as 0% rather than dragging the denominator to zero.
 */
export function buildDeprecationReport(
  registry: ApiVersionRegistry,
  options: BuildReportOptions = {}
): DeprecationReport {
  const now = options.now ?? new Date();
  const stats: VersionRegistryStats = registry.getStats();
  const analyticsByVersion = new Map(stats.perVersion.map((entry) => [entry.version, entry]));
  const totalRequests = stats.perVersion.reduce((sum, entry) => sum + entry.requestCount, 0);

  const rows: VersionReportRow[] = registry
    .getAll()
    .map((config) => {
      const analytics = analyticsByVersion.get(config.version);
      const requestCount = analytics?.requestCount ?? 0;
      const deprecatedRequestCount = analytics?.deprecatedRequestCount ?? 0;
      const daysUntilSunset = wholeDaysUntil(config.sunsetAt, now);

      return {
        version: config.version,
        lifecycle: config.lifecycle,
        deprecatedAt: config.deprecatedAt,
        sunsetAt: config.sunsetAt,
        daysUntilSunset,
        requestCount,
        trafficShare: totalRequests === 0 ? 0 : requestCount / totalRequests,
        deprecatedRequestCount,
        successorVersion: config.successorVersion,
        migrationUrl: config.migrationUrl,
        severity: severityFor(config, daysUntilSunset, deprecatedRequestCount),
        // A sunset version still taking traffic is worth surfacing: the
        // middleware is answering 410s that a client is still generating.
        hasRemainingTraffic:
          deprecatedRequestCount > 0 || (config.lifecycle === 'sunset' && requestCount > 0),
      };
    })
    .sort((a, b) => {
      // Newest version first, so the top of the report is what people run.
      const diff = parseVersionNumber(b.version) - parseVersionNumber(a.version);
      return diff !== 0 ? diff : a.version.localeCompare(b.version);
    });

  const upcoming = rows
    .filter((row) => row.sunsetAt && row.daysUntilSunset !== null && row.daysUntilSunset >= 0)
    .sort((a, b) => (parseDate(a.sunsetAt) ?? 0) - (parseDate(b.sunsetAt) ?? 0));

  const nextSunset = upcoming[0];
  const findings: DeprecationFinding[] = rows
    .filter((row) => row.severity === 'overdue' || row.severity === 'critical')
    .map((row) => ({
      severity: row.severity as 'warning' | 'critical' | 'overdue',
      version: row.version,
      message:
        row.severity === 'overdue'
          ? `Version ${row.version} passed its sunset date on ${row.sunsetAt} but is still registered.`
          : `Version ${row.version} sunsets in ${row.daysUntilSunset} day(s) and ${row.deprecatedRequestCount} request(s) are still arriving on it.`,
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    generatedAt: now.toISOString(),
    nextSunsetAt: nextSunset?.sunsetAt,
    daysUntilNextSunset: nextSunset?.daysUntilSunset ?? null,
    rows,
    needsMigration: rows.filter(
      (row) => row.lifecycle === 'deprecated' && row.hasRemainingTraffic
    ),
    stillServingSunset: rows.filter(
      (row) => row.lifecycle === 'sunset' && row.requestCount > 0
    ),
    idle: rows.filter((row) => row.requestCount === 0),
    summary: {
      total: stats.totalVersions,
      active: stats.activeVersions,
      deprecated: stats.deprecatedVersions,
      sunset: stats.sunsetVersions,
      draft: stats.draftVersions,
      totalRequests,
    },
    findings,
  };
}

// ─── Assertions ─────────────────────────────────────────────────────

/** True when nothing in the report warrants a page. */
export function isHealthy(report: DeprecationReport): boolean {
  return report.findings.length === 0 && report.stillServingSunset.length === 0;
}

/** One line per problem, or a confirmation when there are none. */
export function formatFindings(report: DeprecationReport): string {
  if (report.findings.length === 0) {
    return 'No deprecation issues: every sunset date is more than ' +
      `${SUNSET_CRITICAL_DAYS} days away and no sunset version is receiving traffic.`;
  }
  return report.findings
    .map((finding) => `[${finding.severity.toUpperCase()}] ${finding.message}`)
    .join('\n');
}

/** A fixed-width table of the fleet, for a CI job annotation or a changelog entry. */
export function formatReportTable(report: DeprecationReport): string {
  const header = ['VERSION', 'LIFECYCLE', 'SUNSET', 'DAYS', 'REQUESTS', 'SEVERITY'];
  const body = report.rows.map((row) => [
    row.version,
    row.lifecycle,
    row.sunsetAt ? row.sunsetAt.slice(0, 10) : '-',
    row.daysUntilSunset === null ? '-' : String(row.daysUntilSunset),
    String(row.requestCount),
    row.severity,
  ]);

  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...body.map((line) => line[index].length))
  );
  const render = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();

  return [render(header), render(widths.map((width) => '-'.repeat(width))), ...body.map(render)].join(
    '\n'
  );
}

/**
 * A machine-readable form for a CI artifact.
 *
 * `needsMigration` and `stillServingSunset` are flattened to version strings
 * because a consumer almost always wants the list, not the whole row.
 */
export function toJson(report: DeprecationReport): Record<string, unknown> {
  return {
    generatedAt: report.generatedAt,
    summary: report.summary,
    nextSunsetAt: report.nextSunsetAt ?? null,
    daysUntilNextSunset: report.daysUntilNextSunset,
    healthy: isHealthy(report),
    needsMigration: report.needsMigration.map((row) => row.version),
    stillServingSunset: report.stillServingSunset.map((row) => row.version),
    findings: report.findings,
    versions: report.rows,
  };
}
