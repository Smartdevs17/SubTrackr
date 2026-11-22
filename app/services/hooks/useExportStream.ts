/**
 * Issue #768 – useExportStream hook
 *
 * Connects to the SSE export progress endpoint and surfaces:
 *  - Progress percentage + stage message
 *  - Final download URL once complete
 *  - Error state
 *  - Cancel function
 *
 * Usage:
 * ```tsx
 * const { progress, stage, downloadUrl, error, startExport, cancel } =
 *   useExportStream('exp_abc123');
 *
 * // Start the export
 * <Button onPress={() => startExport({ format: 'csv' })} title="Export CSV" />
 *
 * // Show progress
 * {progress > 0 && <ProgressBar value={progress} />}
 *
 * // Download link
 * {downloadUrl && <Link href={downloadUrl}>Download</Link>}
 * ```
 */

import { useState, useCallback, useRef } from 'react';
import { subscribeToSse } from '../streamingService';

export type ExportStage = 'idle' | 'connecting' | 'processing' | 'complete' | 'error';

export interface UseExportStreamOptions {
  /** Base URL for the SSE endpoint. Default: '/exports/stream'. */
  baseUrl?: string;
}

export interface StartExportParams {
  /** Export format. Default: 'json'. */
  format?: 'json' | 'csv';
  /** Additional query params forwarded to the SSE endpoint. */
  params?: Record<string, string>;
}

export interface UseExportStreamResult {
  /** Export progress 0–100. 0 when idle. */
  progress: number;
  /** Human-readable stage label. */
  stage: ExportStage;
  /** Message from the latest progress event. */
  statusMessage: string;
  /** Number of records processed so far. */
  recordsProcessed: number;
  /** Total records to export (if known). */
  totalRecords: number | undefined;
  /** Final download URL (set when stage === 'complete'). */
  downloadUrl: string | null;
  /** Final checksum for validation (set when stage === 'complete'). */
  checksum: string | null;
  /** Error message (set when stage === 'error'). */
  error: string | null;
  /** Start the export stream for the given exportId. */
  startExport: (exportId: string, params?: StartExportParams) => void;
  /** Cancel the in-flight SSE connection. */
  cancel: () => void;
  /** Reset state back to idle. */
  reset: () => void;
}

const initialState = {
  progress: 0,
  stage: 'idle' as ExportStage,
  statusMessage: '',
  recordsProcessed: 0,
  totalRecords: undefined as number | undefined,
  downloadUrl: null as string | null,
  checksum: null as string | null,
  error: null as string | null,
};

export function useExportStream(
  options: UseExportStreamOptions = {}
): UseExportStreamResult {
  const { baseUrl = '/exports/stream' } = options;

  const [state, setState] = useState(initialState);
  const cancelRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setState((prev) =>
      prev.stage !== 'idle' && prev.stage !== 'complete' && prev.stage !== 'error'
        ? { ...prev, stage: 'idle' }
        : prev
    );
  }, []);

  const reset = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setState(initialState);
  }, []);

  const startExport = useCallback(
    (exportId: string, params: StartExportParams = {}) => {
      // Cancel any existing connection
      cancelRef.current?.();

      const { format = 'json', params: extraParams = {} } = params;

      const url = new URL(`${baseUrl}/${exportId}`, 'http://localhost');
      url.searchParams.set('format', format);
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v);
      }

      setState({
        ...initialState,
        stage: 'connecting',
        statusMessage: 'Connecting…',
      });

      const stop = subscribeToSse(
        // Strip the dummy base if running on a real server
        url.pathname + url.search,
        {
          onProgress: (data) => {
            setState((prev) => ({
              ...prev,
              stage: 'processing',
              progress: data.percent,
              statusMessage: data.message,
              recordsProcessed: data.recordsProcessed,
              totalRecords: data.totalRecords ?? prev.totalRecords,
            }));
          },
          onChunk: (_data) => {
            // Chunks are handled server-side for the SSE flow;
            // in a download-and-assemble scenario callers can override this.
          },
          onComplete: (data) => {
            cancelRef.current = null;
            setState((prev) => ({
              ...prev,
              stage: 'complete',
              progress: 100,
              statusMessage: 'Export complete',
              totalRecords: data.totalRecords,
              downloadUrl: data.downloadUrl ?? null,
              checksum: data.checksum ?? null,
            }));
          },
          onError: (data) => {
            cancelRef.current = null;
            setState((prev) => ({
              ...prev,
              stage: 'error',
              error: data.message,
              statusMessage: 'Export failed',
            }));
          },
          onClose: () => {
            cancelRef.current = null;
          },
        }
      );

      cancelRef.current = stop;
    },
    [baseUrl]
  );

  return {
    ...state,
    startExport,
    cancel,
    reset,
  };
}

export default useExportStream;
