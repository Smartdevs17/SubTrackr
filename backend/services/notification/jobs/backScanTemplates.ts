/**
 * Back-scan job for pre-existing notification templates.
 *
 * Issue #611 edge case: templates saved before server-side sanitization was
 * introduced may already contain malicious HTML. This cron scans every stored
 * template, and for any whose body changes under sanitization it:
 *   1. quarantines the original (flags it so it is not sent/previewed raw), and
 *   2. stores the sanitized body so the template remains usable.
 *
 * The job is idempotent — clean templates are left untouched and re-running it
 * is a no-op.
 */

import { htmlSanitizer } from '../../../shared/sanitizer';
import type {
  NotificationTemplate,
  TemplateRepository,
} from '../templateService';

export interface BackScanResult {
  scanned: number;
  quarantined: number;
  /** IDs of templates that contained unsafe content. */
  quarantinedIds: string[];
}

export interface BackScanOptions {
  /** When true, report findings without writing changes. Default: false. */
  dryRun?: boolean;
}

export class BackScanTemplatesJob {
  constructor(private readonly repo: TemplateRepository) {}

  async run(options: BackScanOptions = {}): Promise<BackScanResult> {
    const templates = await this.repo.list();
    const result: BackScanResult = { scanned: 0, quarantined: 0, quarantinedIds: [] };

    for (const template of templates) {
      result.scanned += 1;
      const { clean, modified } = await htmlSanitizer.sanitize(template.body);
      if (!modified) continue;

      result.quarantined += 1;
      result.quarantinedIds.push(template.id);

      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'template_quarantined',
          templateId: template.id,
          message: 'Pre-existing template contained unsafe HTML; sanitized and quarantined',
        }),
      );

      if (!options.dryRun) {
        const sanitized: NotificationTemplate = {
          ...template,
          body: clean,
          quarantined: true,
          updatedAt: new Date().toISOString(),
        };
        await this.repo.save(sanitized);
      }
    }

    return result;
  }
}

/**
 * Cron entry point. Wire this to the scheduler (e.g. daily) with a concrete
 * repository implementation.
 */
export async function runBackScanTemplates(
  repo: TemplateRepository,
  options?: BackScanOptions,
): Promise<BackScanResult> {
  return new BackScanTemplatesJob(repo).run(options);
}
