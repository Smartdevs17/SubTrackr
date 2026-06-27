import { apiKeyRotationService } from '../domain/ApiKeyRotationService';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse } from '../../shared/apiResponse';
import type { ApiKeyRotationPolicy } from '../interfaces';

export class RotationConfigController {
  async getPolicy(merchantId: string, requestId?: string): Promise<ApiResponse<ApiKeyRotationPolicy>> {
    try {
      const policy = await apiKeyRotationService.getPolicy(merchantId);
      return ok(policy, requestId);
    } catch (err) {
      return fail('INTERNAL_SERVER_ERROR', err instanceof Error ? err.message : 'Failed to get policy', requestId);
    }
  }

  async updatePolicy(
    merchantId: string,
    policy: Partial<ApiKeyRotationPolicy>,
    requestId?: string
  ): Promise<ApiResponse<ApiKeyRotationPolicy>> {
    try {
      const updated = await apiKeyRotationService.updatePolicy(merchantId, policy);
      return ok(updated, requestId);
    } catch (err) {
      return fail('INTERNAL_SERVER_ERROR', err instanceof Error ? err.message : 'Failed to update policy', requestId);
    }
  }

  async forceRotate(keyId: string, requestId?: string): Promise<ApiResponse<{ keyId: string; status: string }>> {
    try {
      const record = await apiKeyRotationService.forceRotateKey(keyId);
      return ok({ keyId: record.id, status: 'revoked' }, requestId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return fail('AUTH_API_KEY_NOT_FOUND', err.message, requestId);
      }
      return fail('AUTH_API_KEY_ROTATION_FAILED', err instanceof Error ? err.message : 'Rotation failed', requestId);
    }
  }
}

export const rotationConfigController = new RotationConfigController();
