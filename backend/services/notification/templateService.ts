/**
 * Notification/email template service with XSS-safe rich-text handling.
 *
 * Issue #611: rich-text template fields (subject is plain text; body is HTML)
 * must be sanitized server-side on save so stored content can never carry
 * executable markup. A preview renders the *sanitized* output so admins see
 * exactly what recipients will get.
 */

import { htmlSanitizer, type SanitizeResult } from '../../shared/sanitizer';

export interface NotificationTemplate {
  id: string;
  /** Plain-text subject line (no HTML). */
  subject: string;
  /** Rich-text HTML body. Always stored already-sanitized. */
  body: string;
  updatedAt: string;
  /** Set by the back-scan job when pre-existing content was unsafe. */
  quarantined?: boolean;
}

export interface TemplateInput {
  id: string;
  subject: string;
  body: string;
}

/** Storage abstraction — implemented by the persistence layer. */
export interface TemplateRepository {
  save(template: NotificationTemplate): Promise<void>;
  get(id: string): Promise<NotificationTemplate | null>;
  list(): Promise<NotificationTemplate[]>;
}

export interface SaveTemplateResult {
  template: NotificationTemplate;
  /** True when the submitted body contained content that was stripped. */
  sanitized: boolean;
  removedCount: number;
}

export class TemplateService {
  constructor(private readonly repo: TemplateRepository) {}

  /** Strip HTML from the subject line entirely — subjects are plain text. */
  private async cleanSubject(subject: string): Promise<string> {
    const { clean } = await htmlSanitizer.sanitize(subject);
    // Drop any residual tags: a subject should contain no markup at all.
    return clean.replace(/<[^>]*>/g, '').trim();
  }

  /**
   * Sanitize and persist a template. The stored body is always the sanitized
   * output, so a malicious payload can never reach another admin's browser.
   */
  async saveTemplate(input: TemplateInput): Promise<SaveTemplateResult> {
    const result: SanitizeResult = await htmlSanitizer.sanitize(input.body);
    const template: NotificationTemplate = {
      id: input.id,
      subject: await this.cleanSubject(input.subject),
      body: result.clean,
      updatedAt: new Date().toISOString(),
    };
    await this.repo.save(template);
    return {
      template,
      sanitized: result.modified,
      removedCount: result.removedCount,
    };
  }

  /**
   * Render a sanitized preview without persisting. Used by the preview pane so
   * admins review the safe output before saving.
   */
  async renderPreview(input: TemplateInput): Promise<{ subject: string; body: string; sanitized: boolean }> {
    const subject = await this.cleanSubject(input.subject);
    const { clean, modified } = await htmlSanitizer.sanitize(input.body);
    return { subject, body: clean, sanitized: modified };
  }
}
