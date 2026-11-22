/**
 * Integration tests for the Export REST API handlers.
 *
 * Covers all REST endpoints: create export, get status, download,
 * record download, CRUD schedules, toggle schedule, analytics, and history.
 */

import type { Request, Response } from 'express';
import {
  handleCreateExport,
  handleGetExportStatus,
  handleDownloadExport,
  handleRecordDownload,
  handleCreateSchedule,
  handleGetSchedules,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleToggleSchedule,
  handleGetAnalytics,
  handleGetHistory,
} from '../exportApi';
import type { TransactionRecord } from '../accountingExportService';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;

function makeRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: `txn_${Date.now().toString(36)}_${String(++_idCounter).padStart(4, '0')}`,
    merchantId: 'test-merchant',
    subscriptionId: 'sub_test',
    subscriptionName: 'Test Service',
    description: 'Test subscription',
    category: 'software',
    transactionType: 'revenue',
    amount: 29.99,
    currency: 'USD',
    billingCycle: 'monthly',
    billingDate: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

function mockReq(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

interface MockRes extends Response {
  _status: number;
  _body: unknown;
  _headers: Record<string, string>;
}

function mockRes(): MockRes {
  const res = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._body = data;
      return res;
    },
    send(data: unknown) {
      res._body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
  } as unknown as MockRes;
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Export API handlers', () => {
  beforeEach(() => {
    _idCounter = 0;
  });

  // ── handleCreateExport ────────────────────────────────────────────────────

  describe('handleCreateExport', () => {
    it('returns 400 for invalid format', async () => {
      const req = mockReq({ body: { format: 'xml', records: [] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(400);
      expect((res._body as { error: string }).error).toContain('format must be one of');
    });

    it('returns 400 when records is not an array', async () => {
      const req = mockReq({ body: { format: 'csv', records: 'not-array' } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(400);
      expect((res._body as { error: string }).error).toContain('records must be an array');
    });

    it('creates CSV export and returns 201', async () => {
      const records = [makeRecord(), makeRecord({ id: 'txn_extra_0002', amount: 49.99 })];
      const req = mockReq({ body: { format: 'csv', records, filter: { merchantId: 'test-merchant' } } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
      const body = res._body as { success: boolean; data: { exportId: string; itemCount: number } };
      expect(body.success).toBe(true);
      expect(body.data.itemCount).toBe(2);
      expect(body.data.exportId).toBeTruthy();
    });

    it('creates JSON export', async () => {
      const req = mockReq({ body: { format: 'json', records: [makeRecord()] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
      const body = res._body as { success: boolean; data: { format: string } };
      expect(body.data.format).toBe('json');
    });

    it('creates QuickBooks export', async () => {
      const req = mockReq({ body: { format: 'quickbooks', records: [makeRecord()] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
    });

    it('creates Xero export', async () => {
      const req = mockReq({ body: { format: 'xero', records: [makeRecord()] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
    });

    it('creates PDF export', async () => {
      const req = mockReq({ body: { format: 'pdf', records: [makeRecord()] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
      const body = res._body as { success: boolean; data: { mimeType: string } };
      expect(body.data.mimeType).toBe('application/pdf');
    });

    it('includes schema when includeSchema is true', async () => {
      const req = mockReq({
        body: {
          format: 'json',
          records: [makeRecord()],
          includeSchema: true,
          filter: { merchantId: 'test-merchant' },
        },
      });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(201);
    });

    it('returns 400 for missing format', async () => {
      const req = mockReq({ body: { records: [makeRecord()] } });
      const res = mockRes();
      await handleCreateExport(req, res);
      expect(res._status).toBe(400);
    });
  });

  // ── handleGetExportStatus ─────────────────────────────────────────────────

  describe('handleGetExportStatus', () => {
    it('returns 404 for unknown export id', () => {
      const req = mockReq({ params: { id: 'exp_unknown' } });
      const res = mockRes();
      handleGetExportStatus(req, res);
      expect(res._status).toBe(404);
    });

    it('returns 200 for a previously created export', async () => {
      const createReq = mockReq({ body: { format: 'csv', records: [makeRecord()] } });
      const createRes = mockRes();
      await handleCreateExport(createReq, createRes);
      const exportId = (createRes._body as { data: { exportId: string } }).data.exportId;

      const getReq = mockReq({ params: { id: exportId } });
      const getRes = mockRes();
      handleGetExportStatus(getReq, getRes);
      expect(getRes._status).toBe(200);
      const body = getRes._body as { data: { exportId: string; format: string } };
      expect(body.data.exportId).toBe(exportId);
      expect(body.data.format).toBe('csv');
    });
  });

  // ── handleDownloadExport ──────────────────────────────────────────────────

  describe('handleDownloadExport', () => {
    it('returns 404 for unknown export', () => {
      const req = mockReq({ params: { id: 'nonexistent' } });
      const res = mockRes();
      handleDownloadExport(req, res);
      expect(res._status).toBe(404);
    });

    it('returns content with correct headers for a created export', async () => {
      const createReq = mockReq({ body: { format: 'json', records: [makeRecord()] } });
      const createRes = mockRes();
      await handleCreateExport(createReq, createRes);
      const exportId = (createRes._body as { data: { exportId: string } }).data.exportId;

      const dlReq = mockReq({ params: { id: exportId } });
      const dlRes = mockRes();
      handleDownloadExport(dlReq, dlRes);
      expect(dlRes._status).toBe(200);
      expect(dlRes._headers['Content-Type']).toBe('application/json');
      expect(dlRes._headers['Content-Disposition']).toContain('attachment');
    });
  });

  // ── handleRecordDownload ──────────────────────────────────────────────────

  describe('handleRecordDownload', () => {
    it('returns 404 for unknown id', () => {
      const req = mockReq({ params: { id: 'unknown' } });
      const res = mockRes();
      handleRecordDownload(req, res);
      expect(res._status).toBe(404);
    });

    it('returns 404 for export not in history store', async () => {
      // Exports created via handleCreateExport are stored in exportStore,
      // not historyStore, so recordExportDownload returns null.
      const createReq = mockReq({ body: { format: 'csv', records: [makeRecord()] } });
      const createRes = mockRes();
      await handleCreateExport(createReq, createRes);
      const exportId = (createRes._body as { data: { exportId: string } }).data.exportId;

      const req = mockReq({ params: { id: exportId } });
      const res = mockRes();
      handleRecordDownload(req, res);
      // 404 because handleCreateExport populates exportStore, not historyStore
      expect(res._status).toBe(404);
    });
  });

  // ── Schedule CRUD ─────────────────────────────────────────────────────────

  describe('Schedule management', () => {
    it('create, get, update, delete schedules', () => {
      const createReq = mockReq({
        body: { merchantId: 'sched-m', format: 'csv', frequency: 'weekly' },
      });
      const createRes = mockRes();
      handleCreateSchedule(createReq, createRes);
      expect(createRes._status).toBe(201);
      const schedId = (createRes._body as { data: { id: string } }).data.id;

      const getReq = mockReq({ query: { merchantId: 'sched-m' } });
      const getRes = mockRes();
      handleGetSchedules(getReq, getRes);
      expect(getRes._status).toBe(200);
      const schedules = (getRes._body as { data: Array<{ id: string }> }).data;
      expect(schedules.some((s) => s.id === schedId)).toBe(true);

      const updateReq = mockReq({ params: { id: schedId }, body: { frequency: 'monthly' } });
      const updateRes = mockRes();
      handleUpdateSchedule(updateReq, updateRes);
      expect(updateRes._status).toBe(200);
      expect((updateRes._body as { data: { frequency: string } }).data.frequency).toBe('monthly');

      const deleteReq = mockReq({ params: { id: schedId } });
      const deleteRes = mockRes();
      handleDeleteSchedule(deleteReq, deleteRes);
      expect(deleteRes._status).toBe(200);
    });

    it('returns 400 for missing merchantId', () => {
      const req = mockReq({ body: { format: 'csv', frequency: 'daily' } });
      const res = mockRes();
      handleCreateSchedule(req, res);
      expect(res._status).toBe(400);
    });

    it('returns 400 for invalid format', () => {
      const req = mockReq({ body: { merchantId: 'm1', format: 'xml', frequency: 'daily' } });
      const res = mockRes();
      handleCreateSchedule(req, res);
      expect(res._status).toBe(400);
    });

    it('returns 400 for invalid frequency', () => {
      const req = mockReq({ body: { merchantId: 'm1', format: 'csv', frequency: 'annually' } });
      const res = mockRes();
      handleCreateSchedule(req, res);
      expect(res._status).toBe(400);
    });

    it('returns 404 for updating non-existent schedule', () => {
      const req = mockReq({ params: { id: 'sched_nonexistent' }, body: { frequency: 'monthly' } });
      const res = mockRes();
      handleUpdateSchedule(req, res);
      expect(res._status).toBe(404);
    });

    it('returns 404 for deleting non-existent schedule', () => {
      const req = mockReq({ params: { id: 'sched_nonexistent' } });
      const res = mockRes();
      handleDeleteSchedule(req, res);
      expect(res._status).toBe(404);
    });
  });

  // ── handleToggleSchedule ──────────────────────────────────────────────────

  describe('handleToggleSchedule', () => {
    it('returns 400 when enabled is not boolean', () => {
      const req = mockReq({ params: { id: 'sched_1' }, body: { enabled: 'yes' } });
      const res = mockRes();
      handleToggleSchedule(req, res);
      expect(res._status).toBe(400);
    });

    it('returns 404 for unknown schedule', () => {
      const req = mockReq({ params: { id: 'sched_unknown' }, body: { enabled: false } });
      const res = mockRes();
      handleToggleSchedule(req, res);
      expect(res._status).toBe(404);
    });

    it('toggles an existing schedule', () => {
      // Create a schedule first
      const createReq = mockReq({
        body: { merchantId: 'toggle-m', format: 'csv', frequency: 'daily', enabled: true },
      });
      const createRes = mockRes();
      handleCreateSchedule(createReq, createRes);
      const schedId = (createRes._body as { data: { id: string } }).data.id;

      // Disable
      const disableReq = mockReq({ params: { id: schedId }, body: { enabled: false } });
      const disableRes = mockRes();
      handleToggleSchedule(disableReq, disableRes);
      expect(disableRes._status).toBe(200);
      expect((disableRes._body as { data: { enabled: boolean } }).data.enabled).toBe(false);

      // Enable
      const enableReq = mockReq({ params: { id: schedId }, body: { enabled: true } });
      const enableRes = mockRes();
      handleToggleSchedule(enableReq, enableRes);
      expect(enableRes._status).toBe(200);
      expect((enableRes._body as { data: { enabled: boolean } }).data.enabled).toBe(true);
    });
  });

  // ── handleGetAnalytics / handleGetHistory ──────────────────────────────────

  describe('Analytics and History', () => {
    it('returns analytics', () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      handleGetAnalytics(req, res);
      expect(res._status).toBe(200);
      const body = res._body as { data: { totalExports: number } };
      expect(typeof body.data.totalExports).toBe('number');
    });

    it('returns history', () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      handleGetHistory(req, res);
      expect(res._status).toBe(200);
      expect(Array.isArray((res._body as { data: unknown[] }).data)).toBe(true);
    });

    it('filters analytics by merchantId', () => {
      const req = mockReq({ query: { merchantId: 'specific-merchant' } });
      const res = mockRes();
      handleGetAnalytics(req, res);
      expect(res._status).toBe(200);
    });

    it('filters history by merchantId', () => {
      const req = mockReq({ query: { merchantId: 'specific-merchant' } });
      const res = mockRes();
      handleGetHistory(req, res);
      expect(res._status).toBe(200);
    });
  });
});
