import crypto from 'crypto';

export interface WebhookSignatureOptions {
  algorithm?: string; // e.g., 'sha256', 'sha512' (default: 'sha256')
  timestamp?: number; // Epoch seconds (default: current time)
  encoding?: 'hex' | 'base64'; // Output encoding (default: 'hex')
  version?: string; // Signature version tag (default: 'v1')
  includeTimestampInHeader?: boolean; // Whether to format as `t={ts},v1={sig}` (default: true)
}

export interface WebhookValidationOptions {
  algorithm?: string;
  timestampTolerance?: number; // Max allowed age in seconds (default: 300 = 5 minutes)
  encoding?: 'hex' | 'base64';
  version?: string;
  headerFormat?: 'stripe' | 'raw' | 'prefixed'; // 'stripe' (t=...,v1=...), 'prefixed' (sha256=...), 'raw'
  secretHeaderName?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  timestamp?: number;
  matchedSecretIndex?: number;
}

/**
 * Helper to compute HMAC signature for a raw body payload.
 */
export function generateWebhookSignature(
  payload: string | Buffer,
  secret: string,
  options: WebhookSignatureOptions = {}
): { signature: string; timestamp: number; headerValue: string } {
  const algorithm = options.algorithm || 'sha256';
  const encoding = options.encoding || 'hex';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const version = options.version || 'v1';
  const includeTimestamp = options.includeTimestampInHeader ?? true;

  const dataToSign = includeTimestamp
    ? `${timestamp}.${typeof payload === 'string' ? payload : payload.toString('utf-8')}`
    : typeof payload === 'string' ? payload : payload.toString('utf-8');

  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(dataToSign);
  const signature = hmac.digest(encoding);

  const headerValue = includeTimestamp
    ? `t=${timestamp},${version}=${signature}`
    : signature;

  return { signature, timestamp, headerValue };
}

/**
 * Constant-time comparison for HMAC signatures to prevent timing attacks.
 */
export function timingSafeCompare(a: string, b: string, encoding: 'hex' | 'base64' = 'hex'): boolean {
  try {
    const bufA = Buffer.from(a, encoding);
    const bufB = Buffer.from(b, encoding);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Parses structured webhook signature headers (e.g. `t=1600000000,v1=abcdef...` or `sha256=abcdef...`).
 */
export function parseSignatureHeader(header: string): { timestamp?: number; signatures: Record<string, string[]> } {
  const signatures: Record<string, string[]> = {};
  let timestamp: number | undefined;

  if (!header) return { signatures };

  const parts = header.split(',').map((p) => p.trim());
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();

    if (key === 't') {
      const parsedTs = parseInt(val, 10);
      if (!isNaN(parsedTs)) {
        timestamp = parsedTs;
      }
    } else {
      if (!signatures[key]) {
        signatures[key] = [];
      }
      signatures[key].push(val);
    }
  }

  return { timestamp, signatures };
}

/**
 * Verifies a webhook HMAC signature against single or multiple candidate secrets.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  secrets: string | string[],
  options: WebhookValidationOptions = {}
): ValidationResult {
  if (!signatureHeader) {
    return { isValid: false, error: 'Missing signature header' };
  }

  const secretList = Array.isArray(secrets) ? secrets : [secrets];
  if (secretList.length === 0 || secretList.some((s) => !s)) {
    return { isValid: false, error: 'No valid secret provided for verification' };
  }

  const algorithm = options.algorithm || 'sha256';
  const tolerance = options.timestampTolerance ?? 300;
  const encoding = options.encoding || 'hex';
  const expectedVersion = options.version || 'v1';
  const rawPayload = typeof payload === 'string' ? payload : payload.toString('utf-8');

  // Check if header is structured or raw
  if (signatureHeader.includes('=')) {
    const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

    // If timestamp is present in header, check freshness tolerance
    if (timestamp !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > tolerance) {
        return { isValid: false, error: 'Signature timestamp outside allowed tolerance', timestamp };
      }
    }

    const versionSigs = signatures[expectedVersion] || signatures['sha256'] || [];
    if (versionSigs.length === 0 && Object.keys(signatures).length > 0) {
      // Check prefix headers like sha256=hash
      const prefixedSig = signatureHeader.startsWith(`${algorithm}=`)
        ? signatureHeader.slice(algorithm.length + 1)
        : null;
      if (prefixedSig) {
        versionSigs.push(prefixedSig);
      }
    }

    if (versionSigs.length === 0) {
      return { isValid: false, error: 'No matching signature scheme found in header' };
    }

    // Try verifying with timestamp payload if timestamp present, else raw payload
    for (let i = 0; i < secretList.length; i++) {
      const secret = secretList[i];
      const dataToSign = timestamp !== undefined ? `${timestamp}.${rawPayload}` : rawPayload;
      const expectedHmac = crypto.createHmac(algorithm, secret).update(dataToSign).digest(encoding);

      for (const sig of versionSigs) {
        if (timingSafeCompare(sig, expectedHmac, encoding)) {
          return { isValid: true, timestamp, matchedSecretIndex: i };
        }
      }
    }

    return { isValid: false, error: 'Signature mismatch' };
  } else {
    // Raw signature header
    const cleanSig = signatureHeader.trim();

    for (let i = 0; i < secretList.length; i++) {
      const secret = secretList[i];
      const expectedHmac = crypto.createHmac(algorithm, secret).update(rawPayload).digest(encoding);

      if (timingSafeCompare(cleanSig, expectedHmac, encoding)) {
        return { isValid: true, matchedSecretIndex: i };
      }
    }

    return { isValid: false, error: 'Signature mismatch' };
  }
}

/**
 * Reusable Webhook HMAC Validator class.
 */
export class WebhookHmacValidator {
  private secrets: string[];
  private options: WebhookValidationOptions;

  constructor(secrets: string | string[], options: WebhookValidationOptions = {}) {
    this.secrets = Array.isArray(secrets) ? secrets : [secrets];
    this.options = options;
  }

  public generate(payload: string | Buffer, timestamp?: number) {
    return generateWebhookSignature(payload, this.secrets[0], {
      algorithm: this.options.algorithm,
      encoding: this.options.encoding,
      version: this.options.version,
      timestamp,
    });
  }

  public verify(payload: string | Buffer, signatureHeader: string): ValidationResult {
    return verifyWebhookSignature(payload, signatureHeader, this.secrets, this.options);
  }
}

/**
 * Express middleware for automatic Webhook HMAC signature validation.
 */
export function createWebhookHmacMiddleware(
  secretProvider: string | string[] | ((req: any) => string | string[] | Promise<string | string[]>),
  options: WebhookValidationOptions & { headerName?: string } = {}
) {
  const headerName = (options.headerName || 'x-webhook-signature').toLowerCase();

  return async (req: any, res: any, next: any) => {
    try {
      const signatureHeader = req.headers[headerName] || req.headers['stripe-signature'];
      if (!signatureHeader) {
        return res.status(401).json({ error: `Missing webhook signature header: ${headerName}` });
      }

      let secrets: string | string[];
      if (typeof secretProvider === 'function') {
        secrets = await secretProvider(req);
      } else {
        secrets = secretProvider;
      }

      // Payload can be req.rawBody or JSON.stringify(req.body)
      const rawPayload = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      if (!rawPayload) {
        return res.status(400).json({ error: 'Request body is empty or unparseable' });
      }

      const result = verifyWebhookSignature(rawPayload, signatureHeader as string, secrets, options);
      if (!result.isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature', details: result.error });
      }

      req.webhookVerified = true;
      req.webhookTimestamp = result.timestamp;
      next();
    } catch (err: any) {
      return res.status(500).json({ error: 'Webhook signature validation internal error', details: err.message });
    }
  };
}
