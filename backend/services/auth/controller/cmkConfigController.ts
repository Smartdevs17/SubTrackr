import { kmsProvider } from '../../shared/encryption';
import { ok, fail } from '../../shared/apiResponse';
import type { ApiResponse } from '../../shared/apiResponse';

export interface CmkConfig {
  keyId: string;
  keyArn: string;
  provider: 'aws_kms' | 'hashicorp_vault';
  enabled: boolean;
  createdAt: string;
}

export class CmkConfigController {
  private cmkConfigs = new Map<string, CmkConfig>();

  getConfig(merchantId: string, requestId?: string): ApiResponse<CmkConfig | null> {
    try {
      const config = this.cmkConfigs.get(merchantId);
      return ok(config ?? null, requestId);
    } catch (err) {
      return fail('INTERNAL_SERVER_ERROR', err instanceof Error ? err.message : 'Failed to get config', requestId);
    }
  }

  setConfig(merchantId: string, config: Omit<CmkConfig, 'createdAt'>, requestId?: string): ApiResponse<CmkConfig> {
    try {
      if (!config.keyId || !config.keyArn) {
        return fail('ENCRYPTION_KEY_NOT_FOUND', 'Key ID and ARN are required', requestId);
      }

      const cmkConfig: CmkConfig = {
        ...config,
        createdAt: new Date().toISOString(),
      };

      kmsProvider.registerMasterKey(config.keyId, config.keyArn);
      this.cmkConfigs.set(merchantId, cmkConfig);

      return ok(cmkConfig, requestId);
    } catch (err) {
      return fail('ENCRYPTION_KEK_NOT_FOUND', err instanceof Error ? err.message : 'Failed to set config', requestId);
    }
  }

  removeConfig(merchantId: string, requestId?: string): ApiResponse<{ removed: boolean }> {
    const existed = this.cmkConfigs.delete(merchantId);
    return ok({ removed: existed }, requestId);
  }
}

export const cmkConfigController = new CmkConfigController();
