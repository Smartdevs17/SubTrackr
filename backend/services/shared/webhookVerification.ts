/**
 * Webhook Signature Verification with Key Rotation — SubTrackr
 *
 * Provides HMAC-based webhook payload verification with
 * automatic key rotation support for webhook endpoints.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface WebhookSecret {
  id: string;
  key: string;
  createdAt: number;
  expiresAt: number | null;
  rotatedAt: number | null;
  active: boolean;
}

export interface WebhookVerificationConfig {
  headerName: string;
  timestampHeader: string;
  toleranceMs: number;
  algorithm: string;
  maxKeyAge: number;
}

export interface WebhookSignatureHeader {
  signature: string;
  timestamp: string;
  keyId: string;
}

const DEFAULT_WEBHOOK_CONFIG: WebhookVerificationConfig = {
  headerName: 'x-webhook-signature',
  timestampHeader: 'x-webhook-timestamp',
  toleranceMs: 300000,
  algorithm: 'sha256',
  maxKeyAge: 90 * 24 * 60 * 60 * 1000,
};

export class WebhookVerifier {
  private secrets = new Map<string, WebhookSecret>();
  private config: WebhookVerificationConfig;

  constructor(config: Partial<WebhookVerificationConfig> = {}) {
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
  }

  registerSecret(secret: string, ttlMs?: number): WebhookSecret {
    const id = `whsec_${randomBytes(12).toString('hex')}`;
    const now = Date.now();
    const record: WebhookSecret = {
      id,
      key: secret,
      createdAt: now,
      expiresAt: ttlMs ? now + ttlMs : null,
      rotatedAt: null,
      active: true,
    };
    this.secrets.set(id, record);
    return record;
  }

  rotateSecret(oldId: string, newSecret: string): WebhookSecret {
    const old = this.secrets.get(oldId);
    if (old) {
      old.active = false;
      old.rotatedAt = Date.now();
    }
    return this.registerSecret(newSecret);
  }

  deactivateSecret(id: string): boolean {
    const secret = this.secrets.get(id);
    if (!secret) return false;
    secret.active = false;
    return true;
  }

  getActiveSecrets(): WebhookSecret[] {
    return Array.from(this.secrets.values()).filter((s) => s.active);
  }

  computeSignature(payload: string, secret: string, timestamp: string): string {
    const signedPayload = `${timestamp}.${payload}`;
    return createHmac(this.config.algorithm, secret)
      .update(signedPayload)
      .digest('hex');
  }

  parseSignatureHeader(headerValue: string): WebhookSignatureHeader | null {
    const parts = headerValue.split(',');
    if (parts.length < 3) return null;

    const sigMap: Record<string, string> = {};
    for (const part of parts) {
      const [key, ...valueParts] = part.split('=');
      sigMap[key.trim()] = valueParts.join('=').trim();
    }

    if (!sigMap['v1'] || !sigMap['t'] || !sigMap['kid']) return null;

    return {
      signature: sigMap['v1'],
      timestamp: sigMap['t'],
      keyId: sigMap['kid'],
    };
  }

  verify(
    payload: string,
    signatureHeader: string,
  ): { valid: boolean; error?: string; secretId?: string } {
    const parsed = this.parseSignatureHeader(signatureHeader);
    if (!parsed) {
      return { valid: false, error: 'Invalid signature header format' };
    }

    const timestampMs = parseInt(parsed.timestamp, 10) * 1000;
    if (isNaN(timestampMs)) {
      return { valid: false, error: 'Invalid timestamp in signature header' };
    }

    const age = Date.now() - timestampMs;
    if (age > this.config.toleranceMs) {
      return { valid: false, error: 'Signature timestamp outside tolerance window' };
    }
    if (age < -this.config.toleranceMs) {
      return { valid: false, error: 'Signature timestamp is in the future' };
    }

    const secrets = this.getActiveSecrets();
    const targetSecret = secrets.find((s) => s.id === parsed.keyId);

    if (!targetSecret) {
      return { valid: false, error: 'Unknown key ID', secretId: parsed.keyId };
    }

    if (targetSecret.expiresAt && Date.now() > targetSecret.expiresAt) {
      return { valid: false, error: 'Webhook secret has expired', secretId: targetSecret.id };
    }

    const expectedSignature = this.computeSignature(payload, targetSecret.key, parsed.timestamp);

    const sigBuffer = Buffer.from(parsed.signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const isValid = timingSafeEqual(sigBuffer, expectedBuffer);

    return isValid
      ? { valid: true, secretId: targetSecret.id }
      : { valid: false, error: 'Signature mismatch' };
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, secret] of this.secrets) {
      if (!secret.active && secret.rotatedAt && now - secret.rotatedAt > this.config.maxKeyAge) {
        this.secrets.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

export const webhookVerifier = new WebhookVerifier();
