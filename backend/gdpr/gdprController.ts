/**
 * GDPR Controller
 *
 * REST-like controller that exposes data export and deletion endpoints.
 * Designed to be wired into the existing raw http server in server.ts.
 */

import { DataExportService, type DataExportResult } from './dataExportService';
import { DataDeletionService, type DeletionRequest, type DeletionResult } from './dataDeletionService';
import type { ExportLevel } from './piiRegistry';

export interface GdprControllerDeps {
  exportService: DataExportService;
  deletionService: DataDeletionService;
}

export interface GdprApiResponse {
  success: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

export class GdprController {
  constructor(private deps: GdprControllerDeps) {}

  /**
   * POST /gdpr/export — initiate a data export
   * Body: { userId: string, exportLevel?: 'full' | 'pseudonymized' | 'anonymized' }
   */
  async handleExportRequest(body: { userId: string; exportLevel?: ExportLevel }): Promise<GdprApiResponse> {
    if (!body.userId) {
      return { success: false, status: 400, error: 'userId is required' };
    }

    const exportLevel: ExportLevel = body.exportLevel ?? 'full';
    if (!['full', 'pseudonymized', 'anonymized'].includes(exportLevel)) {
      return { success: false, status: 400, error: 'Invalid exportLevel' };
    }

    const result = await this.deps.exportService.exportUserData({
      userId: body.userId,
      exportLevel,
      requestedAt: Date.now(),
      requestId: crypto.randomUUID(),
    });

    return { success: true, status: 200, data: result };
  }

  /**
   * POST /gdpr/deletion — create a deletion request (enters grace period)
   * Body: { userId: string }
   */
  handleCreateDeletionRequest(body: { userId: string }): GdprApiResponse {
    if (!body.userId) {
      return { success: false, status: 400, error: 'userId is required' };
    }

    if (this.deps.deletionService.hasActiveDeletionRequest(body.userId)) {
      return { success: false, status: 409, error: 'User already has an active deletion request' };
    }

    const request = this.deps.deletionService.createDeletionRequest(body.userId);
    return { success: true, status: 201, data: request };
  }

  /**
   * POST /gdpr/deletion/:id/cancel — cancel a deletion request during grace period
   * Body: { userId: string }
   */
  handleCancelDeletionRequest(requestId: string, body: { userId: string }): GdprApiResponse {
    if (!body.userId) {
      return { success: false, status: 400, error: 'userId is required' };
    }
    const result = this.deps.deletionService.cancelDeletionRequest(requestId, body.userId);
    if (!result.success) {
      return { success: false, status: 400, error: result.error };
    }
    return { success: true, status: 200, data: result.request };
  }

  /**
   * POST /gdpr/deletion/:id/execute — execute the deletion (after grace period)
   */
  async handleExecuteDeletion(requestId: string): Promise<GdprApiResponse> {
    const result = await this.deps.deletionService.executeDeletion(requestId);
    if (!result.success) {
      return { success: false, status: 400, error: result.error };
    }
    return { success: true, status: 200, data: result.request };
  }

  /**
   * GET /gdpr/deletion/:id — get deletion request status
   */
  handleGetDeletionRequest(requestId: string): GdprApiResponse {
    const request = this.deps.deletionService.getDeletionRequest(requestId);
    if (!request) {
      return { success: false, status: 404, error: 'Deletion request not found' };
    }
    return { success: true, status: 200, data: request };
  }

  /**
   * GET /gdpr/deletion?userId=... — list deletion requests for a user
   */
  handleListDeletionRequests(userId: string): GdprApiResponse {
    if (!userId) {
      return { success: false, status: 400, error: 'userId is required' };
    }
    const requests = this.deps.deletionService.listDeletionRequests(userId);
    return { success: true, status: 200, data: requests };
  }
}
