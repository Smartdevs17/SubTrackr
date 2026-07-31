/**
 * CDN purge API client for Fastly and Cloudflare edge caches.
 *
 * Purges cached responses by surrogate key (Fastly) or cache tag (Cloudflare).
 * On API failure the error is logged and the caller continues — TTL expiry
 * eventually clears stale content at the edge.
 */

import { logger } from '../../services/shared/logging';
import type { CdnProvider, CdnPurgeConfig, CdnPurgeResult } from './types';

const FASTLY_API_BASE = 'https://api.fastly.com';
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export class CdnPurgeClient {
  private readonly config: CdnPurgeConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CdnPurgeConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get provider(): CdnProvider {
    return this.config.provider;
  }

  /**
   * Purge all cached objects tagged with any of the given surrogate keys.
   * Never throws — failures are logged and returned in the result.
   */
  async purgeBySurrogateKeys(keys: string[]): Promise<CdnPurgeResult> {
    const surrogateKeys = [...new Set(keys.filter(Boolean))];

    if (surrogateKeys.length === 0) {
      return { success: true, provider: this.config.provider, surrogateKeys: [] };
    }

    try {
      if (this.config.provider === 'fastly') {
        return await this.purgeFastly(surrogateKeys);
      }
      return await this.purgeCloudflare(surrogateKeys);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('CDN purge request failed', {
        provider: this.config.provider,
        surrogateKeys,
        error: message,
      });
      return {
        success: false,
        provider: this.config.provider,
        surrogateKeys,
        error: message,
      };
    }
  }

  private async purgeFastly(surrogateKeys: string[]): Promise<CdnPurgeResult> {
    const url = `${FASTLY_API_BASE}/service/${this.config.serviceId}/purge`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Fastly-Key': this.config.apiToken,
        'Surrogate-Key': surrogateKeys.join(' '),
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      const error = `Fastly purge failed (${response.status}): ${body}`;
      logger.error('CDN purge API call failed', {
        provider: 'fastly',
        statusCode: response.status,
        surrogateKeys,
        error,
      });
      return {
        success: false,
        provider: 'fastly',
        surrogateKeys,
        statusCode: response.status,
        error,
      };
    }

    logger.info('CDN purge succeeded', { provider: 'fastly', surrogateKeys });
    return { success: true, provider: 'fastly', surrogateKeys, statusCode: response.status };
  }

  private async purgeCloudflare(surrogateKeys: string[]): Promise<CdnPurgeResult> {
    const url = `${CLOUDFLARE_API_BASE}/zones/${this.config.serviceId}/purge_cache`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags: surrogateKeys }),
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      const error = `Cloudflare purge failed (${response.status}): ${body}`;
      logger.error('CDN purge API call failed', {
        provider: 'cloudflare',
        statusCode: response.status,
        surrogateKeys,
        error,
      });
      return {
        success: false,
        provider: 'cloudflare',
        surrogateKeys,
        statusCode: response.status,
        error,
      };
    }

    logger.info('CDN purge succeeded', { provider: 'cloudflare', surrogateKeys });
    return { success: true, provider: 'cloudflare', surrogateKeys, statusCode: response.status };
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable>';
  }
}

/** No-op client used when CDN credentials are not configured. */
export class NoOpCdnPurgeClient extends CdnPurgeClient {
  constructor() {
    super({ provider: 'fastly', apiToken: '', serviceId: '' });
  }

  async purgeBySurrogateKeys(keys: string[]): Promise<CdnPurgeResult> {
    const surrogateKeys = [...new Set(keys.filter(Boolean))];
    if (surrogateKeys.length > 0) {
      logger.warn('CDN purge skipped — CDN_API_TOKEN or CDN_SERVICE_ID not configured', {
        surrogateKeys,
      });
    }
    return { success: true, provider: 'fastly', surrogateKeys };
  }
}

let _defaultClient: CdnPurgeClient | null = null;

/**
 * Build a purge client from environment variables.
 *
 *   CDN_PROVIDER=fastly|cloudflare
 *   CDN_API_TOKEN=<token>
 *   CDN_SERVICE_ID=<fastly service id or cloudflare zone id>
 */
export function createCdnPurgeClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): CdnPurgeClient {
  const provider = (env.CDN_PROVIDER ?? 'fastly') as CdnProvider;
  const apiToken = env.CDN_API_TOKEN ?? '';
  const serviceId = env.CDN_SERVICE_ID ?? '';

  if (!apiToken || !serviceId) {
    return new NoOpCdnPurgeClient();
  }

  return new CdnPurgeClient({ provider, apiToken, serviceId });
}

/** Singleton purge client (lazy-initialized from env). */
export function getCdnPurgeClient(): CdnPurgeClient {
  if (!_defaultClient) {
    _defaultClient = createCdnPurgeClientFromEnv();
  }
  return _defaultClient;
}

/** Reset singleton — for tests only. */
export function resetCdnPurgeClient(): void {
  _defaultClient = null;
}

/** Convenience helper: purge keys and swallow errors (TTL fallback). */
export async function purgeSurrogateKeys(
  keys: string[],
  client: CdnPurgeClient = getCdnPurgeClient(),
): Promise<CdnPurgeResult> {
  return client.purgeBySurrogateKeys(keys);
}
