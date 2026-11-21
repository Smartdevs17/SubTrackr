/** Optional JSON-log telemetry sink for query events. */

import { serializeQueryKey } from './queryKey';
import type { QueryEvent, QueryTelemetry } from './types';

export interface QueryEventLogger {
  info(message: string): void;
}

export function createConsoleQueryTelemetry(logger: QueryEventLogger = console): QueryTelemetry {
  return {
    emit(event: QueryEvent): void {
      const payload: Record<string, unknown> = {
        kind: 'query',
        type: event.type,
        key: event.key ?? serializeQueryKey(event.keyParts),
        at: event.at,
      };
      if (event.durationMs !== undefined) payload.durationMs = event.durationMs;
      if (event.attempts !== undefined) payload.attempts = event.attempts;
      if (event.stale !== undefined) payload.stale = event.stale;
      if (event.tags?.length) payload.tags = event.tags;
      if (event.error) payload.error = event.error;
      logger.info(JSON.stringify(payload));
    },
  };
}
