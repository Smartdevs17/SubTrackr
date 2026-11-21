/**
 * Tests for the developer-portal typed server actions (issue #2061).
 *
 * Covers:
 *  - Happy path for every action
 *  - Validation failures (invalid input → VALIDATION_ERROR with field errors)
 *  - Not-found cases (unknown developer / key / guide / article → NOT_FOUND)
 *  - Domain conflicts (duplicate email → CONFLICT)
 *  - Metrics recording (portalMetrics.snapshot after invocations)
 *
 * Technical scope: developer-portal/actions/
 */

// ── Stub the sandbox service dependency (same as apiDocumentation.test.ts) ──
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

import {
  registerDeveloperAction,
  verifyEmailAction,
  completeOnboardingAction,
  getDeveloperAction,
  updateDeveloperAction,
  createApiKeyAction,
  revokeApiKeyAction,
  getApiKeysAction,
  rotateApiKeyAction,
  getUsageMetricsAction,
  trackUsageAction,
  getDashboardAction,
  getDocumentationAction,
  getDocumentationSectionsAction,
  getArticleAction,
  searchDocumentationAction,
  getIntegrationGuidesAction,
  getIntegrationGuideAction,
} from '../actions';
import { portalMetrics } from '../actions/observability';
import { VALIDATION_ERROR, NOT_FOUND, CONFLICT } from '../actions/result';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function expectOk<T>(result: {
  ok: boolean;
  data?: T;
  error?: unknown;
}): asserts result is { ok: true; data: T } {
  expect(result.ok).toBe(true);
  expect((result as { data: T }).data).toBeDefined();
}

function expectFail(
  result: { ok: boolean; error?: { code: string; message: string } },
  code: string
): void {
  expect(result.ok).toBe(false);
  expect(result.error!.code).toBe(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Developer actions
// ─────────────────────────────────────────────────────────────────────────────

describe('registerDeveloperAction', () => {
  beforeEach(() => portalMetrics.reset());

  it('creates a developer on valid input', async () => {
    const result = await registerDeveloperAction({
      email: 'test@example.com',
      name: 'Alice',
      company: 'Acme',
    });
    expectOk(result);
    expect(result.data.email).toBe('test@example.com');
    expect(result.data.name).toBe('Alice');
    expect(result.data.tier).toBe('free');
  });

  it('returns VALIDATION_ERROR for missing email', async () => {
    const result = await registerDeveloperAction({ name: 'Bob' });
    expectFail(result, VALIDATION_ERROR);
    expect(result.error!.fieldErrors).toBeDefined();
    expect(result.error!.fieldErrors!.some((e) => e.path.includes('email'))).toBe(true);
  });

  it('returns VALIDATION_ERROR for invalid email format', async () => {
    const result = await registerDeveloperAction({
      email: 'not-an-email',
      name: 'Bob',
    });
    expectFail(result, VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing name', async () => {
    const result = await registerDeveloperAction({ email: 'bob@example.com' });
    expectFail(result, VALIDATION_ERROR);
    expect(result.error!.fieldErrors).toBeDefined();
    expect(result.error!.fieldErrors!.some((e) => e.path.includes('name'))).toBe(true);
  });

  it('returns CONFLICT for duplicate email', async () => {
    await registerDeveloperAction({ email: 'dup@example.com', name: 'First' });
    const result = await registerDeveloperAction({
      email: 'dup@example.com',
      name: 'Second',
    });
    expectFail(result, CONFLICT);
  });

  it('records metrics for success and failure', async () => {
    await registerDeveloperAction({ email: 'metrics@example.com', name: 'Test' });
    await registerDeveloperAction({ email: 'bad', name: 'Test' });
    const snap = portalMetrics.snapshot();
    expect(snap['developer.register']).toBeDefined();
    expect(snap['developer.register'].total).toBe(2);
    expect(snap['developer.register'].success).toBe(1);
    expect(snap['developer.register'].failure).toBe(1);
  });
});

describe('verifyEmailAction', () => {
  it('returns NOT_FOUND for unknown developer or bad token', async () => {
    const result = await verifyEmailAction({
      developerId: 'nonexistent',
      token: 'any-token',
    });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing token', async () => {
    const result = await verifyEmailAction({ developerId: 'dev_123' });
    expectFail(result, VALIDATION_ERROR);
  });
});

describe('completeOnboardingAction', () => {
  beforeEach(() => portalMetrics.reset());

  it('completes onboarding for a registered developer', async () => {
    const dev = await registerDeveloperAction({
      email: 'onboard@example.com',
      name: 'Carol',
    });
    expectOk(dev);

    const result = await completeOnboardingAction({ developerId: dev.data.id });
    expectOk(result);
    expect(result.data.onboardingStatus.step).toBe('completed');
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await completeOnboardingAction({ developerId: 'ghost' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty developerId', async () => {
    const result = await completeOnboardingAction({ developerId: '' });
    expectFail(result, VALIDATION_ERROR);
  });
});

describe('getDeveloperAction', () => {
  it('returns the developer for a valid id', async () => {
    const dev = await registerDeveloperAction({
      email: 'getdev@example.com',
      name: 'Dave',
    });
    expectOk(dev);

    const result = await getDeveloperAction({ developerId: dev.data.id });
    expectOk(result);
    expect(result.data.email).toBe('getdev@example.com');
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const result = await getDeveloperAction({ developerId: 'unknown' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing developerId', async () => {
    const result = await getDeveloperAction({});
    expectFail(result, VALIDATION_ERROR);
  });
});

describe('updateDeveloperAction', () => {
  it('updates developer fields', async () => {
    const dev = await registerDeveloperAction({
      email: 'update@example.com',
      name: 'Eve',
    });
    expectOk(dev);

    const result = await updateDeveloperAction({
      developerId: dev.data.id,
      tier: 'pro',
    });
    expectOk(result);
    expect(result.data.tier).toBe('pro');
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await updateDeveloperAction({
      developerId: 'ghost',
      tier: 'pro',
    });
    expectFail(result, NOT_FOUND);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API key actions
// ─────────────────────────────────────────────────────────────────────────────

describe('createApiKeyAction', () => {
  it('creates a key for a registered developer', async () => {
    const dev = await registerDeveloperAction({
      email: 'keycreate@example.com',
      name: 'Frank',
    });
    expectOk(dev);

    const result = await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Test Key',
      type: 'test',
      permissions: ['subscriptions:read'],
    });
    expectOk(result);
    expect(result.data.name).toBe('Test Key');
    expect(result.data.key).toContain('sk_test_');
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await createApiKeyAction({
      developerId: 'ghost',
      name: 'Ghost Key',
      type: 'test',
      permissions: ['subscriptions:read'],
    });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty permissions', async () => {
    const dev = await registerDeveloperAction({
      email: 'noperm@example.com',
      name: 'Grace',
    });
    expectOk(dev);

    const result = await createApiKeyAction({
      developerId: dev.data.id,
      name: 'No Perm Key',
      type: 'test',
      permissions: [],
    });
    expectFail(result, VALIDATION_ERROR);
    expect(result.error!.fieldErrors).toBeDefined();
    expect(result.error!.fieldErrors!.some((e) => e.path.includes('permissions'))).toBe(true);
  });

  it('returns VALIDATION_ERROR for invalid permission value', async () => {
    const dev = await registerDeveloperAction({
      email: 'badperm@example.com',
      name: 'Hank',
    });
    expectOk(dev);

    const result = await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Bad Perm',
      type: 'test',
      permissions: ['invalid:permission'],
    });
    expectFail(result, VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid type', async () => {
    const dev = await registerDeveloperAction({
      email: 'badtype@example.com',
      name: 'Ivan',
    });
    expectOk(dev);

    const result = await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Bad Type',
      type: 'staging',
      permissions: ['subscriptions:read'],
    });
    expectFail(result, VALIDATION_ERROR);
  });
});

describe('revokeApiKeyAction', () => {
  it('revokes an existing key', async () => {
    const dev = await registerDeveloperAction({
      email: 'revoke@example.com',
      name: 'Jade',
    });
    expectOk(dev);

    const key = await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Revoke Me',
      type: 'test',
      permissions: ['subscriptions:read'],
    });
    expectOk(key);

    const result = await revokeApiKeyAction({
      developerId: dev.data.id,
      apiKeyId: key.data.id,
    });
    expectOk(result);
    expect(result.data.revoked).toBe(true);
  });

  it('returns NOT_FOUND for unknown key', async () => {
    const dev = await registerDeveloperAction({
      email: 'revoke2@example.com',
      name: 'Karl',
    });
    expectOk(dev);

    const result = await revokeApiKeyAction({
      developerId: dev.data.id,
      apiKeyId: 'no-such-key',
    });
    expectFail(result, NOT_FOUND);
  });
});

describe('getApiKeysAction', () => {
  it('lists keys for a developer', async () => {
    const dev = await registerDeveloperAction({
      email: 'listkeys@example.com',
      name: 'Liam',
    });
    expectOk(dev);

    await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Key A',
      type: 'test',
      permissions: ['subscriptions:read'],
    });
    await createApiKeyAction({
      developerId: dev.data.id,
      name: 'Key B',
      type: 'test',
      permissions: ['payments:read'],
    });

    const result = await getApiKeysAction({ developerId: dev.data.id });
    expectOk(result);
    expect(result.data.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty array for unknown developer', async () => {
    const result = await getApiKeysAction({ developerId: 'ghost' });
    expectOk(result);
    expect(result.data).toEqual([]);
  });
});

describe('rotateApiKeyAction', () => {
  it('returns NOT_FOUND for unknown key', async () => {
    const result = await rotateApiKeyAction({ apiKeyId: 'nonexistent' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing apiKeyId', async () => {
    const result = await rotateApiKeyAction({});
    expectFail(result, VALIDATION_ERROR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage actions
// ─────────────────────────────────────────────────────────────────────────────

describe('getUsageMetricsAction', () => {
  it('returns metrics for a developer with usage data', async () => {
    const dev = await registerDeveloperAction({
      email: 'usage@example.com',
      name: 'Mia',
    });
    expectOk(dev);

    const result = await getUsageMetricsAction({ developerId: dev.data.id });
    expectOk(result);
    expect(result.data.totalRequests).toBe(0);
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await getUsageMetricsAction({ developerId: 'ghost' });
    expectFail(result, NOT_FOUND);
  });
});

describe('trackUsageAction', () => {
  it('tracks a successful request', async () => {
    const dev = await registerDeveloperAction({
      email: 'track@example.com',
      name: 'Noah',
    });
    expectOk(dev);

    const result = await trackUsageAction({
      developerId: dev.data.id,
      endpoint: '/v1/subscriptions',
      method: 'GET',
      responseTime: 45,
      success: true,
    });
    expectOk(result);
    expect(result.data.tracked).toBe(true);

    // Verify metrics were updated
    const metrics = await getUsageMetricsAction({ developerId: dev.data.id });
    expectOk(metrics);
    expect(metrics.data.totalRequests).toBe(1);
    expect(metrics.data.successfulRequests).toBe(1);
  });

  it('tracks a failed request', async () => {
    const dev = await registerDeveloperAction({
      email: 'track2@example.com',
      name: 'Olivia',
    });
    expectOk(dev);

    await trackUsageAction({
      developerId: dev.data.id,
      endpoint: '/v1/payments',
      method: 'POST',
      responseTime: 100,
      success: false,
    });

    const metrics = await getUsageMetricsAction({ developerId: dev.data.id });
    expectOk(metrics);
    expect(metrics.data.failedRequests).toBe(1);
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await trackUsageAction({
      developerId: 'ghost',
      endpoint: '/v1/subscriptions',
      method: 'GET',
      responseTime: 10,
      success: true,
    });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for negative responseTime', async () => {
    const dev = await registerDeveloperAction({
      email: 'track3@example.com',
      name: 'Paul',
    });
    expectOk(dev);

    const result = await trackUsageAction({
      developerId: dev.data.id,
      endpoint: '/v1/subscriptions',
      method: 'GET',
      responseTime: -1,
      success: true,
    });
    expectFail(result, VALIDATION_ERROR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard actions
// ─────────────────────────────────────────────────────────────────────────────

describe('getDashboardAction', () => {
  it('returns a dashboard for a registered developer', async () => {
    const dev = await registerDeveloperAction({
      email: 'dash@example.com',
      name: 'Quinn',
    });
    expectOk(dev);

    const result = await getDashboardAction({ developerId: dev.data.id });
    expectOk(result);
    expect(result.data.developer.id).toBe(dev.data.id);
    expect(Array.isArray(result.data.sandboxEnvironments)).toBe(true);
    expect(Array.isArray(result.data.recentActivity)).toBe(true);
    expect(Array.isArray(result.data.quickLinks)).toBe(true);
  });

  it('returns NOT_FOUND for unknown developer', async () => {
    const result = await getDashboardAction({ developerId: 'ghost' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing developerId', async () => {
    const result = await getDashboardAction({});
    expectFail(result, VALIDATION_ERROR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Documentation actions
// ─────────────────────────────────────────────────────────────────────────────

describe('getDocumentationAction', () => {
  it('returns documentation entries', async () => {
    const result = await getDocumentationAction({});
    expectOk(result);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('accepts an optional category filter', async () => {
    const result = await getDocumentationAction({ category: 'getting-started' });
    expectOk(result);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe('getDocumentationSectionsAction', () => {
  it('returns at least one section', async () => {
    const result = await getDocumentationSectionsAction();
    expectOk(result);
    expect(result.data.length).toBeGreaterThan(0);
    expect(typeof result.data[0].id).toBe('string');
    expect(typeof result.data[0].title).toBe('string');
    expect(Array.isArray(result.data[0].articles)).toBe(true);
  });
});

describe('getArticleAction', () => {
  it('returns an article by slug', async () => {
    const sections = await getDocumentationSectionsAction();
    expectOk(sections);

    const slug = sections.data[0].articles[0].slug;
    const result = await getArticleAction({ slug });
    expectOk(result);
    expect(result.data.slug).toBe(slug);
  });

  it('returns NOT_FOUND for unknown slug', async () => {
    const result = await getArticleAction({ slug: 'no-such-article' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty slug', async () => {
    const result = await getArticleAction({ slug: '' });
    expectFail(result, VALIDATION_ERROR);
  });
});

describe('searchDocumentationAction', () => {
  it('returns results for a matching query', async () => {
    const result = await searchDocumentationAction({ query: 'quick start' });
    expectOk(result);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('returns an empty array for no matches', async () => {
    const result = await searchDocumentationAction({ query: 'zzz_no_match_xyz_9999' });
    expectOk(result);
    expect(result.data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR for empty query', async () => {
    const result = await searchDocumentationAction({ query: '' });
    expectFail(result, VALIDATION_ERROR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration guide actions
// ─────────────────────────────────────────────────────────────────────────────

describe('getIntegrationGuidesAction', () => {
  it('returns all guides when no platform is specified', async () => {
    const result = await getIntegrationGuidesAction({});
    expectOk(result);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('filters guides by platform', async () => {
    const result = await getIntegrationGuidesAction({ platform: 'react' });
    expectOk(result);
    // React guide should match
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.some((g) => g.title.toLowerCase().includes('react'))).toBe(true);
  });
});

describe('getIntegrationGuideAction', () => {
  it('returns a guide by id', async () => {
    const all = await getIntegrationGuidesAction({});
    expectOk(all);
    const guideId = all.data[0].id;

    const result = await getIntegrationGuideAction({ guideId });
    expectOk(result);
    expect(result.data.id).toBe(guideId);
  });

  it('returns NOT_FOUND for unknown guide', async () => {
    const result = await getIntegrationGuideAction({ guideId: 'nonexistent' });
    expectFail(result, NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty guideId', async () => {
    const result = await getIntegrationGuideAction({ guideId: '' });
    expectFail(result, VALIDATION_ERROR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Observability — metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('portalMetrics', () => {
  beforeEach(() => portalMetrics.reset());

  it('records totals for multiple actions', async () => {
    await registerDeveloperAction({ email: 'metrics1@example.com', name: 'Test' });
    await getDeveloperAction({ developerId: 'ghost' });
    await getIntegrationGuidesAction({});

    const snap = portalMetrics.snapshot();
    expect(snap['developer.register'].total).toBe(1);
    expect(snap['developer.register'].success).toBe(1);
    expect(snap['developer.get'].total).toBe(1);
    expect(snap['developer.get'].failure).toBe(1);
    expect(snap['guides.list'].total).toBe(1);
  });

  it('produces Prometheus-formatted output', async () => {
    await registerDeveloperAction({ email: 'prom@example.com', name: 'Test' });

    const text = portalMetrics.toPrometheus();
    expect(text).toContain('developer_portal_action_total');
    expect(text).toContain('developer_portal_action_success_total');
    expect(text).toContain('developer.register');
  });
});
