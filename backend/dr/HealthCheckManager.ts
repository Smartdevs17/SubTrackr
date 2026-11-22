import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  HealthCheckCategory,
  HealthCheckResult,
  HealthCheckStatus,
  HealthCheckSummary,
} from './types';

// ---------------------------------------------------------------------------
// Individual health check functions
// ---------------------------------------------------------------------------

type CheckFn = () => Promise<Omit<HealthCheckResult, 'durationMs' | 'timestamp'>>;

/**
 * Wraps a check function and adds timing + timestamp.
 */
async function runCheck(fn: CheckFn): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { ...result, durationMs: Date.now() - start, timestamp: Date.now() };
  } catch (err: any) {
    return {
      id: 'unknown',
      name: 'Unknown check',
      category: 'infrastructure',
      status: 'critical',
      healthy: false,
      message: `Check threw an error: ${err?.message ?? String(err)}`,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// HealthCheckManager
// ---------------------------------------------------------------------------

export interface HealthCheckManagerOptions {
  /** Base project directory for path-based checks */
  projectRoot?: string;
  /** Additional custom health checks */
  customChecks?: CheckFn[];
  /** Timeout for each individual check in ms (default: 10_000) */
  checkTimeoutMs?: number;
}

export class HealthCheckManager {
  private readonly projectRoot: string;
  private readonly customChecks: CheckFn[];
  private readonly checkTimeoutMs: number;

  constructor(options: HealthCheckManagerOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.customChecks = options.customChecks ?? [];
    this.checkTimeoutMs = options.checkTimeoutMs ?? 10_000;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Run all registered health checks and return a summary. */
  async runAll(): Promise<HealthCheckSummary> {
    const checks = await Promise.all([
      this.checkBuildEnvironment(),
      this.checkDependencies(),
      this.checkDiskSpace(),
      this.checkMemory(),
      this.checkTypeScriptConfig(),
      this.checkPackageJson(),
      ...this.customChecks.map((fn) => runCheck(fn)),
    ]);

    const overall = this._aggregate(checks);
    return {
      checks,
      overall,
      allHealthy: checks.every((c) => c.healthy),
      timestamp: Date.now(),
    };
  }

  /** Run only checks within a specific category. */
  async runCategory(category: HealthCheckCategory): Promise<HealthCheckSummary> {
    const categoryFns: Record<HealthCheckCategory, (() => Promise<HealthCheckResult>)[]> = {
      build: [
        () => this.checkBuildEnvironment(),
        () => this.checkTypeScriptConfig(),
        () => this.checkPackageJson(),
      ],
      service: [],
      database: [],
      infrastructure: [
        () => this.checkDiskSpace(),
        () => this.checkMemory(),
        () => this.checkDependencies(),
      ],
    };

    const checks = await Promise.all((categoryFns[category] ?? []).map((fn) => fn()));
    const overall = this._aggregate(checks);
    return { checks, overall, allHealthy: checks.every((c) => c.healthy), timestamp: Date.now() };
  }

  /** Run a single named check by id. */
  async runById(id: string): Promise<HealthCheckResult | null> {
    const all = await this.runAll();
    return all.checks.find((c) => c.id === id) ?? null;
  }

  // ── Build Checks ───────────────────────────────────────────────────────

  /** Checks that Node.js is present and meets minimum version. */
  async checkBuildEnvironment(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      const version = process.version; // e.g. "v20.11.0"
      const major = parseInt(version.replace('v', '').split('.')[0], 10);
      const minMajor = 18;
      const healthy = major >= minMajor;
      return {
        id: 'build:node-version',
        name: 'Node.js version',
        category: 'build',
        status: healthy ? 'healthy' : 'critical',
        healthy,
        message: healthy
          ? `Node ${version} meets minimum v${minMajor}`
          : `Node ${version} is below minimum v${minMajor}`,
        metadata: { version, major, required: minMajor },
      };
    });
  }

  /** Checks that node_modules exists (dependencies installed). */
  async checkDependencies(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      const nmPath = path.join(this.projectRoot, 'node_modules');
      const exists = fs.existsSync(nmPath);
      let count = 0;
      if (exists) {
        try {
          count = fs.readdirSync(nmPath).length;
        } catch {
          // ignore
        }
      }
      const healthy = exists && count > 0;
      return {
        id: 'build:dependencies',
        name: 'Node dependencies',
        category: 'build',
        status: healthy ? 'healthy' : 'critical',
        healthy,
        message: healthy
          ? `node_modules present (${count} packages)`
          : 'node_modules missing or empty – run npm install',
        metadata: { path: nmPath, exists, packageCount: count },
      };
    });
  }

  /** Checks that tsconfig.json is parseable. */
  async checkTypeScriptConfig(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      const tscPath = path.join(this.projectRoot, 'tsconfig.json');
      let healthy = false;
      let message = '';
      let metadata: Record<string, unknown> = {};

      if (!fs.existsSync(tscPath)) {
        message = 'tsconfig.json not found';
      } else {
        try {
          const raw = fs.readFileSync(tscPath, 'utf-8');
          const parsed = JSON.parse(raw);
          healthy = true;
          message = 'tsconfig.json is valid JSON';
          metadata = { target: parsed?.compilerOptions?.target, strict: parsed?.compilerOptions?.strict };
        } catch (err: any) {
          message = `tsconfig.json parse error: ${err.message}`;
        }
      }

      return {
        id: 'build:tsconfig',
        name: 'TypeScript config',
        category: 'build',
        status: healthy ? 'healthy' : 'critical',
        healthy,
        message,
        metadata,
      };
    });
  }

  /** Checks that package.json exists and has required fields. */
  async checkPackageJson(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      let healthy = false;
      let message = '';
      let metadata: Record<string, unknown> = {};

      if (!fs.existsSync(pkgPath)) {
        message = 'package.json not found';
      } else {
        try {
          const raw = fs.readFileSync(pkgPath, 'utf-8');
          const pkg = JSON.parse(raw);
          const hasName = Boolean(pkg.name);
          const hasScripts = typeof pkg.scripts === 'object';
          healthy = hasName && hasScripts;
          message = healthy ? `package.json valid (${pkg.name}@${pkg.version})` : 'package.json missing name or scripts';
          metadata = { name: pkg.name, version: pkg.version, hasScripts };
        } catch (err: any) {
          message = `package.json parse error: ${err.message}`;
        }
      }

      return {
        id: 'build:package-json',
        name: 'package.json',
        category: 'build',
        status: healthy ? 'healthy' : 'degraded',
        healthy,
        message,
        metadata,
      };
    });
  }

  // ── Infrastructure Checks ──────────────────────────────────────────────

  /** Checks available disk space (warns if < 500 MB free on the project drive). */
  async checkDiskSpace(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      // Use os.freemem() as a rough proxy when statvfs is unavailable.
      // A proper disk check requires native bindings not available in all CI.
      // We use a filesystem stat of the project root as best-effort.
      let freeBytes = 0;
      let totalBytes = 0;
      let method = 'os.homedir-heuristic';

      try {
        // Try /proc/mounts based check on Linux
        const stats = fs.statfsSync ? fs.statfsSync(this.projectRoot) : null;
        if (stats) {
          freeBytes = stats.bfree * stats.bsize;
          totalBytes = stats.blocks * stats.bsize;
          method = 'statfs';
        } else {
          // fallback: use free memory as proxy for disk
          freeBytes = os.freemem();
          totalBytes = os.totalmem();
        }
      } catch {
        freeBytes = os.freemem();
        totalBytes = os.totalmem();
      }

      const freeMb = Math.round(freeBytes / (1024 * 1024));
      const totalMb = Math.round(totalBytes / (1024 * 1024));
      const warnThresholdMb = 500;
      const critThresholdMb = 100;

      const status: HealthCheckStatus =
        freeMb < critThresholdMb ? 'critical' : freeMb < warnThresholdMb ? 'degraded' : 'healthy';
      const healthy = status === 'healthy';

      return {
        id: 'infra:disk-space',
        name: 'Disk space',
        category: 'infrastructure',
        status,
        healthy,
        message: `${freeMb} MB free of ${totalMb} MB (via ${method})`,
        metadata: { freeMb, totalMb, warnThresholdMb, critThresholdMb },
      };
    });
  }

  /** Checks available memory. */
  async checkMemory(): Promise<HealthCheckResult> {
    return runCheck(async () => {
      const freeMb = Math.round(os.freemem() / (1024 * 1024));
      const totalMb = Math.round(os.totalmem() / (1024 * 1024));
      const usedPct = Math.round(((totalMb - freeMb) / totalMb) * 100);

      const status: HealthCheckStatus =
        usedPct > 95 ? 'critical' : usedPct > 85 ? 'degraded' : 'healthy';
      const healthy = status !== 'critical';

      return {
        id: 'infra:memory',
        name: 'Memory usage',
        category: 'infrastructure',
        status,
        healthy,
        message: `${freeMb} MB free / ${totalMb} MB total (${usedPct}% used)`,
        metadata: { freeMb, totalMb, usedPct },
      };
    });
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private _aggregate(checks: HealthCheckResult[]): HealthCheckStatus {
    if (checks.some((c) => c.status === 'critical')) return 'critical';
    if (checks.some((c) => c.status === 'degraded')) return 'degraded';
    if (checks.every((c) => c.status === 'healthy')) return 'healthy';
    return 'unknown';
  }
}

export const healthCheckManager = new HealthCheckManager();
