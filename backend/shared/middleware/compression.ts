/**
 * Compatibility export for the gateway compression middleware.
 *
 * The implementation lives in `backend/src/middleware/compression.ts`
 * (Issue #2080). Consumers using the shared middleware barrel keep working.
 */

export { compressionMiddleware, compression } from '../../src/middleware/compression';
export type { GatewayCompressionOptions as CompressionMiddlewareOptions } from '../../src/middleware/compression';
