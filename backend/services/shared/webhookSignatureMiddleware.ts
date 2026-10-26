import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { WebhookSecret } from '../../../src/types/webhook';

export interface WebhookSignatureOptions {
  /**
   * The active signing secrets. Can be a static list or a function that dynamically
   * retrieves the list (e.g., from a database) to support key rotation.
   */
  secrets: WebhookSecret[] | (() => Promise<WebhookSecret[]> | WebhookSecret[]);
  /**
   * The name of the header containing the signature.
   * Defaults to 'X-SubTrackr-Signature'.
   */
  headerName?: string;
  /**
   * By default, the middleware expects the raw body buffer to be available on `req.rawBody`.
   * You can override this to extract the raw payload string/buffer from the request.
   */
  getRawBody?: (req: Request) => Buffer | string | undefined;
}

/**
 * Creates an Express middleware that verifies incoming webhook signatures.
 * Supports key rotation by checking the signature against all currently valid secrets.
 * 
 * Note: To use this middleware effectively, the raw request body must be preserved.
 * You can do this with `express.json({ verify: (req, res, buf) => { (req as any).rawBody = buf; } })`.
 */
export function createWebhookSignatureMiddleware(options: WebhookSignatureOptions) {
  const headerName = (options.headerName ?? 'X-SubTrackr-Signature').toLowerCase();
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signatureHeader = req.headers[headerName];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!signature) {
        res.status(401).json({ error: `Missing ${options.headerName ?? 'X-SubTrackr-Signature'} header` });
        return;
      }

      // Extract raw body
      const rawBody = options.getRawBody 
        ? options.getRawBody(req) 
        : (req as any).rawBody;

      if (!rawBody) {
        res.status(500).json({ error: 'Raw request body not available for signature verification' });
        return;
      }

      // Retrieve secrets (supporting dynamic retrieval for key rotation)
      const secrets = typeof options.secrets === 'function' ? await options.secrets() : options.secrets;
      
      const now = Date.now();
      const validSecrets = secrets.filter(secret => {
        if (now < secret.validFrom) return false;
        if (secret.validUntil !== undefined && now > secret.validUntil) return false;
        return true;
      });

      if (validSecrets.length === 0) {
        res.status(401).json({ error: 'No valid webhook secrets configured' });
        return;
      }

      const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      
      // Some webhook senders prefix the signature (e.g. sha256=...)
      // The SubTrackr backend sends raw hex, but we handle the prefix if present.
      let actualSignatureHex = signature;
      if (signature.startsWith('sha256=')) {
        actualSignatureHex = signature.slice(7);
      }
      const actualSignatureBytes = Buffer.from(actualSignatureHex, 'hex');

      let isValid = false;
      for (const secret of validSecrets) {
        // SubTrackr signs using HMAC SHA-256
        const hmac = crypto.createHmac('sha256', secret.key);
        hmac.update(bodyBuffer);
        const expectedSignatureHex = hmac.digest('hex');
        const expectedSignatureBytes = Buffer.from(expectedSignatureHex, 'hex');

        if (
          actualSignatureBytes.length === expectedSignatureBytes.length &&
          crypto.timingSafeEqual(actualSignatureBytes, expectedSignatureBytes)
        ) {
          isValid = true;
          break;
        }
      }

      if (!isValid) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
