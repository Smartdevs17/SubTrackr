/**
 * Compression negotiator middleware.
 *
 * Parses the Accept-Encoding header, prefers Brotli over gzip, and compresses
 * the response body when it exceeds the configured size threshold.
 *
 * - Skips tiny responses (< threshold bytes, default 1 KB).
 * - Skips paths matching the configurable skip list.
 * - Responds with identity Content-Encoding when no mutually-supported encoding
 *   exists or when the client sends an unsupported value.
 * - Supports per-request level override via X-Compression-Level response header.
 *
 * Implementation note: this middleware buffers the entire response body in
 * memory and compresses synchronously in res.end(). For large streaming
 * responses, use streamingMiddleware which handles chunked transfer separately.
 */

import type { Request, Response, NextFunction } from 'express';
import * as zlib from 'zlib';
import {
  resolveCompressionConfig,
  shouldSkipCompression,
  X_COMPRESSION_LEVEL_HEADER,
  DEFAULT_COMPRESSION_CONFIG,
} from '../../config/compression';
import type {
  GlobalCompressionConfig,
  CompressionAlgorithm,
} from '../../config/compression';

function negotiateEncoding(
  acceptEncoding: string | undefined,
): CompressionAlgorithm {
  if (!acceptEncoding) return 'identity';

  const tokens = acceptEncoding
    .split(',')
    .map((t) => t.trim().split(';')[0].toLowerCase());

  if (tokens.includes('br')) return 'br';
  if (tokens.includes('gzip')) return 'gzip';
  return 'identity';
}

function compressBody(
  body: Buffer,
  algorithm: 'br' | 'gzip',
  level: number,
): Buffer {
  if (algorithm === 'br') {
    return zlib.brotliCompressSync(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: Math.max(0, Math.min(11, level)),
      },
    });
  }

  return zlib.gzipSync(body, { level: Math.max(0, Math.min(9, level)) });
}

export interface CompressionMiddlewareOptions {
  config?: GlobalCompressionConfig;
}

export function compressionMiddleware(
  options: CompressionMiddlewareOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const config = options.config ?? DEFAULT_COMPRESSION_CONFIG;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (shouldSkipCompression(config, req.path)) {
      next();
      return;
    }

    const algorithm = negotiateEncoding(
      req.headers['accept-encoding'] as string | undefined,
    );

    if (algorithm === 'identity') {
      next();
      return;
    }

    const runtimeLevelRaw = res.getHeader(X_COMPRESSION_LEVEL_HEADER);
    const runtimeLevel =
      typeof runtimeLevelRaw === 'string'
        ? parseInt(runtimeLevelRaw, 10)
        : typeof runtimeLevelRaw === 'number'
          ? runtimeLevelRaw
          : undefined;

    const compConfig = resolveCompressionConfig(
      config,
      req.path,
      runtimeLevel,
    );

    const threshold = compConfig.threshold;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalSetHeader = res.setHeader.bind(res);
    let contentLengthWritten = false;

    res.setHeader = function (
      this: Response,
      name: string,
      value: string | number | string[],
    ): Response {
      if (name.toLowerCase() === 'content-length') {
        contentLengthWritten = true;
        totalBytes = typeof value === 'string' ? parseInt(value, 10) : value as number;
      }
      return originalSetHeader(name, value);
    } as typeof res.setHeader;

    res.write = (chunk: unknown, ...args: unknown[]): boolean => {
      const buf: Buffer =
        typeof chunk === 'string'
          ? Buffer.from(chunk, (args[0] as BufferEncoding) || 'utf-8')
          : Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(JSON.stringify(chunk));

      chunks.push(buf);
      return true;
    };

    res.end = (chunk?: unknown, ...args: unknown[]): Response => {
      if (chunk !== undefined && chunk !== null) {
        const buf: Buffer =
          typeof chunk === 'string'
            ? Buffer.from(chunk, (args[0] as BufferEncoding) || 'utf-8')
            : Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(JSON.stringify(chunk));

        chunks.push(buf);
      }

      const body = Buffer.concat(chunks);

      if (body.length < threshold) {
        res.setHeader('Content-Length', body.length);
        originalWrite(body);
        return originalEnd();
      }

      const effectiveAlgorithm = algorithm as 'br' | 'gzip';
      let compressed: Buffer;

      try {
        compressed = compressBody(body, effectiveAlgorithm, compConfig.level);
      } catch (_err) {
        res.setHeader('Content-Length', body.length);
        originalWrite(body);
        return originalEnd();
      }

      res.setHeader('Content-Encoding', effectiveAlgorithm);
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');

      originalWrite(compressed);
      return originalEnd();
    };

    next();
  };
}

export const compression = compressionMiddleware();
