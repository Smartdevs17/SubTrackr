/**
 * Export REST API
 *
 * HTTP request/response handlers for the subscription export API.
 * Follows the ApiResponse<T> envelope convention used throughout the backend
 * (see notification/webhookManagementApi.ts, billing/usageIngestionApi.ts).
 *
 * Routes to wire up in your Express/Fastify app:
 *   POST   /v1/exports                   → handleCreateExport
 *   GET    /v1/exports/:id               → handleGetExportStatus
 *   GET    /v1/exports/:id/download      → handleDownloadExport
 *   PATCH  /v1/exports/:id/download      → handleRecordDownload
 *   POST   /v1/exports/schedules         → handleCreateSchedule
 *   GET    /v1/exports/schedules         → handleGetSchedules
 *   PATCH  /v1/exports/schedules/:id     → handleUpdateSchedule
 *   DELETE /v1/exports/schedules/:id     → handleDeleteSchedule
 *   GET    /v1/exports/analytics         → handleGetAnalytics
 */

import type { Request, Response } from 'express';
import {
  streamExport,
  reconcile,
  createExportSchedule,
  getExportSchedules,
  updateExportSchedule,
  deleteExportSchedule,
  toggleExportSchedule,
  runDueExports,
  recordExportDownload,
  getExportHistory,
  getExportAnalytics,
  AccountingFormat,
  TransactionRecord,
  ExportScheduleInput,
  ExportHistoryEntry,
} from './accountingExportService';

// ── Response helpers ──────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  requestId?: string;
}

function ok<T>(data: T, message?: string, requestId?: string): ApiResponse<T> {
  return { success: true, data, message, requestId };
}

function fail(error: unknown, fallback: string, requestId?: string): ApiResponse<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    requestId,
  };
}

function requestId(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

// ── Supported formats ─────────────────────────────────────────────────────────

const SUPPORTED_FORMATS = new Set<AccountingFormat>(['csv', 'json', 'quickbooks', 'xero', 'pdf']);

const MIME_TYPES: Record<AccountingFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  quickbooks: 'text/csv',
  xero: 'text/csv',
  pdf: 'application/pdf',
};

const FILE_EXTENSIONS: Record<AccountingFormat, string> = {
  csv: 'csv',
  json: 'json',
  quickbooks: 'csv',
  xero: 'csv',
  pdf: 'pdf',
};

// ── In-process export result store (replace with DB/cache in production) ──────

interface StoredExport {
  id: string;
  merchantId: string;
  format: AccountingFormat;
  content: string;
  fileName: string;
  checksum: string;
  itemCount: number;
  createdAt: number;
}

const exportStore = new Map<string, StoredExport>();

function generateExportId(): string {
  return `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Endpoint handlers ─────────────────────────────────────────────────────────

/**
 * POST /v1/exports
 *
 * Body:
 * ```json
 * {
 *   "format": "csv" | "json" | "quickbooks" | "xero" | "pdf",
 *   "records": TransactionRecord[],
 *   "filter": ExportFilter?,
 *   "fieldMappings": CustomFieldMapping[]?,
 *   "customFields": Record<string, string>?,
 *   "includeSchema": boolean?
 * }
 * ```
 */
export async function handleCreateExport(req: Request, res: Response): Promise<void> {
  const rid = requestId(req);

  const { format, records, filter, fieldMappings, customFields, includeSchema } = req.body as {
    format?: string;
    records?: TransactionRecord[];
    filter?: Record<string, unknown>;
    fieldMappings?: unknown[];
    customFields?: Record<string, string>;
    includeSchema?: boolean;
  };

  if (!format || !SUPPORTED_FORMATS.has(format as AccountingFormat)) {
    res.status(400).json(
      fail(
        null,
        `format must be one of: ${[...SUPPORTED_FORMATS].join(', ')}`,
        rid
      )
    );
    return;
  }

  if (!Array.isArray(records)) {
    res.status(400).json(fail(null, 'records must be an array of TransactionRecord', rid));
    return;
  }

  try {
    const fmt = format as AccountingFormat;
    const chunks: string[] = [];

    const { totalRecords, checksum } = streamExport(records, {
      format: fmt,
      filter: filter as Record<string, unknown> ?? {},
      onChunk: (c) => chunks.push(c),
      fieldMappings: fieldMappings as never,
      customFields,
      includeSchema,
    });

    const content = chunks.join('');
    const exportId = generateExportId();
    const merchantId = (filter as { merchantId?: string })?.merchantId ?? 'unknown';
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${merchantId}-${fmt}-export-${dateStr}.${FILE_EXTENSIONS[fmt]}`;

    exportStore.set(exportId, {
      id: exportId,
      merchantId,
      format: fmt,
      content,
      fileName,
      checksum,
      itemCount: totalRecords,
      createdAt: Date.now(),
    });

    res.status(201).json(
      ok(
        {
          exportId,
          merchantId,
          format: fmt,
          fileName,
          mimeType: MIME_TYPES[fmt],
          itemCount: totalRecords,
          checksum,
        },
        'Export created successfully',
        rid
      )
    );
  } catch (error) {
    res.status(500).json(fail(error, 'Export generation failed', rid));
  }
}

/**
 * GET /v1/exports/:id
 *
 * Returns export metadata including status, item count, and download count.
 */
export function handleGetExportStatus(req: Request, res: Response): void {
  const rid = requestId(req);
  const { id } = req.params as { id: string };
  const stored = exportStore.get(id);

  if (!stored) {
    res.status(404).json(fail(null, `Export ${id} not found`, rid));
    return;
  }

  res.status(200).json(
    ok(
      {
        exportId: stored.id,
        merchantId: stored.merchantId,
        format: stored.format,
        fileName: stored.fileName,
        mimeType: MIME_TYPES[stored.format],
        itemCount: stored.itemCount,
        checksum: stored.checksum,
        createdAt: stored.createdAt,
      },
      undefined,
      rid
    )
  );
}

/**
 * GET /v1/exports/:id/download
 *
 * Streams the export file content with correct Content-Type and
 * Content-Disposition headers, then records the download event.
 */
export function handleDownloadExport(req: Request, res: Response): void {
  const { id } = req.params as { id: string };
  const stored = exportStore.get(id);

  if (!stored) {
    res.status(404).json(fail(null, `Export ${id} not found`));
    return;
  }

  // Record the download in history (best-effort)
  recordExportDownload(id);

  res
    .setHeader('Content-Type', MIME_TYPES[stored.format])
    .setHeader('Content-Disposition', `attachment; filename="${stored.fileName}"`)
    .setHeader('X-Export-Checksum', stored.checksum)
    .setHeader('X-Export-Item-Count', String(stored.itemCount))
    .status(200)
    .send(stored.content);
}

/**
 * PATCH /v1/exports/:id/download
 *
 * Manually records a download event for an export (useful when the client
 * handled delivery outside of the download endpoint).
 */
export function handleRecordDownload(req: Request, res: Response): void {
  const rid = requestId(req);
  const { id } = req.params as { id: string };
  const entry = recordExportDownload(id);

  if (!entry) {
    res.status(404).json(fail(null, `Export history entry ${id} not found`, rid));
    return;
  }

  res.status(200).json(ok(entry, 'Download recorded', rid));
}

/**
 * POST /v1/exports/schedules
 *
 * Body: ExportScheduleInput
 */
export function handleCreateSchedule(req: Request, res: Response): void {
  const rid = requestId(req);

  const input = req.body as Partial<ExportScheduleInput>;

  if (!input.merchantId) {
    res.status(400).json(fail(null, 'merchantId is required', rid));
    return;
  }
  if (!input.format || !SUPPORTED_FORMATS.has(input.format)) {
    res.status(400).json(
      fail(null, `format must be one of: ${[...SUPPORTED_FORMATS].join(', ')}`, rid)
    );
    return;
  }
  if (!input.frequency || !['daily', 'weekly', 'monthly'].includes(input.frequency)) {
    res.status(400).json(fail(null, 'frequency must be daily, weekly, or monthly', rid));
    return;
  }

  try {
    const schedule = createExportSchedule(input as ExportScheduleInput);
    res.status(201).json(ok(schedule, 'Schedule created', rid));
  } catch (error) {
    res.status(500).json(fail(error, 'Failed to create schedule', rid));
  }
}

/**
 * GET /v1/exports/schedules?merchantId=...
 */
export function handleGetSchedules(req: Request, res: Response): void {
  const rid = requestId(req);
  const { merchantId } = req.query as { merchantId?: string };
  const schedules = getExportSchedules(merchantId);
  res.status(200).json(ok(schedules, undefined, rid));
}

/**
 * PATCH /v1/exports/schedules/:id
 *
 * Supports partial update: set enabled, frequency, format, etc.
 * Use `{ "enabled": false }` to pause a schedule.
 */
export function handleUpdateSchedule(req: Request, res: Response): void {
  const rid = requestId(req);
  const { id } = req.params as { id: string };
  const patch = req.body as Partial<ExportScheduleInput & { enabled: boolean }>;

  const updated = updateExportSchedule(id, patch);
  if (!updated) {
    res.status(404).json(fail(null, `Schedule ${id} not found`, rid));
    return;
  }

  res.status(200).json(ok(updated, 'Schedule updated', rid));
}

/**
 * DELETE /v1/exports/schedules/:id
 */
export function handleDeleteSchedule(req: Request, res: Response): void {
  const rid = requestId(req);
  const { id } = req.params as { id: string };
  const deleted = deleteExportSchedule(id);

  if (!deleted) {
    res.status(404).json(fail(null, `Schedule ${id} not found`, rid));
    return;
  }

  res.status(200).json(ok(null, `Schedule ${id} deleted`, rid));
}

/**
 * PATCH /v1/exports/schedules/:id/toggle
 *
 * Body: { "enabled": boolean }
 *
 * Convenience endpoint to enable/disable a schedule.
 */
export function handleToggleSchedule(req: Request, res: Response): void {
  const rid = requestId(req);
  const { id } = req.params as { id: string };
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== 'boolean') {
    res.status(400).json(fail(null, '"enabled" must be a boolean', rid));
    return;
  }

  const updated = toggleExportSchedule(id, enabled);
  if (!updated) {
    res.status(404).json(fail(null, `Schedule ${id} not found`, rid));
    return;
  }

  res.status(200).json(ok(updated, `Schedule ${enabled ? 'enabled' : 'disabled'}`, rid));
}

/**
 * GET /v1/exports/analytics?merchantId=...
 *
 * Returns aggregated analytics: total exports, downloads, format breakdown.
 */
export function handleGetAnalytics(req: Request, res: Response): void {
  const rid = requestId(req);
  const { merchantId } = req.query as { merchantId?: string };
  const analytics = getExportAnalytics(merchantId);
  res.status(200).json(ok(analytics, undefined, rid));
}

/**
 * GET /v1/exports/history?merchantId=...
 *
 * Returns export history log entries.
 */
export function handleGetHistory(req: Request, res: Response): void {
  const rid = requestId(req);
  const { merchantId } = req.query as { merchantId?: string };
  const history = getExportHistory(merchantId);
  res.status(200).json(ok(history, undefined, rid));
}
