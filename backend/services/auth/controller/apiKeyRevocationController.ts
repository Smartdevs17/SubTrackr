import {
  apiKeyRevocationService,
  ApiKeyRevocationService,
} from '../domain/ApiKeyRevocationService';
import { AuthError } from '../errors';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse, ErrorCode } from '../../shared/apiResponse';
import type {
  ApiKeyRevocationAuditEntry,
  LeakDetectionPolicy,
  LeakIncident,
  LeakIncidentStatus,
  LeakScanResult,
} from '../interfaces';

function failFromError(err: unknown, requestId?: string): ApiResponse<never> {
  if (err instanceof AuthError) {
    return fail(
      err.code as ErrorCode,
      err.message,
      requestId,
      err.details as Record<string, string>
    );
  }
  // Plain errors raised by the service are input validation failures.
  return fail(
    'VALIDATION_ERROR',
    err instanceof Error ? err.message : 'Invalid request',
    requestId
  );
}

export class ApiKeyRevocationController {
  constructor(private readonly service: ApiKeyRevocationService = apiKeyRevocationService) {}

  async revoke(
    keyId: string,
    body: { reason?: string; actorId?: string },
    requestId?: string
  ): Promise<ApiResponse<{ keyId: string; status: string; revokedAt: string | null }>> {
    if (!body.actorId) return fail('VALIDATION_ERROR', 'actorId is required', requestId);
    try {
      const record = await this.service.revokeKey(keyId, {
        reason: body.reason ?? 'manual',
        actorId: body.actorId,
      });
      return ok({ keyId, status: record.status, revokedAt: record.revokedAt ?? null }, requestId);
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async revokeAll(
    merchantId: string,
    body: { reason?: string; actorId?: string },
    requestId?: string
  ): Promise<ApiResponse<{ merchantId: string; revoked: number }>> {
    if (!body.actorId) return fail('VALIDATION_ERROR', 'actorId is required', requestId);
    try {
      const revoked = await this.service.revokeAllForMerchant(merchantId, {
        reason: body.reason ?? 'manual_bulk',
        actorId: body.actorId,
      });
      return ok({ merchantId, revoked }, requestId);
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async scan(
    body: { content?: string; hashes?: string[]; source?: string },
    requestId?: string
  ): Promise<ApiResponse<LeakScanResult>> {
    if (body.content === undefined && body.hashes === undefined) {
      return fail('VALIDATION_ERROR', 'content or hashes is required', requestId);
    }
    try {
      const source = body.source ?? 'unknown';
      const results: LeakScanResult[] = [];
      if (body.content !== undefined)
        results.push(await this.service.scanForLeaks(body.content, source));
      if (body.hashes !== undefined)
        results.push(await this.service.checkLeakedHashes(body.hashes, source));
      return ok(
        {
          scannedCandidates: results.reduce((sum, r) => sum + r.scannedCandidates, 0),
          incidents: results.flatMap((r) => r.incidents),
        },
        requestId
      );
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async reportLeak(
    keyId: string,
    body: { source?: string; actorId?: string },
    requestId?: string
  ): Promise<ApiResponse<LeakIncident>> {
    if (!body.actorId) return fail('VALIDATION_ERROR', 'actorId is required', requestId);
    try {
      const incident = await this.service.reportLeak(keyId, {
        source: body.source ?? 'manual',
        actorId: body.actorId,
      });
      return ok(incident, requestId);
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async listIncidents(
    filter: { merchantId?: string; keyId?: string; status?: LeakIncidentStatus },
    requestId?: string
  ): Promise<ApiResponse<LeakIncident[]>> {
    return ok(this.service.getIncidents(filter), requestId);
  }

  async confirmIncident(
    incidentId: string,
    body: { actorId?: string },
    requestId?: string
  ): Promise<ApiResponse<LeakIncident>> {
    if (!body.actorId) return fail('VALIDATION_ERROR', 'actorId is required', requestId);
    try {
      return ok(await this.service.confirmIncident(incidentId, body.actorId), requestId);
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async dismissIncident(
    incidentId: string,
    body: { actorId?: string; reason?: string },
    requestId?: string
  ): Promise<ApiResponse<LeakIncident>> {
    if (!body.actorId) return fail('VALIDATION_ERROR', 'actorId is required', requestId);
    try {
      return ok(
        this.service.dismissIncident(incidentId, body.actorId, body.reason ?? 'false_positive'),
        requestId
      );
    } catch (err) {
      return failFromError(err, requestId);
    }
  }

  async getAuditLog(
    filter: { merchantId?: string; keyId?: string; limit?: number },
    requestId?: string
  ): Promise<ApiResponse<ApiKeyRevocationAuditEntry[]>> {
    return ok(this.service.getAuditLog(filter), requestId);
  }

  async getPolicy(
    merchantId: string,
    requestId?: string
  ): Promise<ApiResponse<LeakDetectionPolicy>> {
    return ok(this.service.getPolicy(merchantId), requestId);
  }

  async updatePolicy(
    merchantId: string,
    patch: Partial<LeakDetectionPolicy>,
    requestId?: string
  ): Promise<ApiResponse<LeakDetectionPolicy>> {
    try {
      return ok(this.service.updatePolicy(merchantId, patch), requestId);
    } catch (err) {
      return failFromError(err, requestId);
    }
  }
}

export const apiKeyRevocationController = new ApiKeyRevocationController();
