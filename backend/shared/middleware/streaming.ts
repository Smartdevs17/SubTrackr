/**
 * Streaming response middleware.
 *
 * Enables Transfer-Encoding: chunked for large payloads by flushing headers
 * early and piping the response through Node.js stream primitives with full
 * backpressure support.
 *
 * Usage in a route handler:
 *   app.get('/exports/invoices', streamingMiddleware, async (req, res) => {
 *     const generator = exportService.streamInvoices();
 *     res.stream(generator);
 *   });
 *
 * After this middleware runs, `res.stream()` is available on the response.
 */

import type { Request, Response, NextFunction } from 'express';

export interface StreamOptions {
  /** Content-Type of the response. Defaults to "application/octet-stream". */
  contentType?: string;
  /** Explicit Content-Disposition header, e.g. `attachment; filename="export.csv"`. */
  contentDisposition?: string;
  /** Flush headers before the first chunk. Default true. */
  flushHeaders?: boolean;
}

export function streamingMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (typeof (res as unknown as Record<string, unknown>).stream === 'function') {
    next();
    return;
  }

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  (res as unknown as Record<string, unknown>).stream = async function (
    this: Response,
    source: AsyncIterable<Buffer | string> | Iterable<Buffer | string>,
    options: StreamOptions = {},
  ): Promise<void> {
    const self = this;
    const {
      contentType = 'application/octet-stream',
      contentDisposition,
      flushHeaders: shouldFlush = true,
    } = options;

    self.setHeader('Content-Type', contentType);
    self.setHeader('Transfer-Encoding', 'chunked');
    self.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (contentDisposition) {
      self.setHeader('Content-Disposition', contentDisposition);
    }

    if (shouldFlush) {
      self.flushHeaders();
    }

    try {
      for await (const chunk of source) {
        const buf =
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk;

        const canContinue = originalWrite(buf);
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            self.once('drain', resolve);
          });
        }
      }
    } catch (_err) {
      if (!self.headersSent) {
        self.status(500).end();
      }
      return;
    } finally {
      if (self.writable) {
        originalEnd();
      }
    }
  };

  next();
}

declare global {
  namespace Express {
    interface Response {
      stream(
        source: AsyncIterable<Buffer | string> | Iterable<Buffer | string>,
        options?: StreamOptions,
      ): Promise<void>;
    }
  }
}
