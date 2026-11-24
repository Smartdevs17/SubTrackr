/**
 * backend/src/services/__tests__/categorize.test.ts
 *
 * Tests for the subscription category auto-tagger (issue #1989).
 */

import {
  categorize,
  suggestCategory,
  categorizeBulk,
  listCategories,
  isValidCategory,
  type SubscriptionCategory,
  type CategorizationInput,
} from '../categorize';

// ─── categorize (simple wrapper) ─────────────────────────────────────────────

describe('categorize', () => {
  it('returns streaming for Netflix by provider', () => {
    expect(categorize({ name: 'Netflix', provider: 'Netflix' })).toBe('streaming');
  });

  it('returns streaming for Spotify by name when provider is empty', () => {
    expect(categorize({ name: 'Spotify', provider: '' })).toBe('streaming');
  });

  it('returns infrastructure for AWS by provider', () => {
    expect(categorize({ name: 'AWS', provider: 'AWS' })).toBe('infrastructure');
  });

  it('returns productivity for Notion by name', () => {
    expect(categorize({ name: 'Notion' })).toBe('productivity');
  });

  it('returns gaming for Xbox Game Pass', () => {
    expect(categorize({ name: 'Xbox Game Pass', provider: 'Xbox Game Pass' })).toBe('gaming');
  });

  it('returns security for 1Password by provider', () => {
    expect(categorize({ name: 'Password Manager', provider: '1Password' })).toBe('security');
  });

  it('returns education for Coursera', () => {
    expect(categorize({ name: 'Coursera', provider: 'Coursera' })).toBe('education');
  });

  it('returns health for Headspace by provider', () => {
    expect(categorize({ name: 'Mindfulness App', provider: 'Headspace' })).toBe('health');
  });

  it('returns news for New York Times', () => {
    expect(categorize({ name: 'New York Times', provider: 'New York Times' })).toBe('news');
  });

  it('returns communication for Slack', () => {
    expect(categorize({ name: 'Slack', provider: 'Slack' })).toBe('communication');
  });

  it('returns storage for Dropbox', () => {
    expect(categorize({ name: 'Dropbox', provider: 'Dropbox' })).toBe('storage');
  });

  it('returns design for Figma', () => {
    expect(categorize({ name: 'Figma', provider: 'Figma' })).toBe('design');
  });

  it('returns marketing for Mailchimp', () => {
    expect(categorize({ name: 'Mailchimp', provider: 'Mailchimp' })).toBe('marketing');
  });

  it('returns analytics for Mixpanel', () => {
    expect(categorize({ name: 'Mixpanel', provider: 'Mixpanel' })).toBe('analytics');
  });

  it('returns finance for QuickBooks', () => {
    expect(categorize({ name: 'QuickBooks', provider: 'QuickBooks' })).toBe('finance');
  });

  it('returns other for completely unknown input with no default', () => {
    expect(categorize({ name: 'Zxqpwoeiruv' })).toBe('other');
  });

  it('honours custom fallback category', () => {
    expect(categorize({ name: 'Zxqpwoeiruv' }, 'productivity')).toBe('productivity');
  });

  it('is case-insensitive for provider lookup', () => {
    expect(categorize({ name: 'NETFLIX', provider: 'NETFLIX' })).toBe('streaming');
    expect(categorize({ name: 'netflix', provider: 'netflix' })).toBe('streaming');
  });
});

// ─── suggestCategory (full result) ───────────────────────────────────────────

describe('suggestCategory', () => {
  it('returns high confidence for known providers', () => {
    const result = suggestCategory({ name: 'AWS', provider: 'AWS' });
    expect(result.category).toBe('infrastructure');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('AWS');
  });

  it('falls back to keyword match when provider is unknown', () => {
    const result = suggestCategory({
      name: 'SuperStream TV',
      provider: 'UnknownCo',
    });
    expect(result.category).toBe('streaming');
    expect(result.confidence).toBe('medium');
  });

  it('uses description as a signal when name and provider give no match', () => {
    const result = suggestCategory({
      name: 'Monthly Bundle',
      provider: 'AcmeCorp',
      description: 'Unlimited VPN access across all your devices',
    });
    expect(result.category).toBe('security');
  });

  it('returns low confidence and fallback category when nothing matches', () => {
    const result = suggestCategory({ name: 'Foo', provider: 'Bar' });
    expect(result.category).toBe('other');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('fallback');
  });

  it('provider lookup takes priority over keyword match in name', () => {
    // "Adobe Creative Cloud" is a known provider → 'design', not 'streaming'.
    const result = suggestCategory({
      name: 'Adobe Creative Cloud Premium Streaming',
      provider: 'Adobe Creative Cloud',
    });
    expect(result.category).toBe('design');
    expect(result.confidence).toBe('high');
  });

  it('tries name as a provider key when provider field is empty', () => {
    const result = suggestCategory({ name: 'Datadog', provider: '' });
    expect(result.category).toBe('infrastructure');
    expect(result.confidence).toBe('high');
  });

  it('prefix-matches provider names', () => {
    // "Netflix Premium" should match the "netflix" provider entry.
    const result = suggestCategory({ name: 'Subscription', provider: 'Netflix Premium' });
    expect(result.category).toBe('streaming');
  });

  it('matches Google Workspace case-insensitively', () => {
    const result = suggestCategory({ name: 'google workspace', provider: 'google workspace' });
    expect(result.category).toBe('productivity');
  });
});

// ─── categorizeBulk ──────────────────────────────────────────────────────────

describe('categorizeBulk', () => {
  const inputs: CategorizationInput[] = [
    { name: 'Netflix', provider: 'Netflix' },
    { name: 'AWS Plan', provider: 'AWS' },
    { name: 'Unknown Thing', provider: '' },
  ];

  it('returns results in the same order as inputs', () => {
    const results = categorizeBulk(inputs);
    expect(results).toHaveLength(3);
    expect(results[0].category).toBe('streaming');
    expect(results[1].category).toBe('infrastructure');
    expect(results[2].category).toBe('other');
  });

  it('applies a custom fallback to unmatched entries', () => {
    const results = categorizeBulk(inputs, 'productivity');
    expect(results[2].category).toBe('productivity');
  });

  it('handles an empty array', () => {
    expect(categorizeBulk([])).toEqual([]);
  });
});

// ─── listCategories ───────────────────────────────────────────────────────────

describe('listCategories', () => {
  it('returns an array of valid category strings', () => {
    const cats = listCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toContain('streaming');
    expect(cats).toContain('other');
  });

  it('contains no duplicates', () => {
    const cats = listCategories();
    expect(new Set(cats).size).toBe(cats.length);
  });
});

// ─── isValidCategory ──────────────────────────────────────────────────────────

describe('isValidCategory', () => {
  it('returns true for every listed category', () => {
    for (const cat of listCategories()) {
      expect(isValidCategory(cat)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isValidCategory('unknown')).toBe(false);
    expect(isValidCategory('')).toBe(false);
    expect(isValidCategory('STREAMING')).toBe(false);
  });
});

// ─── Keyword heuristic coverage ───────────────────────────────────────────────

describe('keyword heuristics', () => {
  const cases: Array<[string, SubscriptionCategory]> = [
    ['VPN Monthly Access', 'security'],
    ['Online Learning Platform', 'education'],
    ['Fitness & Wellness App', 'health'],
    ['Cloud Hosting Service', 'infrastructure'],
    ['Personal Finance Dashboard', 'finance'],
    ['Cloud Storage Plan', 'infrastructure'], // "cloud" beats "storage"
    ['Email Marketing Tool', 'marketing'],
    ['User Analytics Platform', 'analytics'],
    ['Video Streaming Service', 'streaming'],
    ['Chat and Messaging Pro', 'communication'],
    ['Photo Backup Plan', 'storage'],
    ['Graphic Design Suite', 'design'],
    ['News & Magazines Bundle', 'news'],
    ['Task Management App', 'productivity'],
    ['PC Gaming Subscription', 'gaming'],
  ];

  test.each(cases)('"%s" → %s', (name, expected) => {
    const result = categorize({ name, provider: '' });
    expect(result).toBe(expected);
  });
});
