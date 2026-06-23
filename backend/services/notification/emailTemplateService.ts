import { TemplateEngine } from './template-engine/index';
import { FilterContext } from './template-engine/filters/index';

export interface EmailTemplate {
  subject: string;
  body: string;
}

export type TenantId = string;
export type UserId = string;
export type Locale = string;

export interface TemplateVariable {
  [key: string]: unknown;
}

export class EmailTemplateService {
  private engine: TemplateEngine;
  private templates = new Map<string, Map<Locale, EmailTemplate>>();

  constructor(partials?: Record<string, string>) {
    this.engine = new TemplateEngine({ partials });
  }

  register(tenantId: TenantId, templateName: string, locale: Locale, template: EmailTemplate): void {
    const key = this.makeKey(tenantId, templateName);
    if (!this.templates.has(key)) {
      this.templates.set(key, new Map());
    }
    this.templates.get(key)!.set(locale, template);
  }

  remove(tenantId: TenantId, templateName: string, locale?: Locale): void {
    const key = this.makeKey(tenantId, templateName);
    if (locale) {
      this.templates.get(key)?.delete(locale);
    } else {
      this.templates.delete(key);
    }
  }

  render(
    tenantId: TenantId,
    templateName: string,
    locale: Locale,
    variables: TemplateVariable,
    filterContext?: FilterContext & { locale?: string }
  ): EmailTemplate {
    const key = this.makeKey(tenantId, templateName);
    const localeMap = this.templates.get(key);

    if (!localeMap) {
      throw new Error(`Template not found: ${templateName} for tenant ${tenantId}`);
    }

    let template = localeMap.get(locale);
    if (!template) {
      const fallback = locale.split('-')[0];
      template = localeMap.get(fallback);
    }
    if (!template) {
      template = localeMap.get('en');
    }
    if (!template) {
      throw new Error(`No template found for ${templateName} in locale ${locale}`);
    }

    const ctx: FilterContext = {
      locale: filterContext?.locale || locale,
      now: filterContext?.now,
    };

    return {
      subject: this.engine.render(template.subject, variables, ctx),
      body: this.engine.render(template.body, variables, ctx),
    };
  }

  registerPartial(name: string, template: string): void {
    this.engine.registerPartial(name, template);
  }

  clearCache(): void {
    this.engine.clearCache();
  }

  private makeKey(tenantId: TenantId, templateName: string): string {
    return `${tenantId}:${templateName}`;
  }
}
