import type {
  EmailTemplate,
  TemplateVersion,
  TemplateBlock,
  TemplateStatus,
  BlockType,
} from '../types/emailTemplate';
import { injectVariables, TEMPLATE_VARIABLES } from '../types/emailTemplate';

const createId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function nowIso() {
  return new Date().toISOString();
}

function createBlock(type: BlockType, content: string, order: number): TemplateBlock {
  return {
    id: createId('blk'),
    type,
    content,
    order,
    styles: { textAlign: type === 'cta_button' ? 'center' : 'left' },
  };
}

export const DEFAULT_TEMPLATE_BLOCKS: TemplateBlock[] = [
  createBlock('header', '{{merchant_name}}', 0),
  createBlock('body', 'Hi {{subscriber_name}},\n\n{{body_text}}', 1),
  createBlock('cta_button', 'View Invoice', 2),
  createBlock('footer', 'Need help? Contact {{support_email}}', 3),
];

export class EmailTemplateService {
  private templates = new Map<string, EmailTemplate>();
  private versions = new Map<string, TemplateVersion[]>();

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  create(
    merchantId: string,
    name: string,
    trigger: string,
    defaultLocale = 'en'
  ): EmailTemplate {
    const id = createId('tmpl');
    const template: EmailTemplate = {
      id,
      merchantId,
      name,
      trigger,
      status: 'draft',
      version: 1,
      defaultLocale,
      locales: [
        {
          locale: defaultLocale,
          subject: `${name} — {{merchant_name}}`,
          blocks: DEFAULT_TEMPLATE_BLOCKS.map((b) => ({ ...b, id: createId('blk') })),
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.templates.set(id, template);
    this._saveVersion(template, 'system');
    return template;
  }

  get(id: string): EmailTemplate | undefined {
    return this.templates.get(id);
  }

  list(merchantId: string): EmailTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.merchantId === merchantId);
  }

  update(id: string, patch: Partial<Pick<EmailTemplate, 'name' | 'customCss' | 'abTest' | 'locales'>>): EmailTemplate | null {
    const template = this.templates.get(id);
    if (!template || template.status === 'archived') return null;

    const updated: EmailTemplate = {
      ...template,
      ...patch,
      version: template.version + 1,
      updatedAt: nowIso(),
    };
    this.templates.set(id, updated);
    this._saveVersion(updated, 'user');
    return updated;
  }

  publish(id: string): EmailTemplate | null {
    const template = this.templates.get(id);
    if (!template) return null;
    const published: EmailTemplate = {
      ...template,
      status: 'published' as TemplateStatus,
      publishedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.templates.set(id, published);
    return published;
  }

  archive(id: string): EmailTemplate | null {
    const template = this.templates.get(id);
    if (!template) return null;
    const archived: EmailTemplate = { ...template, status: 'archived', updatedAt: nowIso() };
    this.templates.set(id, archived);
    return archived;
  }

  delete(id: string): void {
    this.templates.delete(id);
    this.versions.delete(id);
  }

  // ─── Versioning / Rollback ───────────────────────────────────────────────────

  getVersionHistory(id: string): TemplateVersion[] {
    return this.versions.get(id) ?? [];
  }

  rollback(id: string, version: number): EmailTemplate | null {
    const history = this.versions.get(id) ?? [];
    const target = history.find((v) => v.version === version);
    if (!target) return null;

    const restored: EmailTemplate = {
      ...target.snapshot,
      version: (this.templates.get(id)?.version ?? version) + 1,
      status: 'draft',
      updatedAt: nowIso(),
    };
    this.templates.set(id, restored);
    this._saveVersion(restored, 'rollback');
    return restored;
  }

  // ─── Live Preview ─────────────────────────────────────────────────────────────

  preview(
    id: string,
    locale = 'en',
    variables: Record<string, string> = TEMPLATE_VARIABLES
  ): { subject: string; html: string } | null {
    const template = this.templates.get(id);
    if (!template) return null;

    const localeData =
      template.locales.find((l) => l.locale === locale) ??
      template.locales.find((l) => l.locale === template.defaultLocale);
    if (!localeData) return null;

    const subject = injectVariables(localeData.subject, variables);
    const bodyBlocks = [...localeData.blocks]
      .sort((a, b) => a.order - b.order)
      .map((block) => {
        const content = injectVariables(block.content, variables);
        switch (block.type) {
          case 'header':
            return `<h1 style="text-align:center">${content}</h1>`;
          case 'divider':
            return '<hr />';
          case 'cta_button':
            return `<div style="text-align:center"><a href="#" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">${content}</a></div>`;
          case 'footer':
            return `<footer style="font-size:12px;color:#888">${content}</footer>`;
          default:
            return `<p>${content}</p>`;
        }
      })
      .join('\n');

    const customStyle = template.customCss ? `<style>${template.customCss}</style>` : '';
    const html = `<!DOCTYPE html><html><head>${customStyle}</head><body>${bodyBlocks}</body></html>`;

    return { subject, html };
  }

  // ─── A/B Test ─────────────────────────────────────────────────────────────────

  getABVariantSubject(id: string, variantSeed: number): string | null {
    const template = this.templates.get(id);
    if (!template?.abTest?.enabled) return null;
    const useA = variantSeed % 100 < template.abTest.splitPercent;
    return useA ? template.abTest.variantA.subject : template.abTest.variantB.subject;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private _saveVersion(template: EmailTemplate, savedBy: string): void {
    const history = this.versions.get(template.id) ?? [];
    history.push({
      version: template.version,
      templateId: template.id,
      snapshot: { ...template },
      savedAt: nowIso(),
      savedBy,
    });
    this.versions.set(template.id, history);
  }
}

export const emailTemplateService = new EmailTemplateService();
