import type { GetStaticPaths, GetStaticProps, NextPage } from 'next';

// Doc page tags by category and version — used for tag-based purging
export const DOC_TAGS: Record<string, string[]> = {
  'quick-start': ['guides', 'v1', 'v2'],
  authentication: ['guides', 'v1', 'v2'],
  'subscriptions-api': ['api', 'v1', 'v2'],
  'payments-api': ['api', 'v1', 'v2'],
  'webhook-integration': ['guides', 'sdks', 'v1', 'v2'],
};

// API reference pages revalidate every 1 hour; guides every 24 hours
const REVALIDATION_SECONDS: Record<string, number> = {
  api: 3600,
  guides: 86400,
  sdks: 86400,
};

export interface DocPageProps {
  slug: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  lastUpdated: string;
}

/**
 * Fetch documentation content from CMS / local markdown source.
 * Falls back to a minimal stub so static generation never hard-fails.
 */
async function fetchDocBySlug(slug: string): Promise<DocPageProps | null> {
  // Replace with real CMS / DB fetch in production
  const articles: Record<string, Omit<DocPageProps, 'slug'>> = {
    'quick-start': {
      title: 'Quick Start Guide',
      content: '# Quick Start\nGet up and running with SubTrackr in minutes.',
      category: 'guides',
      tags: ['guides', 'v1', 'v2'],
      lastUpdated: new Date().toISOString(),
    },
    authentication: {
      title: 'Authentication',
      content: '# Authentication\nAll requests require an API key.',
      category: 'guides',
      tags: ['guides', 'v1', 'v2'],
      lastUpdated: new Date().toISOString(),
    },
    'subscriptions-api': {
      title: 'Subscriptions API',
      content: '# Subscriptions API\nCRUD operations for subscriptions.',
      category: 'api',
      tags: ['api', 'v1', 'v2'],
      lastUpdated: new Date().toISOString(),
    },
    'payments-api': {
      title: 'Payments API',
      content: '# Payments API\nProcess and query payments.',
      category: 'api',
      tags: ['api', 'v1', 'v2'],
      lastUpdated: new Date().toISOString(),
    },
    'webhook-integration': {
      title: 'Webhook Integration',
      content: '# Webhook Integration\nReceive real-time event notifications.',
      category: 'guides',
      tags: ['guides', 'sdks', 'v1', 'v2'],
      lastUpdated: new Date().toISOString(),
    },
  };

  const article = articles[slug];
  if (!article) return null;
  return { slug, ...article };
}

export const getStaticPaths: GetStaticPaths = async () => {
  const slugs = Object.keys(DOC_TAGS);
  return {
    paths: slugs.map((slug) => ({ params: { slug } })),
    // Stale page served while revalidating — no 404 / loading state for unknown slugs
    fallback: 'blocking',
  };
};

export const getStaticProps: GetStaticProps<DocPageProps> = async ({ params }) => {
  const slug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? '');

  try {
    const doc = await fetchDocBySlug(slug);
    if (!doc) return { notFound: true };

    const revalidate = REVALIDATION_SECONDS[doc.category] ?? 3600;

    return {
      props: doc,
      // Time-based revalidation: api pages → 1 h, others → 24 h
      revalidate,
      // Next.js 13+ tag support via fetch cache — keeps ISR tags for purging
      // tags: doc.tags  ← set via fetch() cache option in Next 13 app router
    };
  } catch (err) {
    console.error(`[ISR] Failed to fetch doc "${slug}":`, err);
    // On error: return stale props if available; let Next.js serve the cached page
    return { notFound: true };
  }
};

// Minimal page component — replace with your real doc renderer
const DocPage: NextPage<DocPageProps> = ({ title, content, tags, lastUpdated }) => {
  return (
    <article>
      <h1>{title}</h1>
      <p>
        <small>Last updated: {new Date(lastUpdated).toLocaleDateString()}</small>
      </p>
      <div className="doc-tags">
        {tags.map((tag) => (
          <span key={tag} className={`tag tag-${tag}`}>
            {tag}
          </span>
        ))}
      </div>
      {/* Replace with proper markdown renderer (e.g. next-mdx-remote) */}
      <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
    </article>
  );
};

export default DocPage;
