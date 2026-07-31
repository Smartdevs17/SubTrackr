export type BlockType = 'header' | 'body' | 'cta_button' | 'footer' | 'divider' | 'image';

export type TemplateStatus = 'draft' | 'published' | 'archived';

export interface TemplateBlock {
  id: string;
  type: BlockType;
  content: string; // raw text / HTML; variables use {{variable_name}}
  order: number;
  styles?: {
    backgroundColor?: string;
    textColor?: string;
    fontSize?: number;
    padding?: number;
    textAlign?: 'left' | 'center' | 'right';
  };
}

export interface TemplateLocale {
  locale: string; // e.g. 'en', 'fr', 'de'
  subject: string;
  blocks: TemplateBlock[];
}

export interface ABTestConfig {
  enabled: boolean;
  variantA: { subject: string; sendTimeHour: number };
  variantB: { subject: string; sendTimeHour: number };
  splitPercent: number; // 0-100, percentage sent variant A
}

export interface EmailTemplate {
  id: string;
  merchantId: string;
  name: string;
  /** Maps trigger event to usage context (e.g. 'payment_failed', 'renewal_reminder') */
  trigger: string;
  status: TemplateStatus;
  version: number;
  locales: TemplateLocale[];
  defaultLocale: string;
  customCss?: string; // injected into <style> block
  abTest?: ABTestConfig;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface TemplateVersion {
  version: number;
  templateId: string;
  snapshot: EmailTemplate;
  savedAt: string;
  savedBy: string;
}

/** Available template variables for preview / validation */
export const TEMPLATE_VARIABLES: Record<string, string> = {
  merchant_name: 'Acme Corp',
  subscriber_name: 'Jane Doe',
  amount: '29.99',
  currency: 'USD',
  subscription_name: 'Pro Plan',
  next_billing_date: '2026-07-15',
  invoice_url: 'https://app.subtrackr.example.com/invoices/inv_123',
  support_email: 'support@example.com',
};

export function injectVariables(
  template: string,
  variables: Record<string, string> = TEMPLATE_VARIABLES
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? `[${key}]`; // fallback text for missing variables
  });
}
