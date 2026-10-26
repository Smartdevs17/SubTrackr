/**
 * Tests for comprehensive API documentation with interactive playground (issue #938)
 * Technical scope: developer-portal/src/, developer-portal/docs/
 *
 * Covers:
 *  - DocumentationService  (article CRUD, search, sections)
 *  - DeveloperPortalService (developer registration, API keys, usage tracking, dashboard)
 *  - openapi.json          (spec structure validation)
 */

// ── Stub the missing sandboxService dependency ────────────────────────────────
// The developerPortalService imports sandboxService from a path that doesn't
// exist in this repo layout; stub it out so tests can run without that service.
jest.mock(
  '../../sandbox/services/sandboxService',
  () => ({
    sandboxService: {
      createEnvironment: jest.fn().mockResolvedValue({ id: 'env-stub', name: 'stub' }),
      getEnvironment: jest.fn().mockResolvedValue(null),
      listEnvironments: jest.fn().mockResolvedValue([]),
    },
  }),
  { virtual: true }
);

import { DocumentationService } from '../services/documentationService';
import { DeveloperPortalService } from '../services/developerPortalService';
import openApiSpec from '../docs/openapi.json';

// ─────────────────────────────────────────────────────────────────────────────
// DocumentationService
// ─────────────────────────────────────────────────────────────────────────────

describe('DocumentationService', () => {
  let svc: DocumentationService;

  beforeEach(() => {
    svc = new DocumentationService();
  });

  // ── Sections ───────────────────────────────────────────────────────────────

  describe('getSections()', () => {
    it('returns at least one section', async () => {
      const sections = await svc.getSections();
      expect(sections.length).toBeGreaterThan(0);
    });

    it('each section has required fields', async () => {
      const sections = await svc.getSections();
      for (const section of sections) {
        expect(typeof section.id).toBe('string');
        expect(typeof section.title).toBe('string');
        expect(Array.isArray(section.articles)).toBe(true);
      }
    });
  });

  describe('getSection()', () => {
    it('returns a known section by id', async () => {
      const sections = await svc.getSections();
      const first = sections[0];
      const result = await svc.getSection(first.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(first.id);
    });

    it('returns null for an unknown section id', async () => {
      const result = await svc.getSection('non-existent-id');
      expect(result).toBeNull();
    });
  });

  // ── Articles ───────────────────────────────────────────────────────────────

  describe('getArticle()', () => {
    it('returns an article by its slug', async () => {
      const sections = await svc.getSections();
      const article = sections[0]?.articles[0];
      expect(article).toBeDefined();

      const result = await svc.getArticle(article.slug);
      expect(result).not.toBeNull();
      expect(result!.slug).toBe(article.slug);
    });

    it('returns null for an unknown slug', async () => {
      const result = await svc.getArticle('no-such-slug');
      expect(result).toBeNull();
    });

    it('article has all required fields', async () => {
      const sections = await svc.getSections();
      const article = sections[0]?.articles[0];
      const result = await svc.getArticle(article.slug);

      expect(typeof result!.id).toBe('string');
      expect(typeof result!.title).toBe('string');
      expect(typeof result!.content).toBe('string');
      expect(typeof result!.readTime).toBe('number');
      expect(Array.isArray(result!.tags)).toBe(true);
      expect(result!.lastUpdated).toBeInstanceOf(Date);
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  describe('searchArticles()', () => {
    it('returns results matching title', async () => {
      const results = await svc.searchArticles('quick start');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty array for unmatched query', async () => {
      const results = await svc.searchArticles('zzz_no_match_xyz_9999');
      expect(results).toHaveLength(0);
    });

    it('search is case-insensitive', async () => {
      const lower = await svc.searchArticles('webhook');
      const upper = await svc.searchArticles('WEBHOOK');
      expect(lower.length).toBe(upper.length);
    });
  });

  // ── Popular / Related ──────────────────────────────────────────────────────

  describe('getPopularArticles()', () => {
    it('returns at most the requested limit', async () => {
      const results = await svc.getPopularArticles(3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('defaults to 5 when no limit provided', async () => {
      const results = await svc.getPopularArticles();
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getRelatedArticles()', () => {
    it('excludes the source article from related results', async () => {
      const sections = await svc.getSections();
      const article = sections[0]?.articles[0];
      const related = await svc.getRelatedArticles(article.slug);
      expect(related.every((r) => r.slug !== article.slug)).toBe(true);
    });

    it('returns empty array for unknown slug', async () => {
      const related = await svc.getRelatedArticles('totally-unknown-slug');
      expect(related).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DeveloperPortalService
// ─────────────────────────────────────────────────────────────────────────────

describe('DeveloperPortalService', () => {
  let svc: DeveloperPortalService;

  beforeEach(() => {
    svc = new DeveloperPortalService();
  });

  // ── Developer registration ─────────────────────────────────────────────────

  describe('registerDeveloper()', () => {
    it('creates a new developer with expected defaults', async () => {
      const dev = await svc.registerDeveloper('dev@example.com', 'Alice Dev', 'Acme Inc');
      expect(dev.id).toBeTruthy();
      expect(dev.email).toBe('dev@example.com');
      expect(dev.name).toBe('Alice Dev');
      expect(dev.tier).toBe('free');
      expect(dev.status).toBe('pending');
    });

    it('throws when registering a duplicate email', async () => {
      await svc.registerDeveloper('dup@example.com', 'Bob');
      await expect(svc.registerDeveloper('dup@example.com', 'Bob2')).rejects.toThrow();
    });
  });

  describe('getDeveloper()', () => {
    it('returns the developer by id', async () => {
      const dev = await svc.registerDeveloper('get@example.com', 'Carol');
      const found = await svc.getDeveloper(dev.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('get@example.com');
    });

    it('returns null for an unknown id', async () => {
      const result = await svc.getDeveloper('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  // ── API keys ───────────────────────────────────────────────────────────────

  describe('createApiKey()', () => {
    it('creates an API key for a registered developer', async () => {
      const dev = await svc.registerDeveloper('keys@example.com', 'Dave');
      const key = await svc.createApiKey(dev.id, 'My Key', 'test', ['subscriptions:read']);
      expect(key).not.toBeNull();
      expect(key!.name).toBe('My Key');
      expect(typeof key!.key).toBe('string');
      expect(key!.key.length).toBeGreaterThan(0);
    });

    it('returns null for unknown developer id', async () => {
      const key = await svc.createApiKey('unknown', 'Bad Key', 'test', []);
      expect(key).toBeNull();
    });
  });

  describe('getApiKeys()', () => {
    it('lists keys for a developer', async () => {
      const dev = await svc.registerDeveloper('list-keys@example.com', 'Eve');
      await svc.createApiKey(dev.id, 'Key A', 'test', []);
      await svc.createApiKey(dev.id, 'Key B', 'test', []);
      const keys = await svc.getApiKeys(dev.id);
      expect(keys.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('revokeApiKey()', () => {
    it('revokes an existing API key', async () => {
      const dev = await svc.registerDeveloper('revoke@example.com', 'Frank');
      const key = await svc.createApiKey(dev.id, 'Temp Key', 'test', []);
      const revoked = await svc.revokeApiKey(dev.id, key!.id);
      expect(revoked).toBe(true);
    });

    it('returns false when revoking a non-existent key', async () => {
      const dev = await svc.registerDeveloper('revoke2@example.com', 'Grace');
      const revoked = await svc.revokeApiKey(dev.id, 'no-such-key');
      expect(revoked).toBe(false);
    });
  });

  // ── Usage tracking ─────────────────────────────────────────────────────────

  describe('trackUsage()', () => {
    it('increments total request count', async () => {
      const dev = await svc.registerDeveloper('usage@example.com', 'Hank');
      await svc.trackUsage(dev.id, '/v1/subscriptions', 'GET', 45, true);
      const metrics = await svc.getUsageMetrics(dev.id);
      expect(metrics).not.toBeNull();
      expect(metrics!.totalRequests).toBeGreaterThanOrEqual(1);
    });

    it('counts failed requests separately from successful ones', async () => {
      const dev = await svc.registerDeveloper('usage2@example.com', 'Ivan');
      await svc.trackUsage(dev.id, '/v1/subscriptions', 'GET', 45, true);
      await svc.trackUsage(dev.id, '/v1/subscriptions', 'POST', 100, false);
      const metrics = await svc.getUsageMetrics(dev.id);
      expect(metrics!.successfulRequests).toBeGreaterThanOrEqual(1);
      expect(metrics!.failedRequests).toBeGreaterThanOrEqual(1);
    });

    it('returns null for unknown developer', async () => {
      const metrics = await svc.getUsageMetrics('ghost');
      expect(metrics).toBeNull();
    });
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────

  describe('getDashboard()', () => {
    it('returns a dashboard object with required fields', async () => {
      const dev = await svc.registerDeveloper('dash@example.com', 'Iris');
      const dashboard = await svc.getDashboard(dev.id);
      expect(dashboard).not.toBeNull();
      expect(Array.isArray(dashboard!.sandboxEnvironments)).toBe(true);
      expect(Array.isArray(dashboard!.recentActivity)).toBe(true);
      expect(Array.isArray(dashboard!.quickLinks)).toBe(true);
    });

    it('includes the developer in the dashboard', async () => {
      const dev = await svc.registerDeveloper('dash2@example.com', 'Jade');
      const dashboard = await svc.getDashboard(dev.id);
      expect(dashboard!.developer.id).toBe(dev.id);
    });

    it('returns null for unknown developer', async () => {
      const dashboard = await svc.getDashboard('unknown-dev');
      expect(dashboard).toBeNull();
    });
  });

  // ── Documentation ──────────────────────────────────────────────────────────

  describe('getDocumentation()', () => {
    it('returns documentation entries', async () => {
      const docs = await svc.getDocumentation();
      expect(Array.isArray(docs)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI spec structure validation
// ─────────────────────────────────────────────────────────────────────────────

describe('OpenAPI specification (developer-portal/docs/openapi.json)', () => {
  it('has the required OpenAPI version field', () => {
    expect(typeof openApiSpec.openapi).toBe('string');
    expect(openApiSpec.openapi).toMatch(/^3\./);
  });

  it('has info block with title and version', () => {
    const info = (openApiSpec as Record<string, unknown>).info as Record<string, unknown>;
    expect(typeof info).toBe('object');
    expect(typeof info.title).toBe('string');
    expect(typeof info.version).toBe('string');
  });

  it('has at least one path defined', () => {
    const paths = (openApiSpec as Record<string, unknown>).paths as Record<string, unknown>;
    expect(typeof paths).toBe('object');
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  it('subscription endpoints are documented', () => {
    const paths = (openApiSpec as Record<string, unknown>).paths as Record<string, unknown>;
    const pathKeys = Object.keys(paths);
    const hasSubscriptions = pathKeys.some((p) => p.includes('subscription'));
    expect(hasSubscriptions).toBe(true);
  });

  it('each documented path has at least one HTTP method', () => {
    const validMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
    const paths = (openApiSpec as Record<string, unknown>).paths as Record<
      string,
      Record<string, unknown>
    >;

    for (const [, pathItem] of Object.entries(paths)) {
      const methods = Object.keys(pathItem).filter((k) => validMethods.has(k));
      expect(methods.length).toBeGreaterThan(0);
    }
  });
});
