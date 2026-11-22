'use server';

/**
 * Documentation and integration-guide server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Wraps DocumentationService and IntegrationGuidesService with zod-validated
 * inputs, typed results, and observability.  These services were previously
 * not exported from the portal barrel — they are now reachable through the
 * actions layer.
 */

import { DocumentationService } from '../services/documentationService';
import { IntegrationGuidesService } from '../services/integrationGuidesService';
import { developerPortalService } from '../services/developerPortalService';
import {
  getDocumentationSchema,
  searchDocumentationSchema,
  getArticleSchema,
  getIntegrationGuidesSchema,
  getIntegrationGuideSchema,
} from './schemas';
import { ok, fail, VALIDATION_ERROR, NOT_FOUND, type ActionResult } from './result';
import { withAction, zodIssuesToFieldErrors } from './observability';
import type { DocumentationArticle, DocumentationSection, IntegrationGuide } from '../types/portal';
import type { Documentation } from '../types/developer';

// ─────────────────────────────────────────────────────────────────────────────
// Service singletons (lazily created on first import)
// ─────────────────────────────────────────────────────────────────────────────

const documentationService = new DocumentationService();
const integrationGuidesService = new IntegrationGuidesService();

// ─────────────────────────────────────────────────────────────────────────────
// getDocumentation
// ─────────────────────────────────────────────────────────────────────────────

export async function getDocumentationAction(
  input: unknown
): Promise<ActionResult<Documentation[]>> {
  return withAction('documentation.list', async () => {
    const parsed = getDocumentationSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { category } = parsed.data;

    // Uses DeveloperLifecycleService.getDocumentation() which returns published
    // docs, optionally filtered by category.
    const docs = await developerPortalService.getDocumentation(category);
    return ok(docs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getDocumentationSections
// ─────────────────────────────────────────────────────────────────────────────

export async function getDocumentationSectionsAction(): Promise<
  ActionResult<DocumentationSection[]>
> {
  return withAction('documentation.getSections', async () => {
    const sections = await documentationService.getSections();
    return ok(sections);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getArticle
// ─────────────────────────────────────────────────────────────────────────────

export async function getArticleAction(
  input: unknown
): Promise<ActionResult<DocumentationArticle>> {
  return withAction('documentation.getArticle', async () => {
    const parsed = getArticleSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { slug } = parsed.data;

    const article = await documentationService.getArticle(slug);
    if (!article) {
      return fail(NOT_FOUND, `Article not found: ${slug}`);
    }
    return ok(article);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// searchDocumentation
// ─────────────────────────────────────────────────────────────────────────────

export async function searchDocumentationAction(
  input: unknown
): Promise<ActionResult<DocumentationArticle[]>> {
  return withAction('documentation.search', async () => {
    const parsed = searchDocumentationSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { query } = parsed.data;

    const results = await documentationService.searchArticles(query);
    return ok(results);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getIntegrationGuides
// ─────────────────────────────────────────────────────────────────────────────

export async function getIntegrationGuidesAction(
  input: unknown
): Promise<ActionResult<IntegrationGuide[]>> {
  return withAction('guides.list', async () => {
    const parsed = getIntegrationGuidesSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { platform } = parsed.data;

    // IntegrationGuidesService.getGuides() returns all guides; filtering by
    // platform is done here since the service's getIntegrationGuides method
    // (on DeveloperLifecycleService) is not populated.
    if (platform) {
      const allGuides = await integrationGuidesService.getGuides();
      const filtered = allGuides.filter(
        (g) =>
          g.id.includes(platform.toLowerCase()) ||
          g.title.toLowerCase().includes(platform.toLowerCase())
      );
      return ok(filtered);
    }

    const guides = await integrationGuidesService.getGuides();
    return ok(guides);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getIntegrationGuide
// ─────────────────────────────────────────────────────────────────────────────

export async function getIntegrationGuideAction(
  input: unknown
): Promise<ActionResult<IntegrationGuide>> {
  return withAction('guides.get', async () => {
    const parsed = getIntegrationGuideSchema.safeParse(input);
    if (!parsed.success) {
      return fail(VALIDATION_ERROR, 'Invalid input', zodIssuesToFieldErrors(parsed.error));
    }
    const { guideId } = parsed.data;

    const guide = await integrationGuidesService.getGuide(guideId);
    if (!guide) {
      return fail(NOT_FOUND, `Integration guide not found: ${guideId}`);
    }
    return ok(guide);
  });
}
