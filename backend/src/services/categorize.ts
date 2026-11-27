/**
 * backend/src/services/categorize.ts
 *
 * Issue #1989 — Subscription category auto-tagger with provider heuristics.
 *
 * Assigns a canonical SubscriptionCategory to a subscription based on:
 *   1. An exact provider-name lookup (highest confidence).
 *   2. Keyword matching against the subscription name and provider fields.
 *   3. A configurable fallback category.
 *
 * All matching is case-insensitive. The module is pure (no I/O) so it can
 * be exercised without a database or network.
 *
 * Usage:
 *   import { categorize, suggestCategory } from './categorize';
 *
 *   const category = categorize({ name: 'Netflix', provider: 'Netflix' });
 *   // => 'streaming'
 *
 *   const { category, confidence } = suggestCategory({ name: 'AWS', provider: '' });
 *   // => { category: 'infrastructure', confidence: 'high' }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionCategory =
  | 'streaming'
  | 'productivity'
  | 'infrastructure'
  | 'gaming'
  | 'finance'
  | 'health'
  | 'education'
  | 'news'
  | 'security'
  | 'communication'
  | 'storage'
  | 'design'
  | 'marketing'
  | 'analytics'
  | 'other';

export type CategoryConfidence = 'high' | 'medium' | 'low';

export interface CategorizationInput {
  /** Display name of the subscription (e.g. "Netflix Premium"). */
  name: string;
  /** Provider / vendor name if known (e.g. "Netflix"). */
  provider?: string;
  /** Free-text description — used as a fallback signal. */
  description?: string;
}

export interface CategorizationResult {
  category: SubscriptionCategory;
  confidence: CategoryConfidence;
  /** Human-readable explanation of why this category was chosen. */
  reason: string;
}

// ─── Provider lookup table ────────────────────────────────────────────────────
//
// Keys are lowercased provider/brand names. Values are the category and the
// confidence level. Add new entries here as new providers are onboarded.

type ProviderEntry = { category: SubscriptionCategory; confidence: CategoryConfidence };

const PROVIDER_MAP: Record<string, ProviderEntry> = {
  // Streaming
  netflix: { category: 'streaming', confidence: 'high' },
  'disney+': { category: 'streaming', confidence: 'high' },
  'disney plus': { category: 'streaming', confidence: 'high' },
  hulu: { category: 'streaming', confidence: 'high' },
  'amazon prime': { category: 'streaming', confidence: 'high' },
  'amazon prime video': { category: 'streaming', confidence: 'high' },
  'apple tv+': { category: 'streaming', confidence: 'high' },
  'apple tv plus': { category: 'streaming', confidence: 'high' },
  hbo: { category: 'streaming', confidence: 'high' },
  'hbo max': { category: 'streaming', confidence: 'high' },
  max: { category: 'streaming', confidence: 'high' },
  peacock: { category: 'streaming', confidence: 'high' },
  paramount: { category: 'streaming', confidence: 'high' },
  'paramount+': { category: 'streaming', confidence: 'high' },
  'discovery+': { category: 'streaming', confidence: 'high' },
  crunchyroll: { category: 'streaming', confidence: 'high' },
  funimation: { category: 'streaming', confidence: 'high' },
  mubi: { category: 'streaming', confidence: 'high' },
  tidal: { category: 'streaming', confidence: 'high' },
  spotify: { category: 'streaming', confidence: 'high' },
  'apple music': { category: 'streaming', confidence: 'high' },
  'youtube premium': { category: 'streaming', confidence: 'high' },
  deezer: { category: 'streaming', confidence: 'high' },
  'amazon music': { category: 'streaming', confidence: 'high' },
  pandora: { category: 'streaming', confidence: 'high' },

  // Productivity
  microsoft: { category: 'productivity', confidence: 'high' },
  'microsoft 365': { category: 'productivity', confidence: 'high' },
  'office 365': { category: 'productivity', confidence: 'high' },
  'google workspace': { category: 'productivity', confidence: 'high' },
  'g suite': { category: 'productivity', confidence: 'high' },
  notion: { category: 'productivity', confidence: 'high' },
  asana: { category: 'productivity', confidence: 'high' },
  jira: { category: 'productivity', confidence: 'high' },
  confluence: { category: 'productivity', confidence: 'high' },
  atlassian: { category: 'productivity', confidence: 'high' },
  monday: { category: 'productivity', confidence: 'high' },
  'monday.com': { category: 'productivity', confidence: 'high' },
  trello: { category: 'productivity', confidence: 'high' },
  basecamp: { category: 'productivity', confidence: 'high' },
  clickup: { category: 'productivity', confidence: 'high' },
  linear: { category: 'productivity', confidence: 'high' },
  todoist: { category: 'productivity', confidence: 'high' },
  evernote: { category: 'productivity', confidence: 'high' },
  'bear notes': { category: 'productivity', confidence: 'high' },
  obsidian: { category: 'productivity', confidence: 'high' },
  zapier: { category: 'productivity', confidence: 'high' },
  'make.com': { category: 'productivity', confidence: 'high' },
  integromat: { category: 'productivity', confidence: 'high' },
  airtable: { category: 'productivity', confidence: 'high' },
  coda: { category: 'productivity', confidence: 'high' },

  // Infrastructure / Cloud
  aws: { category: 'infrastructure', confidence: 'high' },
  'amazon web services': { category: 'infrastructure', confidence: 'high' },
  gcp: { category: 'infrastructure', confidence: 'high' },
  'google cloud': { category: 'infrastructure', confidence: 'high' },
  azure: { category: 'infrastructure', confidence: 'high' },
  'microsoft azure': { category: 'infrastructure', confidence: 'high' },
  digitalocean: { category: 'infrastructure', confidence: 'high' },
  linode: { category: 'infrastructure', confidence: 'high' },
  akamai: { category: 'infrastructure', confidence: 'high' },
  heroku: { category: 'infrastructure', confidence: 'high' },
  vercel: { category: 'infrastructure', confidence: 'high' },
  netlify: { category: 'infrastructure', confidence: 'high' },
  cloudflare: { category: 'infrastructure', confidence: 'high' },
  fastly: { category: 'infrastructure', confidence: 'high' },
  'new relic': { category: 'infrastructure', confidence: 'high' },
  datadog: { category: 'infrastructure', confidence: 'high' },
  pagerduty: { category: 'infrastructure', confidence: 'high' },
  sentry: { category: 'infrastructure', confidence: 'high' },
  supabase: { category: 'infrastructure', confidence: 'high' },
  firebase: { category: 'infrastructure', confidence: 'high' },
  mongodb: { category: 'infrastructure', confidence: 'high' },
  'mongodb atlas': { category: 'infrastructure', confidence: 'high' },
  planetscale: { category: 'infrastructure', confidence: 'high' },
  neon: { category: 'infrastructure', confidence: 'high' },
  railway: { category: 'infrastructure', confidence: 'high' },
  fly: { category: 'infrastructure', confidence: 'high' },
  'fly.io': { category: 'infrastructure', confidence: 'high' },
  render: { category: 'infrastructure', confidence: 'high' },

  // Gaming
  'xbox game pass': { category: 'gaming', confidence: 'high' },
  'xbox ultimate': { category: 'gaming', confidence: 'high' },
  'playstation plus': { category: 'gaming', confidence: 'high' },
  'ps plus': { category: 'gaming', confidence: 'high' },
  'playstation now': { category: 'gaming', confidence: 'high' },
  'ea play': { category: 'gaming', confidence: 'high' },
  'ea access': { category: 'gaming', confidence: 'high' },
  'nintendo switch online': { category: 'gaming', confidence: 'high' },
  steam: { category: 'gaming', confidence: 'high' },
  'humble bundle': { category: 'gaming', confidence: 'high' },
  'humble monthly': { category: 'gaming', confidence: 'high' },
  gog: { category: 'gaming', confidence: 'high' },
  'twitch prime': { category: 'gaming', confidence: 'high' },
  ubisoft: { category: 'gaming', confidence: 'high' },
  'ubisoft connect': { category: 'gaming', confidence: 'high' },
  'ubisoft plus': { category: 'gaming', confidence: 'high' },
  'apple arcade': { category: 'gaming', confidence: 'high' },
  'google play pass': { category: 'gaming', confidence: 'high' },

  // Finance
  quickbooks: { category: 'finance', confidence: 'high' },
  xero: { category: 'finance', confidence: 'high' },
  'fresh books': { category: 'finance', confidence: 'high' },
  freshbooks: { category: 'finance', confidence: 'high' },
  'wave accounting': { category: 'finance', confidence: 'high' },
  expensify: { category: 'finance', confidence: 'high' },
  mint: { category: 'finance', confidence: 'high' },
  ynab: { category: 'finance', confidence: 'high' },
  'you need a budget': { category: 'finance', confidence: 'high' },
  plaid: { category: 'finance', confidence: 'high' },
  robinhood: { category: 'finance', confidence: 'high' },
  coinbase: { category: 'finance', confidence: 'high' },
  stripe: { category: 'finance', confidence: 'high' },
  paypal: { category: 'finance', confidence: 'high' },

  // Health & Fitness
  peloton: { category: 'health', confidence: 'high' },
  'apple fitness+': { category: 'health', confidence: 'high' },
  noom: { category: 'health', confidence: 'high' },
  headspace: { category: 'health', confidence: 'high' },
  calm: { category: 'health', confidence: 'high' },
  'my fitness pal': { category: 'health', confidence: 'high' },
  myfitnesspal: { category: 'health', confidence: 'high' },
  'whoop': { category: 'health', confidence: 'high' },
  strava: { category: 'health', confidence: 'high' },
  'eight sleep': { category: 'health', confidence: 'high' },
  teladoc: { category: 'health', confidence: 'high' },
  hims: { category: 'health', confidence: 'high' },
  hers: { category: 'health', confidence: 'high' },

  // Education
  coursera: { category: 'education', confidence: 'high' },
  udemy: { category: 'education', confidence: 'high' },
  udacity: { category: 'education', confidence: 'high' },
  'linkedin learning': { category: 'education', confidence: 'high' },
  pluralsight: { category: 'education', confidence: 'high' },
  skillshare: { category: 'education', confidence: 'high' },
  duolingo: { category: 'education', confidence: 'high' },
  babbel: { category: 'education', confidence: 'high' },
  rosetta: { category: 'education', confidence: 'high' },
  'rosetta stone': { category: 'education', confidence: 'high' },
  masterclass: { category: 'education', confidence: 'high' },
  'khan academy': { category: 'education', confidence: 'high' },
  brilliant: { category: 'education', confidence: 'high' },
  codecademy: { category: 'education', confidence: 'high' },
  egghead: { category: 'education', confidence: 'high' },
  frontendmasters: { category: 'education', confidence: 'high' },
  'frontend masters': { category: 'education', confidence: 'high' },
  laracasts: { category: 'education', confidence: 'high' },
  leveluptuts: { category: 'education', confidence: 'high' },
  scrimba: { category: 'education', confidence: 'high' },

  // News & Reading
  'new york times': { category: 'news', confidence: 'high' },
  nyt: { category: 'news', confidence: 'high' },
  'washington post': { category: 'news', confidence: 'high' },
  'wall street journal': { category: 'news', confidence: 'high' },
  wsj: { category: 'news', confidence: 'high' },
  bloomberg: { category: 'news', confidence: 'high' },
  economist: { category: 'news', confidence: 'high' },
  'the economist': { category: 'news', confidence: 'high' },
  medium: { category: 'news', confidence: 'high' },
  substack: { category: 'news', confidence: 'high' },
  apple: { category: 'news', confidence: 'low' }, // too generic without context
  'apple news+': { category: 'news', confidence: 'high' },
  kindle: { category: 'news', confidence: 'high' },
  scribd: { category: 'news', confidence: 'high' },
  audible: { category: 'news', confidence: 'high' },

  // Security
  '1password': { category: 'security', confidence: 'high' },
  lastpass: { category: 'security', confidence: 'high' },
  dashlane: { category: 'security', confidence: 'high' },
  bitwarden: { category: 'security', confidence: 'high' },
  nordvpn: { category: 'security', confidence: 'high' },
  expressvpn: { category: 'security', confidence: 'high' },
  surfshark: { category: 'security', confidence: 'high' },
  protonvpn: { category: 'security', confidence: 'high' },
  mullvad: { category: 'security', confidence: 'high' },
  'malwarebytes': { category: 'security', confidence: 'high' },
  norton: { category: 'security', confidence: 'high' },
  'norton 360': { category: 'security', confidence: 'high' },
  mcafee: { category: 'security', confidence: 'high' },
  bitdefender: { category: 'security', confidence: 'high' },
  crowdstrike: { category: 'security', confidence: 'high' },
  okta: { category: 'security', confidence: 'high' },
  authy: { category: 'security', confidence: 'high' },

  // Communication
  slack: { category: 'communication', confidence: 'high' },
  zoom: { category: 'communication', confidence: 'high' },
  'google meet': { category: 'communication', confidence: 'high' },
  'microsoft teams': { category: 'communication', confidence: 'high' },
  discord: { category: 'communication', confidence: 'high' },
  intercom: { category: 'communication', confidence: 'high' },
  zendesk: { category: 'communication', confidence: 'high' },
  freshdesk: { category: 'communication', confidence: 'high' },
  hubspot: { category: 'communication', confidence: 'high' },
  mailchimp: { category: 'communication', confidence: 'high' },
  sendgrid: { category: 'communication', confidence: 'high' },
  twilio: { category: 'communication', confidence: 'high' },
  vonage: { category: 'communication', confidence: 'high' },
  ringcentral: { category: 'communication', confidence: 'high' },
  loom: { category: 'communication', confidence: 'high' },
  typeform: { category: 'communication', confidence: 'high' },
  calendly: { category: 'communication', confidence: 'high' },

  // Storage
  dropbox: { category: 'storage', confidence: 'high' },
  'google one': { category: 'storage', confidence: 'high' },
  'icloud+': { category: 'storage', confidence: 'high' },
  icloud: { category: 'storage', confidence: 'high' },
  'onedrive': { category: 'storage', confidence: 'high' },
  box: { category: 'storage', confidence: 'high' },
  backblaze: { category: 'storage', confidence: 'high' },
  pcloud: { category: 'storage', confidence: 'high' },
  'sync.com': { category: 'storage', confidence: 'high' },
  'amazon drive': { category: 'storage', confidence: 'high' },

  // Design
  figma: { category: 'design', confidence: 'high' },
  sketch: { category: 'design', confidence: 'high' },
  'adobe creative cloud': { category: 'design', confidence: 'high' },
  'adobe cc': { category: 'design', confidence: 'high' },
  adobe: { category: 'design', confidence: 'high' },
  canva: { category: 'design', confidence: 'high' },
  invision: { category: 'design', confidence: 'high' },
  'abstract.com': { category: 'design', confidence: 'high' },
  zeplin: { category: 'design', confidence: 'high' },
  miro: { category: 'design', confidence: 'high' },
  lucidchart: { category: 'design', confidence: 'high' },
  'whimsical': { category: 'design', confidence: 'high' },
  framer: { category: 'design', confidence: 'high' },
  webflow: { category: 'design', confidence: 'high' },

  // Marketing
  'google ads': { category: 'marketing', confidence: 'high' },
  'facebook ads': { category: 'marketing', confidence: 'high' },
  semrush: { category: 'marketing', confidence: 'high' },
  ahrefs: { category: 'marketing', confidence: 'high' },
  moz: { category: 'marketing', confidence: 'high' },
  hootsuite: { category: 'marketing', confidence: 'high' },
  buffer: { category: 'marketing', confidence: 'high' },
  sproutsocial: { category: 'marketing', confidence: 'high' },
  'sprout social': { category: 'marketing', confidence: 'high' },
  'active campaign': { category: 'marketing', confidence: 'high' },
  activecampaign: { category: 'marketing', confidence: 'high' },
  klaviyo: { category: 'marketing', confidence: 'high' },
  'constant contact': { category: 'marketing', confidence: 'high' },
  salesforce: { category: 'marketing', confidence: 'high' },

  // Analytics
  'google analytics': { category: 'analytics', confidence: 'high' },
  mixpanel: { category: 'analytics', confidence: 'high' },
  amplitude: { category: 'analytics', confidence: 'high' },
  segment: { category: 'analytics', confidence: 'high' },
  heap: { category: 'analytics', confidence: 'high' },
  hotjar: { category: 'analytics', confidence: 'high' },
  fullstory: { category: 'analytics', confidence: 'high' },
  chartmogul: { category: 'analytics', confidence: 'high' },
  baremetrics: { category: 'analytics', confidence: 'high' },
  profitwell: { category: 'analytics', confidence: 'high' },
  tableau: { category: 'analytics', confidence: 'high' },
  looker: { category: 'analytics', confidence: 'high' },
  metabase: { category: 'analytics', confidence: 'high' },
  posthog: { category: 'analytics', confidence: 'high' },
};

// ─── Keyword heuristics ───────────────────────────────────────────────────────
//
// Each entry maps a category to a list of keyword fragments. Matching is
// substring-based so "cloud storage" matches both "cloud" → infrastructure
// and "storage" → storage. The first keyword hit wins (order matters).

interface KeywordRule {
  keywords: string[];
  category: SubscriptionCategory;
  confidence: CategoryConfidence;
}

const KEYWORD_RULES: KeywordRule[] = [
  // Infrastructure signals are very specific — check early.
  {
    keywords: ['cloud', 'server', 'hosting', 'vps', 'cdn', 'api', 'devops', 'ci/cd', 'pipeline', 'kubernetes', 'docker', 'container'],
    category: 'infrastructure',
    confidence: 'medium',
  },
  // Streaming / media
  {
    keywords: ['streaming', 'video', 'movies', 'music', 'podcast', 'audio', 'tv', 'watch', 'listen', 'channel'],
    category: 'streaming',
    confidence: 'medium',
  },
  // Gaming
  {
    keywords: ['game', 'gaming', 'games', 'play', 'esports', 'controller'],
    category: 'gaming',
    confidence: 'medium',
  },
  // Security
  {
    keywords: ['vpn', 'password', 'security', 'antivirus', 'firewall', 'threat', 'encryption', 'vault'],
    category: 'security',
    confidence: 'medium',
  },
  // Education
  {
    keywords: ['learn', 'course', 'tutorial', 'training', 'education', 'university', 'academy', 'school', 'study', 'lesson'],
    category: 'education',
    confidence: 'medium',
  },
  // Health
  {
    keywords: ['health', 'fitness', 'gym', 'wellness', 'meditation', 'workout', 'diet', 'nutrition', 'therapy', 'mental'],
    category: 'health',
    confidence: 'medium',
  },
  // Finance
  {
    keywords: ['accounting', 'invoice', 'billing', 'payroll', 'finance', 'budget', 'expense', 'tax', 'trading', 'investment', 'bookkeeping'],
    category: 'finance',
    confidence: 'medium',
  },
  // Storage
  {
    keywords: ['storage', 'backup', 'cloud drive', 'file sync', 'photos'],
    category: 'storage',
    confidence: 'medium',
  },
  // Design
  {
    keywords: ['design', 'creative', 'illustration', 'photo edit', 'prototype', 'wireframe', 'ux', 'ui', 'graphic'],
    category: 'design',
    confidence: 'medium',
  },
  // Marketing
  {
    keywords: ['marketing', 'seo', 'email campaign', 'crm', 'advertising', 'social media', 'analytics campaign'],
    category: 'marketing',
    confidence: 'medium',
  },
  // Analytics
  {
    keywords: ['analytics', 'metrics', 'dashboard', 'tracking', 'reporting', 'insights', 'data'],
    category: 'analytics',
    confidence: 'low',
  },
  // Communication
  {
    keywords: ['chat', 'messaging', 'email', 'communication', 'meeting', 'conference', 'video call', 'support', 'helpdesk'],
    category: 'communication',
    confidence: 'medium',
  },
  // Productivity (broad — keep near the bottom)
  {
    keywords: ['productivity', 'task', 'project', 'workflow', 'automation', 'notes', 'docs', 'document', 'spreadsheet', 'calendar', 'schedule'],
    category: 'productivity',
    confidence: 'medium',
  },
  // News / reading
  {
    keywords: ['news', 'newspaper', 'magazine', 'read', 'ebook', 'newsletter', 'journal', 'article'],
    category: 'news',
    confidence: 'medium',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/** Check the provider map for an exact or prefix match. */
function lookupProvider(input: string): ProviderEntry | undefined {
  const key = normalize(input);
  if (PROVIDER_MAP[key]) return PROVIDER_MAP[key];

  // Try prefix match (e.g. "Netflix Premium" → "netflix").
  for (const [providerKey, entry] of Object.entries(PROVIDER_MAP)) {
    if (key.startsWith(providerKey) || providerKey.startsWith(key)) {
      return entry;
    }
  }

  return undefined;
}

/** Run keyword rules against the combined text corpus. */
function matchKeywords(corpus: string): KeywordRule | undefined {
  const lower = normalize(corpus);
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule;
      }
    }
  }
  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best-guess {@link SubscriptionCategory} for the given input.
 *
 * This is the simple "just give me a category" wrapper. Use
 * {@link suggestCategory} when you also need confidence and provenance.
 */
export function categorize(
  input: CategorizationInput,
  fallback: SubscriptionCategory = 'other'
): SubscriptionCategory {
  return suggestCategory(input, fallback).category;
}

/**
 * Returns a {@link CategorizationResult} with category, confidence, and a
 * human-readable reason explaining why that category was chosen.
 *
 * Resolution order:
 *   1. Exact / prefix provider lookup (confidence preserved from map).
 *   2. Keyword scan over name + provider + description.
 *   3. Fallback category at 'low' confidence.
 */
export function suggestCategory(
  input: CategorizationInput,
  fallback: SubscriptionCategory = 'other'
): CategorizationResult {
  const { name, provider = '', description = '' } = input;

  // 1. Provider lookup — most reliable signal.
  if (provider) {
    const hit = lookupProvider(provider);
    if (hit) {
      return {
        category: hit.category,
        confidence: hit.confidence,
        reason: `Matched known provider "${provider}"`,
      };
    }
  }

  // Also try the subscription name as a provider key.
  if (name) {
    const hit = lookupProvider(name);
    if (hit) {
      return {
        category: hit.category,
        confidence: hit.confidence,
        reason: `Matched known provider name "${name}"`,
      };
    }
  }

  // 2. Keyword heuristics across the full corpus.
  const corpus = [name, provider, description].filter(Boolean).join(' ');
  const rule = matchKeywords(corpus);
  if (rule) {
    return {
      category: rule.category,
      confidence: rule.confidence,
      reason: `Keyword match in subscription text (category: ${rule.category})`,
    };
  }

  // 3. Fallback.
  return {
    category: fallback,
    confidence: 'low',
    reason: 'No provider or keyword match found; using fallback category',
  };
}

/**
 * Categorizes a list of subscriptions in bulk. Returns an array in the same
 * order as the input.
 */
export function categorizeBulk(
  inputs: CategorizationInput[],
  fallback: SubscriptionCategory = 'other'
): CategorizationResult[] {
  return inputs.map((input) => suggestCategory(input, fallback));
}

/**
 * Returns the full list of supported categories, useful for building UI
 * filter menus or validating user-supplied category values.
 */
export function listCategories(): SubscriptionCategory[] {
  return [
    'streaming',
    'productivity',
    'infrastructure',
    'gaming',
    'finance',
    'health',
    'education',
    'news',
    'security',
    'communication',
    'storage',
    'design',
    'marketing',
    'analytics',
    'other',
  ];
}

/**
 * Checks whether a string is a valid {@link SubscriptionCategory}.
 */
export function isValidCategory(value: string): value is SubscriptionCategory {
  return (listCategories() as string[]).includes(value);
}
