'use server';

/**
 * Usage tracking server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 */

import { developerPortalService } from '../services/developerPortalService';
import { getUsageMetricsSchema, trackUsageSchema } from './schemas';
import { ok, fail, VALIDATION_ERROR, NOT_FOUND, type ActionResult } from './result';
import { withAction, zodIssuesToFieldErrors } from './observability';
import type { UsageMetrics } from '../types/developer';

// ─────────────────────────────────────────────────────────────────────────────
// getUsageMetrics
// ─────────────────────────────────────────────────────────────────────────────

export async function getUsageMetricsAction(input: unknown): Promise<ActionResult<UsageMetrics>> {
  return withAction('usage.getMetrics', async () => {
    const parsed = getUsageMetricsSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId } = parsed.data;

    const metrics = await developerPortalService.getUsageMetrics(developerId);
    if (!metrics) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    return ok(metrics);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// trackUsage
// ─────────────────────────────────────────────────────────────────────────────

export async function trackUsageAction(
  input: unknown
): Promise<ActionResult<{ tracked: boolean }>> {
  return withAction('usage.track', async () => {
    const parsed = trackUsageSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, endpoint, method, responseTime, success } = parsed.data;

    // trackUsage is a no-op for unknown developers; we surface that as NOT_FOUND
    // so callers know the developer doesn't exist.
    const developer = await developerPortalService.getDeveloper(developerId);
    if (!developer) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }

    await developerPortalService.trackUsage(developerId, endpoint, method, responseTime, success);
    return ok({ tracked: true });
  });
}
