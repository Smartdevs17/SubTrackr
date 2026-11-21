'use server';

/**
 * Developer lifecycle server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * These actions wrap the DeveloperLifecycleService (formerly
 * DeveloperPortalService in developerPortalService.ts) with zod-validated
 * inputs, typed results, and observability hooks.
 */

import { developerPortalService } from '../services/developerPortalService';
import {
  registerDeveloperSchema,
  verifyEmailSchema,
  completeOnboardingSchema,
  getDeveloperSchema,
  updateDeveloperSchema,
} from './schemas';
import { ok, fail, VALIDATION_ERROR, NOT_FOUND, CONFLICT, type ActionResult } from './result';
import { withAction, zodIssuesToFieldErrors, portalLogger } from './observability';
import type { Developer } from '../types/developer';
import type { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// registerDeveloper
// ─────────────────────────────────────────────────────────────────────────────

export async function registerDeveloperAction(input: unknown): Promise<ActionResult<Developer>> {
  return withAction('developer.register', async () => {
    const parsed = registerDeveloperSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { email, name, company } = parsed.data;

    try {
      const developer = await developerPortalService.registerDeveloper(email, name, company);
      portalLogger.info('developer.registered', { developerId: developer.id, email });
      return ok(developer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists')) {
        return fail(CONFLICT, message);
      }
      throw err;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyEmail
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyEmailAction(
  input: unknown
): Promise<ActionResult<{ verified: boolean }>> {
  return withAction('developer.verifyEmail', async () => {
    const parsed = verifyEmailSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, token } = parsed.data;

    const verified = await developerPortalService.verifyEmail(developerId, token);
    if (!verified) {
      return fail(NOT_FOUND, 'Email verification failed: token or developer not found');
    }
    return ok({ verified: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// completeOnboarding
// ─────────────────────────────────────────────────────────────────────────────

export async function completeOnboardingAction(input: unknown): Promise<ActionResult<Developer>> {
  return withAction('developer.completeOnboarding', async () => {
    const parsed = completeOnboardingSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId } = parsed.data;

    const developer = await developerPortalService.completeOnboarding(developerId);
    if (!developer) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    return ok(developer);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getDeveloper
// ─────────────────────────────────────────────────────────────────────────────

export async function getDeveloperAction(input: unknown): Promise<ActionResult<Developer>> {
  return withAction('developer.get', async () => {
    const parsed = getDeveloperSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId } = parsed.data;

    const developer = await developerPortalService.getDeveloper(developerId);
    if (!developer) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    return ok(developer);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDeveloper
// ─────────────────────────────────────────────────────────────────────────────

export async function updateDeveloperAction(input: unknown): Promise<ActionResult<Developer>> {
  return withAction('developer.update', async () => {
    const parsed = updateDeveloperSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { developerId, name, company, tier, status, ...rest } = parsed.data;

    const updates: Partial<Developer> = {};
    if (name !== undefined) updates.name = name;
    if (company !== undefined) updates.company = company;
    if (tier !== undefined) updates.tier = tier;
    if (status !== undefined) updates.status = status;

    const developer = await developerPortalService.updateDeveloper(developerId, updates);
    if (!developer) {
      return fail(NOT_FOUND, `Developer not found: ${developerId}`);
    }
    return ok(developer);
  });
}
