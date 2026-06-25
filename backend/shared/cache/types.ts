export type CdnProvider = 'fastly' | 'cloudflare';

export interface CdnPurgeConfig {
  provider: CdnProvider;
  apiToken: string;
  /** Fastly service ID or Cloudflare zone ID. */
  serviceId: string;
  /** Optional custom fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
}

export interface CdnPurgeResult {
  success: boolean;
  provider: CdnProvider;
  surrogateKeys: string[];
  statusCode?: number;
  error?: string;
}
