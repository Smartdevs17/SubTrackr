/**
 * Upload routes with a streaming, size-bound parser (Issue #2278).
 *
 * Reads the request body incrementally (`data`/`end` events) instead of
 * buffering it blindly, enforces the `Content-Length` ceiling, and exposes a
 * small multipart/form-data + octet-stream parser. Designed to sit behind
 * `uploadLimitsMiddleware` so oversized requests are rejected before any bytes
 * are consumed.
 *
 * Framework-agnostic: needs `req.headers`, `req.method`, `req.url` and a
 * request that emits `data`/`end` (Node-style), plus a response with
 * `status().json()` + `setHeader()`.
 */

import { buildErrorEnvelope } from '../middleware/errorEnvelope';
import { uploadLimitsMetrics, PAYLOAD_TOO_LARGE } from '../middleware/uploadLimits';

export interface UploadedFile {
  fieldName: string;
  originalName: string | null;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

export interface UploadField {
  fieldName: string;
  value: string;
}

export interface UploadResult {
  success: true;
  contentType: string;
  size: number;
  files: UploadedFile[];
  fields: UploadField[];
}

export interface UploadRouter {
  post(path: string, handler: (req: UploadRequest, res: UploadResponse) => Promise<void>): void;
}

export interface UploadRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  destroyed?: boolean;
}

export interface UploadResponse {
  status(code: number): UploadResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

export interface UploadRouteLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface UploadRouteDeps {
  /** Path to mount the upload endpoint on. Default: `/uploads`. */
  path?: string;
  /** Maximum accepted body size in bytes. Default: 10 MiB. */
  maxBytes?: number;
  /** Invoked with the parsed result once the stream completes. */
  onUpload?: (result: UploadResult, context: { req: UploadRequest }) => Promise<void> | void;
  logger?: UploadRouteLogger;
  now?: () => number;
}

const noopLogger: UploadRouteLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function parseContentType(header: string | string[] | undefined): string {
  if (!header) return '';
  const value = Array.isArray(header) ? header[0] : header;
  return String(value).split(';')[0].trim().toLowerCase();
}

function parseBoundary(contentType: string): string | null {
  const match = /boundary\s*=\s*("?([^";\s]+)"?)/i.exec(contentType);
  return match ? match[2] : null;
}

async function readStream(req: UploadRequest, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      resolve(Buffer.concat(chunks));
    };

    const onData = (chunk: unknown): void => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      received += buf.length;
      if (received > maxBytes) {
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        reject(new Error(`body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = (): void => finish();
    const onError = (err: unknown): void => {
      if (done) return;
      done = true;
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function parseMultipart(body: Buffer, contentType: string): { files: UploadedFile[]; fields: UploadField[] } {
  const boundary = parseBoundary(contentType);
  const files: UploadedFile[] = [];
  const fields: UploadField[] = [];
  if (!boundary) {
    fields.push({ fieldName: 'body', value: body.toString('utf8') });
    return { files, fields };
  }

  // latin1 maps bytes 0-255 1:1, so binary file bytes survive the string split.
  const delimiter = `--${boundary}`;
  const text = body.toString('latin1');
  const parts = text.split(delimiter);
  for (const part of parts) {
    const trimmed = part.startsWith('\r\n') ? part.slice(2) : part;
    if (trimmed.length === 0 || trimmed.trim() === '') continue;

    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerBlock = trimmed.slice(0, headerEnd);
    const payloadStr = trimmed.slice(headerEnd + 4).replace(/\r\n$/, '');

    const disposition = /Content-Disposition:\s*form-data;\s*name="([^"]+)"/i.exec(headerBlock);
    const fileName = /filename="([^"]+)"/i.exec(headerBlock);
    const contentTypeMatch = /Content-Type:\s*([^\r;]+)/i.exec(headerBlock);
    const fieldName = disposition ? disposition[1] : 'body';

    if (fileName) {
      const buffer = Buffer.from(payloadStr, 'latin1');
      files.push({
        fieldName,
        originalName: fileName[1],
        mimeType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        size: buffer.length,
        buffer,
      });
    } else {
      fields.push({ fieldName, value: payloadStr });
    }
  }

  return { files, fields };
}

export function registerUploadRoutes(router: UploadRouter, deps: UploadRouteDeps = {}): void {
  const mountPath = deps.path ?? '/uploads';
  const maxBytes = deps.maxBytes ?? 10 * 1024 * 1024;
  const logger: UploadRouteLogger = deps.logger ?? noopLogger;
  const now = deps.now ?? Date.now;

  router.post(mountPath, async (req, res) => {
    const began = now();
    const contentTypeHeader = String(req.headers['content-type'] ?? '');
    const contentType = parseContentType(contentTypeHeader);

    let body: Buffer;
    try {
      body = await readStream(req, maxBytes);
    } catch (error) {
      uploadLimitsMetrics.rejectedTotal += 1;
      logger.warn('[uploads] request body rejected during streaming', {
        path: mountPath,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(PAYLOAD_TOO_LARGE).json(
        buildErrorEnvelope(PAYLOAD_TOO_LARGE, 'Request body exceeds upload size ceiling', {
          code: 'PAYLOAD_TOO_LARGE',
          maxBytes: String(maxBytes),
        }),
      );
      res.setHeader?.('X-Upload-Limit-Bytes', String(maxBytes));
      return;
    }

    const result: UploadResult = {
      success: true,
      contentType,
      size: body.length,
      files: [],
      fields: [],
    };

    if (contentType === 'multipart/form-data') {
      const parsed = parseMultipart(body, contentTypeHeader);
      result.files = parsed.files;
      result.fields = parsed.fields;
    } else if (contentType === 'application/octet-stream' || contentType === '') {
      result.fields.push({ fieldName: 'body', value: body.toString('utf8') });
    } else {
      result.fields.push({ fieldName: 'body', value: body.toString('utf8') });
    }

    try {
      await deps.onUpload?.(result, { req });
    } catch (error) {
      logger.error('[uploads] onUpload handler failed', {
        path: mountPath,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json(
        buildErrorEnvelope(500, 'Upload processing failed', { code: 'INTERNAL_SERVER_ERROR' }),
      );
      return;
    }

    logger.debug('[uploads] upload completed', {
      path: mountPath,
      contentType,
      size: body.length,
      fileCount: result.files.length,
      durationMs: Math.max(0, now() - began),
    });
    res.status(200).json({ success: true, data: result });
  });
}

export { parseMultipart, readStream };
export type { UploadRequest, UploadResponse, UploadRouteDeps, UploadResult, UploadedFile, UploadField };
