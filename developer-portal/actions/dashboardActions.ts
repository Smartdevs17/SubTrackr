'use server';

/**
 * Dashboard server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 */

import { developerPortalService } from '../services/developerPortalService';
import { getDashboardSchema } from './schemas';
import { ok, fail, VALIDATION_ERROR, NOT_FOUND, type ActionResult } from './result';
import { withAction, zodIssuesToFieldErrors } from './observability';
import type { DeveloperDashboard } from '../types/developer';

// ─────────────────────────────────────────────────────────────────────────────
// getDashboard
// ─────────────────────────────────────────────────────────────────────────────

export async function getDashboardAction(
  input: unknown
): Promise<ActionResult<DeveloperDashboard>> {
  return withAction('dashboard.get', async () => {
    const parsed = getDashboardSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId } = parsed.data;

    const dashboard = await developerPortalService.getDashboard(developerId);
    if (!dashboard) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    return ok(dashboard);
  });
}
