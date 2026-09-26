/**
 * Connection string rotation for primary + read-replica endpoints.
 *
 * Supports hot-swapping DATABASE_URL / DATABASE_READ_URLS style connection
 * strings (credential rotation) and round-robin selection across healthy
 * endpoints during failover.
 */

export type ConnectionRole = 'primary' | 'replica';

export interface ParsedConnectionString {
  /** Original connection string (password redacted in toSafeString). */
  connectionString: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  role: ConnectionRole;
  /** Logical name used in metrics / routing (primary, replica-1, …). */
  name: string;
}

export interface ConnectionStringRotationOptions {
  /** Primary connection string (DATABASE_URL). */
  primaryUrl?: string;
  /** Comma-separated or array of replica URLs (DATABASE_READ_URLS). */
  replicaUrls?: string | string[];
}

/** Parse a postgres connection URL into structured fields. */
export function parseConnectionString(
  raw: string,
  role: ConnectionRole,
  name: string,
): ParsedConnectionString {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Empty connection string for ${name}`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid connection string for ${name}`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`Unsupported protocol in connection string for ${name}: ${url.protocol}`);
  }

  const sslMode = url.searchParams.get('sslmode');
  const ssl =
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full' ||
    url.searchParams.get('ssl') === 'true';

  return {
    connectionString: trimmed,
    host: url.hostname || 'localhost',
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
    database: decodeURIComponent((url.pathname || '/subtrackr').replace(/^\//, '') || 'subtrackr'),
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || ''),
    ssl,
    role,
    name,
  };
}

function splitReplicaUrls(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((u) => u.trim()).filter(Boolean);
  }
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Redact password from a connection string for logs / diagnostics. */
export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '[invalid-connection-string]';
  }
}

/**
 * Rotates through healthy connection strings for primary and read replicas.
 * Call `rotate()` when secrets/credentials change to hot-swap endpoints
 * without restarting the process.
 */
export class ConnectionStringRotator {
  private primary: ParsedConnectionString | null = null;
  private replicas: ParsedConnectionString[] = [];
  private failed = new Set<string>();
  private replicaIndex = 0;
  private rotationGeneration = 0;

  constructor(options: ConnectionStringRotationOptions = {}) {
    this.applyOptions(options);
  }

  /** Load endpoints from env (DATABASE_URL + DATABASE_READ_URLS). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): ConnectionStringRotator {
    return new ConnectionStringRotator({
      primaryUrl: env.DATABASE_URL,
      replicaUrls: env.DATABASE_READ_URLS,
    });
  }

  getGeneration(): number {
    return this.rotationGeneration;
  }

  getPrimary(): ParsedConnectionString | null {
    return this.primary;
  }

  getReplicas(): ParsedConnectionString[] {
    return [...this.replicas];
  }

  getHealthyReplicas(): ParsedConnectionString[] {
    return this.replicas.filter((r) => !this.failed.has(r.name));
  }

  /** Round-robin next healthy replica connection string. */
  nextReplica(): ParsedConnectionString | null {
    const healthy = this.getHealthyReplicas();
    if (healthy.length === 0) return null;
    const selected = healthy[this.replicaIndex % healthy.length]!;
    this.replicaIndex = (this.replicaIndex + 1) % healthy.length;
    return selected;
  }

  markFailed(name: string): void {
    this.failed.add(name);
  }

  markHealthy(name: string): void {
    this.failed.delete(name);
  }

  isFailed(name: string): boolean {
    return this.failed.has(name);
  }

  /**
   * Hot-swap connection strings (credential / endpoint rotation).
   * Clears failure state and bumps generation so pool rebuilders can react.
   */
  rotate(options: ConnectionStringRotationOptions): number {
    this.applyOptions(options);
    this.failed.clear();
    this.replicaIndex = 0;
    this.rotationGeneration += 1;
    return this.rotationGeneration;
  }

  /** Snapshot of all configured endpoints (password redacted). */
  toSafeSnapshot(): Array<{ name: string; role: ConnectionRole; url: string; failed: boolean }> {
    const entries: Array<{ name: string; role: ConnectionRole; url: string; failed: boolean }> = [];
    if (this.primary) {
      entries.push({
        name: this.primary.name,
        role: 'primary',
        url: redactConnectionString(this.primary.connectionString),
        failed: this.failed.has(this.primary.name),
      });
    }
    for (const replica of this.replicas) {
      entries.push({
        name: replica.name,
        role: 'replica',
        url: redactConnectionString(replica.connectionString),
        failed: this.failed.has(replica.name),
      });
    }
    return entries;
  }

  private applyOptions(options: ConnectionStringRotationOptions): void {
    if (options.primaryUrl?.trim()) {
      this.primary = parseConnectionString(options.primaryUrl, 'primary', 'primary');
    } else {
      this.primary = null;
    }

    this.replicas = splitReplicaUrls(options.replicaUrls).map((url, index) =>
      parseConnectionString(url, 'replica', `replica-${index + 1}`),
    );
  }
}
