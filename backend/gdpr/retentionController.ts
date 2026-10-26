/**
 * Data Retention Controller
 *
 * REST-like controller exposing retention policy management, legal holds and
 * enforcement runs. Designed to be wired into the existing raw http server in server.ts.
 */

import {
  DataRetentionService,
  RetentionPolicyError,
  type DataRetentionPolicy,
  type LegalHoldScope,
} from './dataRetentionService';
import type { GdprApiResponse } from './gdprController';

export class RetentionController {
  constructor(private service: DataRetentionService) {}

  /**
   * GET /gdpr/retention/policies
   */
  handleListPolicies(): GdprApiResponse {
    return { success: true, status: 200, data: this.service.listPolicies() };
  }

  /**
   * PUT /gdpr/retention/policies/:id
   * Body: DataRetentionPolicy without id
   */
  handleUpsertPolicy(policyId: string, body: Omit<DataRetentionPolicy, 'id'>): GdprApiResponse {
    if (!policyId) {
      return { success: false, status: 400, error: 'policy id is required' };
    }
    try {
      const policy = this.service.upsertPolicy({ ...body, id: policyId });
      return { success: true, status: 200, data: policy };
    } catch (err) {
      return this.toError(err);
    }
  }

  /**
   * DELETE /gdpr/retention/policies/:id
   */
  handleRemovePolicy(policyId: string): GdprApiResponse {
    if (!this.service.removePolicy(policyId)) {
      return { success: false, status: 404, error: 'Retention policy not found' };
    }
    return { success: true, status: 200, data: { id: policyId } };
  }

  /**
   * POST /gdpr/retention/enforce
   * Body: { dryRun?: boolean, policyIds?: string[] }
   */
  async handleEnforce(body: { dryRun?: boolean; policyIds?: string[] } = {}): Promise<GdprApiResponse> {
    if (body.policyIds !== undefined && !Array.isArray(body.policyIds)) {
      return { success: false, status: 400, error: 'policyIds must be an array' };
    }
    if (this.service.isRunning()) {
      return { success: false, status: 409, error: 'Retention enforcement is already running' };
    }
    try {
      const report = await this.service.enforce({
        dryRun: body.dryRun === true,
        policyIds: body.policyIds,
      });
      return { success: true, status: 200, data: report };
    } catch (err) {
      return this.toError(err);
    }
  }

  /**
   * GET /gdpr/retention/reports?limit=...
   */
  handleListReports(limit?: number): GdprApiResponse {
    const n = limit === undefined ? 10 : limit;
    if (!Number.isInteger(n) || n < 1) {
      return { success: false, status: 400, error: 'limit must be a positive integer' };
    }
    return { success: true, status: 200, data: this.service.listReports(n) };
  }

  /**
   * POST /gdpr/retention/holds
   * Body: { scope: 'user' | 'record', targetId: string, reason: string, source?: string }
   */
  handlePlaceLegalHold(body: {
    scope: LegalHoldScope;
    targetId: string;
    reason: string;
    source?: string;
  }): GdprApiResponse {
    try {
      return { success: true, status: 201, data: this.service.placeLegalHold(body) };
    } catch (err) {
      return this.toError(err);
    }
  }

  /**
   * POST /gdpr/retention/holds/:id/release
   */
  handleReleaseLegalHold(holdId: string): GdprApiResponse {
    const hold = this.service.releaseLegalHold(holdId);
    if (!hold) {
      return { success: false, status: 404, error: 'Active legal hold not found' };
    }
    return { success: true, status: 200, data: hold };
  }

  /**
   * GET /gdpr/retention/holds
   */
  handleListLegalHolds(): GdprApiResponse {
    return { success: true, status: 200, data: this.service.listLegalHolds() };
  }

  private toError(err: unknown): GdprApiResponse {
    if (err instanceof RetentionPolicyError) {
      const status = err.message.includes('already running') ? 409 : 400;
      return { success: false, status, error: err.message };
    }
    return { success: false, status: 500, error: 'Internal error' };
  }
}
