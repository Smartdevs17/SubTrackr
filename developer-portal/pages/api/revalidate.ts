import type { NextApiRequest, NextApiResponse } from 'next';

type RevalidateResult = { revalidated: boolean; paths?: string[]; error?: string };

/**
 * POST /api/revalidate
 *
 * Body (JSON):
 *   { "secret": "...", "path": "/docs/quick-start" }          — single path
 *   { "secret": "...", "tag": "v2" }                          — tag-based purge (all paths with that tag)
 *
 * Returns 200 on success, 401 on bad secret, 400 on missing params, 500 on failure.
 *
 * Edge case: if revalidation fails, the stale cached page continues to be served;
 * the error is logged and the endpoint returns 500 so callers can retry on next request.
 */

// Map of tag → paths carrying that tag
const TAG_TO_PATHS: Record<string, string[]> = {
  v1: [
    '/docs/quick-start',
    '/docs/authentication',
    '/docs/subscriptions-api',
    '/docs/payments-api',
    '/docs/webhook-integration',
  ],
  v2: [
    '/docs/quick-start',
    '/docs/authentication',
    '/docs/subscriptions-api',
    '/docs/payments-api',
    '/docs/webhook-integration',
  ],
  api: ['/docs/subscriptions-api', '/docs/payments-api'],
  guides: ['/docs/quick-start', '/docs/authentication', '/docs/webhook-integration'],
  sdks: ['/docs/webhook-integration'],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<RevalidateResult>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ revalidated: false, error: 'Method not allowed' });
  }

  const { secret, path, tag } = req.body as {
    secret?: string;
    path?: string;
    tag?: string;
  };

  // Verify caller secret
  const expectedSecret = process.env.REVALIDATE_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ revalidated: false, error: 'Invalid secret' });
  }

  if (!path && !tag) {
    return res.status(400).json({ revalidated: false, error: 'Provide "path" or "tag"' });
  }

  const pathsToRevalidate: string[] = path ? [path] : (TAG_TO_PATHS[tag as string] ?? []);

  if (pathsToRevalidate.length === 0) {
    return res.status(400).json({ revalidated: false, error: `No paths found for tag "${tag}"` });
  }

  const succeeded: string[] = [];
  const failed: string[] = [];

  // Revalidate each path; on failure log and continue so partial success is still returned
  for (const p of pathsToRevalidate) {
    try {
      await res.revalidate(p);
      succeeded.push(p);
    } catch (err) {
      console.error(`[revalidate] Failed to revalidate ${p}:`, err);
      failed.push(p);
    }
  }

  if (failed.length > 0 && succeeded.length === 0) {
    // All failed — return 500; stale pages will continue to be served
    return res
      .status(500)
      .json({ revalidated: false, error: 'All revalidations failed', paths: failed });
  }

  if (failed.length > 0) {
    // Partial success — log but return 200 with succeeded paths
    console.warn(
      `[revalidate] Partial failure. Succeeded: ${succeeded.join(', ')} | Failed: ${failed.join(', ')}`
    );
  }

  return res.status(200).json({ revalidated: true, paths: succeeded });
}
