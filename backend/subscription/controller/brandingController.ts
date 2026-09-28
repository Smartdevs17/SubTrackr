/**
 * Tenant branding controller (Issue #1110).
 *
 *   GET /branding          – branding for the calling merchant
 *   PUT /branding          – create/merge branding (logo, colors, fonts)
 *   GET /branding/portal   – portal theme JSON + CSS stylesheet
 */

import type { Request, Response } from 'express';
import { fail, ok, type ErrorCode } from '../../services/shared/apiResponse';
import { extractRequestId } from './index';
import {
  brandingToCssVariables,
  brandingToStylesheet,
  mergeBranding,
  portalBrandingStore,
  validateBranding,
  type PortalBranding,
} from '../../domain/portalBranding';

function merchantIdOf(req: Request): string {
  const raw = req.headers['x-merchant-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || 'default';
}

function reject(
  res: Response,
  req: Request,
  code: ErrorCode,
  message: string,
  status: number
): void {
  res.status(status).json(fail(code, message, extractRequestId(req)));
}

/** GET /api/v1/merchant/branding */
export function getBranding(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const branding =
    portalBrandingStore.get(merchantId) ??
    portalBrandingStore.upsert(merchantId, { brandName: merchantId });

  res.status(200).json(ok(branding, extractRequestId(req)));
}

/** PUT /api/v1/merchant/branding */
export function updateBranding(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const body = (req.body ?? {}) as Partial<PortalBranding>;

  const validation = validateBranding(body);
  if (!validation.valid) {
    reject(
      res,
      req,
      'VALIDATION_ERROR',
      `Invalid branding: ${validation.errors.join(' ')}`,
      422
    );
    return;
  }

  const branding = portalBrandingStore.upsert(merchantId, body);
  res.status(200).json(ok(branding, extractRequestId(req)));
}

/** GET /api/v1/merchant/branding/portal */
export function getPortalTheme(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const branding =
    portalBrandingStore.get(merchantId) ??
    portalBrandingStore.upsert(merchantId, { brandName: merchantId });

  res.status(200).json(
    ok(
      {
        merchantId: branding.merchantId,
        brandName: branding.brandName,
        cssVariables: brandingToCssVariables(branding),
        stylesheet: brandingToStylesheet(branding),
        logo: branding.logo ?? null,
        colors: branding.colors,
        fonts: branding.fonts ?? null,
        updatedAt: branding.updatedAt,
      },
      extractRequestId(req),
    ),
  );
}

/** Apply a patch without going through HTTP – used by tests and services. */
export function patchBranding(merchantId: string, patch: Partial<PortalBranding>): PortalBranding {
  const existing = portalBrandingStore.get(merchantId);
  if (existing) return mergeBranding(existing, patch);
  return portalBrandingStore.upsert(merchantId, patch);
}
