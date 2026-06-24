/**
 * Serverless database configuration helpers.
 *
 * Issue #600: wires the serverless connection pool to the right proxy endpoint
 * and authentication mode for each environment.
 *
 *   - Production (AWS): RDS Proxy with IAM authentication. The "password" is a
 *     short-lived signed token regenerated on every connect.
 *   - Self-hosted / staging: PgBouncer with SCRAM-SHA-256.
 *   - Local dev: PgBouncer (docker-compose) with a static password.
 */

import {
  getServerlessPool,
  type ServerlessConnectionPool,
  type ServerlessPoolConfig,
  type ProxyAuthMode,
} from '../shared/db/serverlessPool';

/**
 * Build an RDS IAM auth-token provider. The token is signed with the AWS SDK's
 * RDS Signer and is valid for ~15 minutes, so we regenerate it on each connect.
 *
 * `@aws-sdk/rds-signer` is imported lazily so non-AWS deployments never need it.
 */
export function createRdsIamCredentialProvider(opts: {
  hostname: string;
  port: number;
  username: string;
  region?: string;
}): () => Promise<string> {
  return async () => {
    const { Signer } = (await import('@aws-sdk/rds-signer')) as {
      Signer: new (cfg: {
        hostname: string;
        port: number;
        username: string;
        region?: string;
      }) => { getAuthToken(): Promise<string> };
    };
    const signer = new Signer({
      hostname: opts.hostname,
      port: opts.port,
      username: opts.username,
      region: opts.region ?? process.env['AWS_REGION'],
    });
    return signer.getAuthToken();
  };
}

/**
 * Resolve the serverless pool configuration from the environment. Centralised
 * so every Lambda handler gets identical, correct pooling behaviour.
 */
export function resolveServerlessPoolConfig(): ServerlessPoolConfig {
  const authMode = (process.env['DB_PROXY_AUTH_MODE'] as ProxyAuthMode) || 'scram-256';
  const host = process.env['DB_PROXY_HOST'] ?? process.env['DB_HOST'] ?? 'localhost';
  const port = Number(process.env['DB_PROXY_PORT'] ?? 6432);
  const user = process.env['DB_USER'] ?? 'subtrackr_app';

  const base: ServerlessPoolConfig = {
    authMode,
    host,
    port,
    user,
    database: process.env['DB_NAME'] ?? 'subtrackr',
    transactionPooling: process.env['DB_PROXY_TXN_POOLING'] !== 'false',
    preparedStatements: process.env['DB_PROXY_PREPARED_STATEMENTS'] === 'true',
    maxPooledConnections: Number(process.env['DB_PROXY_MAX_CONN'] ?? 50),
    leakDetectionThresholdMs: Number(process.env['DB_LEAK_THRESHOLD_MS'] ?? 30_000),
    ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: true } : undefined,
  };

  if (authMode === 'iam') {
    base.credentialProvider = createRdsIamCredentialProvider({
      hostname: host,
      port,
      username: user,
      region: process.env['AWS_REGION'],
    });
  }

  return base;
}

/** Get the shared serverless pool configured from the environment. */
export function getConfiguredServerlessPool(): ServerlessConnectionPool {
  return getServerlessPool(resolveServerlessPoolConfig());
}
