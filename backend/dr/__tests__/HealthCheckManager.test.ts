import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { HealthCheckManager } from '../HealthCheckManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a temp directory with a minimal project structure */
function makeTempProject(overrides: { noNodeModules?: boolean; badTsConfig?: boolean; noPkg?: boolean } = {}): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-dr-test-'));

  if (!overrides.noPkg) {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0', scripts: { test: 'jest' } })
    );
  }

  if (!overrides.badTsConfig) {
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2017', strict: false } })
    );
  } else {
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), 'NOT VALID JSON {{{{');
  }

  if (!overrides.noNodeModules) {
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.mkdirSync(path.join(tmp, 'node_modules', 'some-package'));
  }

  return tmp;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthCheckManager', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempProject();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── Constructor ─────────────────────────────────────────────────────────

  it('creates with default options', () => {
    const mgr = new HealthCheckManager();
    expect(mgr).toBeDefined();
  });

  it('creates with custom projectRoot', () => {
    const mgr = new HealthCheckManager({ projectRoot: tmp });
    expect(mgr).toBeDefined();
  });

  // ── checkBuildEnvironment ────────────────────────────────────────────────

  describe('checkBuildEnvironment', () => {
    it('returns healthy when Node.js >= 18', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkBuildEnvironment();
      expect(result.id).toBe('build:node-version');
      expect(result.category).toBe('build');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
      // Current Node version in CI is >= 18 per README requirements
      if (parseInt(process.version.replace('v', '').split('.')[0], 10) >= 18) {
        expect(result.healthy).toBe(true);
        expect(result.status).toBe('healthy');
      }
    });

    it('includes version metadata', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkBuildEnvironment();
      expect(result.metadata).toHaveProperty('version');
      expect(result.metadata).toHaveProperty('major');
      expect(result.metadata).toHaveProperty('required');
    });
  });

  // ── checkDependencies ────────────────────────────────────────────────────

  describe('checkDependencies', () => {
    it('returns healthy when node_modules exists and has packages', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkDependencies();
      expect(result.id).toBe('build:dependencies');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.metadata).toHaveProperty('exists', true);
    });

    it('returns critical when node_modules is missing', async () => {
      const noModules = makeTempProject({ noNodeModules: true });
      const mgr = new HealthCheckManager({ projectRoot: noModules });
      const result = await mgr.checkDependencies();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('critical');
      fs.rmSync(noModules, { recursive: true, force: true });
    });

    it('includes package count in metadata', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkDependencies();
      expect(result.metadata).toHaveProperty('packageCount');
      expect(typeof result.metadata!.packageCount).toBe('number');
    });
  });

  // ── checkTypeScriptConfig ─────────────────────────────────────────────────

  describe('checkTypeScriptConfig', () => {
    it('returns healthy for valid tsconfig.json', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkTypeScriptConfig();
      expect(result.id).toBe('build:tsconfig');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('healthy');
    });

    it('returns critical for malformed tsconfig.json', async () => {
      const badTmp = makeTempProject({ badTsConfig: true });
      const mgr = new HealthCheckManager({ projectRoot: badTmp });
      const result = await mgr.checkTypeScriptConfig();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('critical');
      expect(result.message).toMatch(/parse error/i);
      fs.rmSync(badTmp, { recursive: true, force: true });
    });

    it('returns critical when tsconfig.json is absent', async () => {
      const noTsc = makeTempProject();
      fs.rmSync(path.join(noTsc, 'tsconfig.json'));
      const mgr = new HealthCheckManager({ projectRoot: noTsc });
      const result = await mgr.checkTypeScriptConfig();
      expect(result.healthy).toBe(false);
      fs.rmSync(noTsc, { recursive: true, force: true });
    });

    it('includes compiler options in metadata', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkTypeScriptConfig();
      expect(result.metadata).toHaveProperty('target', 'ES2017');
    });
  });

  // ── checkPackageJson ──────────────────────────────────────────────────────

  describe('checkPackageJson', () => {
    it('returns healthy for valid package.json', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkPackageJson();
      expect(result.id).toBe('build:package-json');
      expect(result.healthy).toBe(true);
      expect(result.metadata).toHaveProperty('name', 'test-project');
    });

    it('returns degraded when package.json is missing', async () => {
      const noPkg = makeTempProject({ noPkg: true });
      const mgr = new HealthCheckManager({ projectRoot: noPkg });
      const result = await mgr.checkPackageJson();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('degraded');
      fs.rmSync(noPkg, { recursive: true, force: true });
    });
  });

  // ── checkDiskSpace ────────────────────────────────────────────────────────

  describe('checkDiskSpace', () => {
    it('returns a result with freeMb and totalMb metadata', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkDiskSpace();
      expect(result.id).toBe('infra:disk-space');
      expect(result.category).toBe('infrastructure');
      expect(result.metadata).toHaveProperty('freeMb');
      expect(result.metadata).toHaveProperty('totalMb');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('status is either healthy, degraded or critical', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkDiskSpace();
      expect(['healthy', 'degraded', 'critical']).toContain(result.status);
    });
  });

  // ── checkMemory ───────────────────────────────────────────────────────────

  describe('checkMemory', () => {
    it('returns memory stats', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkMemory();
      expect(result.id).toBe('infra:memory');
      expect(result.metadata).toHaveProperty('freeMb');
      expect(result.metadata).toHaveProperty('totalMb');
      expect(result.metadata).toHaveProperty('usedPct');
    });

    it('reports healthy for typical systems (free memory > threshold)', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.checkMemory();
      // On a normal dev machine, used% should be < 95
      expect(['healthy', 'degraded']).toContain(result.status);
    });
  });

  // ── runAll ────────────────────────────────────────────────────────────────

  describe('runAll', () => {
    it('returns a summary with all checks', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await mgr.runAll();
      expect(summary.checks.length).toBeGreaterThanOrEqual(4);
      expect(summary.overall).toBeDefined();
      expect(typeof summary.allHealthy).toBe('boolean');
      expect(summary.timestamp).toBeGreaterThan(0);
    });

    it('overall is critical when node_modules missing', async () => {
      const noMods = makeTempProject({ noNodeModules: true });
      const mgr = new HealthCheckManager({ projectRoot: noMods });
      const summary = await mgr.runAll();
      expect(summary.overall).toBe('critical');
      expect(summary.allHealthy).toBe(false);
      fs.rmSync(noMods, { recursive: true, force: true });
    });

    it('includes timestamp', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await mgr.runAll();
      expect(summary.timestamp).toBeGreaterThan(Date.now() - 10_000);
    });

    it('includes custom checks', async () => {
      const customCheck = jest.fn().mockResolvedValue({
        id: 'custom:test',
        name: 'Custom test check',
        category: 'build' as const,
        status: 'healthy' as const,
        healthy: true,
        message: 'All good',
      });
      const mgr = new HealthCheckManager({
        projectRoot: tmp,
        customChecks: [customCheck],
      });
      const summary = await mgr.runAll();
      const custom = summary.checks.find((c) => c.id === 'custom:test');
      expect(custom).toBeDefined();
      expect(customCheck).toHaveBeenCalled();
    });

    it('handles custom check that throws', async () => {
      const errorCheck = jest.fn().mockRejectedValue(new Error('custom check exploded'));
      const mgr = new HealthCheckManager({
        projectRoot: tmp,
        customChecks: [errorCheck],
      });
      const summary = await mgr.runAll();
      // Should still complete; the throwing check becomes 'critical'
      const errResult = summary.checks.find((c) => c.healthy === false && c.message?.includes('error'));
      expect(errResult).toBeDefined();
    });
  });

  // ── runCategory ───────────────────────────────────────────────────────────

  describe('runCategory', () => {
    it('runs only build checks', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await mgr.runCategory('build');
      expect(summary.checks.every((c) => c.category === 'build')).toBe(true);
    });

    it('runs only infrastructure checks', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await mgr.runCategory('infrastructure');
      // Infrastructure category includes disk, memory, and dependency checks
      expect(summary.checks.length).toBeGreaterThan(0);
      // All infra checks should be infra or build category (dependencies is build)
      const knownCategories = ['infrastructure', 'build'];
      expect(summary.checks.every((c) => knownCategories.includes(c.category))).toBe(true);
    });

    it('returns empty for service category', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await mgr.runCategory('service');
      expect(summary.checks).toHaveLength(0);
      expect(summary.overall).toBe('healthy'); // no checks = trivially healthy
    });
  });

  // ── runById ───────────────────────────────────────────────────────────────

  describe('runById', () => {
    it('finds a check by ID', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.runById('build:node-version');
      expect(result).toBeDefined();
      expect(result!.id).toBe('build:node-version');
    });

    it('returns null for unknown ID', async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await mgr.runById('nonexistent:check');
      expect(result).toBeNull();
    });
  });
});
