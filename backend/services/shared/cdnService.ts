/**
 * CDN Integration with Edge Caching — SubTrackr
 *
 * Provides CDN cache management, purge capabilities,
 * and edge caching configuration for static assets.
 */

export interface CdnConfig {
  provider: 'fastly' | 'cloudflare' | 'custom';
  baseUrl: string;
  apiKey: string;
  zoneId?: string;
  defaultTtl: number;
  staleTtl: number;
  edgeLocations: string[];
}

export interface CacheEntry {
  url: string;
  status: 'cached' | 'miss' | 'stale' | 'expired';
  ttl: number;
  age: number;
  edgeLocation: string;
  lastModified: string;
  etag: string;
  contentLength: number;
}

export interface PurgeRequest {
  urls: string[];
  tags: string[];
  everything: boolean;
}

export interface PurgeResult {
  success: boolean;
  purgedCount: number;
  errors: string[];
  completedAt: string;
}

export interface CdnMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  bandwidthSaved: number;
  purgeCount: number;
  averageTtfb: number;
  edgeLocations: Record<string, number>;
}

const DEFAULT_CDN_CONFIG: CdnConfig = {
  provider: 'fastly',
  baseUrl: 'https://cdn.subtrackr.app',
  apiKey: process.env['CDN_API_KEY'] ?? '',
  defaultTtl: 86400,
  staleTtl: 604800,
  edgeLocations: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
};

export class CdnService {
  private config: CdnConfig;
  private cacheEntries = new Map<string, CacheEntry>();
  private metrics: CdnMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
    bandwidthSaved: 0,
    purgeCount: 0,
    averageTtfb: 0,
    edgeLocations: {},
  };

  private ttfbSamples: number[] = [];

  constructor(config: Partial<CdnConfig> = {}) {
    this.config = { ...DEFAULT_CDN_CONFIG, ...config };
  }

  getCacheHeaders(url: string, contentLength: number): Record<string, string> {
    const headers: Record<string, string> = {};

    headers['Cache-Control'] = `public, max-age=${this.config.defaultTtl}, stale-while-revalidate=${this.config.staleTtl}`;
    headers['CDN-Cache-Control'] = `max-age=${this.config.defaultTtl}`;
    headers['Vary'] = 'Accept-Encoding, Accept';

    if (url.match(/\.(js|css|woff2?|ttf|eot|otf)$/)) {
      headers['Cache-Control'] = `public, max-age=${365 * 24 * 3600}, immutable`;
    } else if (url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
      headers['Cache-Control'] = `public, max-age=${7 * 24 * 3600}`;
    } else if (url.match(/\.(json|xml)$/)) {
      headers['Cache-Control'] = `public, max-age=${300}, stale-while-revalidate=${600}`;
    }

    return headers;
  }

  async purge(request: PurgeRequest): Promise<PurgeResult> {
    const result: PurgeResult = {
      success: true,
      purgedCount: 0,
      errors: [],
      completedAt: new Date().toISOString(),
    };

    for (const url of request.urls) {
      this.cacheEntries.delete(url);
      result.purgedCount++;
    }

    if (request.everything) {
      this.cacheEntries.clear();
      result.purgedCount = this.cacheEntries.size;
    }

    this.metrics.purgeCount++;
    return result;
  }

  recordHit(url: string, edgeLocation: string): void {
    this.metrics.totalRequests++;
    this.metrics.cacheHits++;
    this.metrics.hitRate = this.metrics.cacheHits / this.metrics.totalRequests;
    this.metrics.edgeLocations[edgeLocation] = (this.metrics.edgeLocations[edgeLocation] ?? 0) + 1;
  }

  recordMiss(url: string): void {
    this.metrics.totalRequests++;
    this.metrics.cacheMisses++;
    this.metrics.hitRate = this.metrics.cacheHits / this.metrics.totalRequests;
  }

  recordTtfb(ttfbMs: number): void {
    this.ttfbSamples.push(ttfbMs);
    if (this.ttfbSamples.length > 1000) this.ttfbSamples.shift();
    this.metrics.averageTtfb = this.ttfbSamples.reduce((a, b) => a + b, 0) / this.ttfbSamples.length;
  }

  recordBandwidth(bytesSaved: number): void {
    this.metrics.bandwidthSaved += bytesSaved;
  }

  getMetrics(): CdnMetrics {
    return { ...this.metrics };
  }

  getEdgeLocations(): string[] {
    return [...this.config.edgeLocations];
  }

  getConfig(): CdnConfig {
    return { ...this.config };
  }

  purgeAll(): PurgeResult {
    const count = this.cacheEntries.size;
    this.cacheEntries.clear();
    this.metrics.purgeCount++;
    return {
      success: true,
      purgedCount: count,
      errors: [],
      completedAt: new Date().toISOString(),
    };
  }
}

export const cdnService = new CdnService();
