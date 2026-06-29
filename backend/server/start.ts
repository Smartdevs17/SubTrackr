/**
 * Entry point for the SubTrackr public API server.
 *
 * Usage: npm run api:start
 * Env:   PORT (default 3000), CDN_PROVIDER, CDN_API_TOKEN, CDN_SERVICE_ID
 */

import { startApiServer } from './createApiServer';

startApiServer();
