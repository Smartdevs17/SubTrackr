/**
 * Asset Policy Controller – per-merchant allowlist/denylist for accepted assets.
 *
 * Routes:
 *   GET  /merchants/:merchantId/asset-policy   – list rules
 *   PUT  /merchants/:merchantId/asset-policy   – replace rules
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1717
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../shared/apiResponse';
import {
  AssetPolicyService,
  assetPolicyService as defaultService,
  AssetNotAllowedError,
} from '../domain/AssetPolicyService';

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

function send<T>(res: Response, response: ApiResponse<T>, statusOverride?: number): void {
  if (response.success) {
    res.status(statusOverride ?? 200).json(response);
    return;
  }
  res.status(statusOverride ?? 400).json(response);
}

export class AssetPolicyController {
  constructor(private readonly service: AssetPolicyService = defaultService) {}

  /** GET /merchants/:merchantId/asset-policy */
  async getPolicy(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const merchantId = req.params.merchantId;

    if (!merchantId) {
      send(res, fail('VALIDATION_ERROR', 'merchantId is required', requestId));
      return;
    }

    try {
      const rules = await this.service.getPolicy(merchantId);
      send(res, ok({ merchantId, rules }, requestId));
    } catch (err) {
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }

  /** PUT /merchants/:merchantId/asset-policy */
  async setPolicy(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const merchantId = req.params.merchantId;
    const body = req.body as {
      rules?: Array<{
        chain: 'stellar' | 'evm' | 'fiat';
        assetCode: string;
        assetIssuer?: string;
        mode: 'allow' | 'deny';
      }>;
    };

    if (!merchantId) {
      send(res, fail('VALIDATION_ERROR', 'merchantId is required', requestId));
      return;
    }

    if (!Array.isArray(body?.rules)) {
      send(res, fail('VALIDATION_ERROR', 'rules array is required', requestId));
      return;
    }

    for (const rule of body.rules) {
      if (!rule.chain || !rule.assetCode || !rule.mode) {
        send(res, fail('VALIDATION_ERROR', 'each rule requires chain, assetCode and mode', requestId));
        return;
      }
      if (rule.mode !== 'allow' && rule.mode !== 'deny') {
        send(res, fail('VALIDATION_ERROR', 'mode must be "allow" or "deny"', requestId));
        return;
      }
    }

    try {
      const rules = await this.service.setPolicy(merchantId, body.rules);
      send(res, ok({ merchantId, rules }, requestId), 200);
    } catch (err) {
      if (err instanceof AssetNotAllowedError) {
        send(res, fail('ASSET_NOT_ALLOWED', err.message, requestId), 400);
        return;
      }
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }

  /** POST /payments/assets/check – evaluate a single asset against merchant policy */
  async checkAsset(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const body = req.body as {
      merchantId?: string;
      chain?: 'stellar' | 'evm' | 'fiat';
      asset?: string;
      issuer?: string;
    };

    if (!body?.merchantId || !body.chain || !body.asset) {
      send(res, fail('VALIDATION_ERROR', 'merchantId, chain and asset are required', requestId));
      return;
    }

    try {
      const allowed = await this.service.isAllowed({
        merchantId: body.merchantId,
        chain: body.chain,
        asset: body.asset,
        issuer: body.issuer,
      });
      send(res, ok({ merchantId: body.merchantId, asset: body.asset, allowed }, requestId));
    } catch (err) {
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }
}

export const assetPolicyController = new AssetPolicyController();
export default assetPolicyController;
