/**
 * Component-Based Email Template Engine
 *
 * Replaces raw HTML string concatenation with a structured component system.
 * Each component (Button, Text, Image, Divider, etc.) encapsulates its own
 * render logic so templates are assembled from reusable, typed building blocks
 * instead of manual HTML.
 *
 * Usage:
 *   const engine = new EmailTemplateEngine();
 *   const html  = engine.render(myTemplate, variables);
 *
 * Architecture:
 *   EmailComponent  — the base unit (type + props + children)
 *   ComponentRenderer — maps component type → HTML string
 *   LayoutRegistry  — named two-column / single-column layouts
 *   EmailTemplateEngine — top-level orchestrator
 */

// ── Component types ──────────────────────────────────────────────────────────

export type ComponentType =
  | 'header'
  | 'text'
  | 'html'
  | 'button'
  | 'divider'
  | 'image'
  | 'spacer'
  | 'columns'
  | 'footer';

export interface ComponentProps {
  // text / html
  content?: string;
  // button
  label?: string;
  href?: string;
  // image
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  // spacer
  height_px?: number;
  // columns: array of child component arrays
  columns?: EmailComponent[][];
  // styling
  align?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  borderRadius?: number;
  // link
  link?: string;
}

export interface EmailComponent {
  type: ComponentType;
  props: ComponentProps;
}

// ── Layout ───────────────────────────────────────────────────────────────────

export type LayoutName = 'default' | 'minimal' | 'branded' | 'transactional';

export interface LayoutConfig {
  name: LayoutName;
  backgroundColor: string;
  contentBackgroundColor: string;
  maxWidth: number;
  fontFamily: string;
  padding: number;
  /** Optional inline CSS appended to the <style> block. */
  extraCss?: string;
}

const DEFAULT_LAYOUTS: Record<LayoutName, LayoutConfig> = {
  default: {
    name: 'default',
    backgroundColor: '#f4f4f5',
    contentBackgroundColor: '#ffffff',
    maxWidth: 600,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    padding: 32,
  },
  minimal: {
    name: 'minimal',
    backgroundColor: '#ffffff',
    contentBackgroundColor: '#ffffff',
    maxWidth: 560,
    fontFamily: 'Georgia, "Times New Roman", serif',
    padding: 24,
  },
  branded: {
    name: 'branded',
    backgroundColor: '#1e1b4b',
    contentBackgroundColor: '#ffffff',
    maxWidth: 640,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    padding: 40,
    extraCss: 'a { color: #6366f1; }',
  },
  transactional: {
    name: 'transactional',
    backgroundColor: '#f8fafc',
    contentBackgroundColor: '#ffffff',
    maxWidth: 600,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    padding: 32,
    extraCss: '.amount { font-size: 24px; font-weight: 700; color: #111827; }',
  },
};

// ── Variable substitution ────────────────────────────────────────────────────

export function substituteVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    return variables[key] !== undefined ? variables[key] : `[${key}]`;
  });
}

// ── Component renderer ───────────────────────────────────────────────────────

export class ComponentRenderer {
  renderComponent(component: EmailComponent, variables: Record<string, string>): string {
    const p = component.props;
    const align = p.align ?? 'left';
    const sub = (s?: string) => (s ? substituteVariables(s, variables) : '');

    switch (component.type) {
      case 'header': {
        const bg = p.backgroundColor ?? '#6366f1';
        const color = p.color ?? '#ffffff';
        const fontSize = p.fontSize ?? 24;
        const padding = p.padding ?? 24;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="background-color:${bg};padding:${padding}px;text-align:${align}">
      <h1 style="margin:0;font-size:${fontSize}px;font-weight:700;color:${color};line-height:1.2">${sub(p.content)}</h1>
    </td>
  </tr>
</table>`;
      }

      case 'text': {
        const color = p.color ?? '#374151';
        const fontSize = p.fontSize ?? 15;
        const fontWeight = p.fontWeight ?? 'normal';
        const paddingTop = p.paddingTop ?? p.padding ?? 0;
        const paddingBottom = p.paddingBottom ?? p.padding ?? 16;
        const paddingLeft = p.paddingLeft ?? p.padding ?? 0;
        const paddingRight = p.paddingRight ?? p.padding ?? 0;
        const content = sub(p.content)?.replace(/\n/g, '<br>') ?? '';
        return `<p style="margin:0;padding:${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px;font-size:${fontSize}px;font-weight:${fontWeight};color:${color};text-align:${align};line-height:1.6">${content}</p>`;
      }

      case 'html': {
        return sub(p.content) ?? '';
      }

      case 'button': {
        const bg = p.backgroundColor ?? '#6366f1';
        const color = p.color ?? '#ffffff';
        const borderRadius = p.borderRadius ?? 6;
        const href = sub(p.href) ?? '#';
        const label = sub(p.label) ?? 'Click here';
        const paddingV = p.paddingTop ?? 12;
        const paddingH = p.paddingLeft ?? 24;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="text-align:${align};padding:16px 0">
      <a href="${href}" style="display:inline-block;background-color:${bg};color:${color};text-decoration:none;padding:${paddingV}px ${paddingH}px;border-radius:${borderRadius}px;font-weight:700;font-size:15px">${label}</a>
    </td>
  </tr>
</table>`;
      }

      case 'divider': {
        const color = p.color ?? '#e5e7eb';
        const paddingTop = p.paddingTop ?? p.padding ?? 16;
        const paddingBottom = p.paddingBottom ?? p.padding ?? 16;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="padding:${paddingTop}px 0 ${paddingBottom}px">
      <hr style="border:none;border-top:1px solid ${color};margin:0">
    </td>
  </tr>
</table>`;
      }

      case 'image': {
        const src = sub(p.src) ?? '';
        const alt = sub(p.alt) ?? '';
        const width = p.width ? `width="${p.width}"` : 'width="100%"';
        const height = p.height ? `height="${p.height}"` : '';
        const link = sub(p.link);
        const img = `<img src="${src}" alt="${alt}" ${width} ${height} style="display:block;max-width:100%;border:0">`;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="text-align:${align};padding:${p.padding ?? 0}px 0">
      ${link ? `<a href="${link}">${img}</a>` : img}
    </td>
  </tr>
</table>`;
      }

      case 'spacer': {
        const h = p.height_px ?? 24;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td height="${h}" style="height:${h}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
      }

      case 'columns': {
        const cols = p.columns ?? [];
        const colWidth = Math.floor(100 / Math.max(cols.length, 1));
        const colHtml = cols
          .map(
            (colComponents) =>
              `<td valign="top" width="${colWidth}%" style="padding:0 8px">
                ${colComponents.map((c) => this.renderComponent(c, variables)).join('\n')}
              </td>`
          )
          .join('\n');
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>${colHtml}</tr>
</table>`;
      }

      case 'footer': {
        const color = p.color ?? '#9ca3af';
        const fontSize = p.fontSize ?? 12;
        const paddingTop = p.paddingTop ?? p.padding ?? 24;
        const content = sub(p.content)?.replace(/\n/g, '<br>') ?? '';
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr>
    <td style="padding:${paddingTop}px 0 0;text-align:${align};font-size:${fontSize}px;color:${color};line-height:1.5">${content}</td>
  </tr>
</table>`;
      }

      default:
        return '';
    }
  }

  renderAll(components: EmailComponent[], variables: Record<string, string>): string {
    return components.map((c) => this.renderComponent(c, variables)).join('\n');
  }
}

// ── Template definition ───────────────────────────────────────────────────────

export interface ComponentTemplate {
  id: string;
  name: string;
  trigger: string;
  subject: string;
  layout: LayoutName;
  components: EmailComponent[];
  /** CSS injected in addition to the layout's extraCss. */
  customCss?: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Built-in component presets ────────────────────────────────────────────────

export const PRESET_COMPONENTS = {
  /** Standard branded header using {{merchant_name}} */
  brandedHeader: (): EmailComponent => ({
    type: 'header',
    props: { content: '{{merchant_name}}', align: 'center' },
  }),

  /** Generic greeting */
  greeting: (): EmailComponent => ({
    type: 'text',
    props: { content: 'Hi {{subscriber_name}},' },
  }),

  /** Simple body paragraph */
  body: (content: string): EmailComponent => ({
    type: 'text',
    props: { content },
  }),

  /** CTA button */
  ctaButton: (label: string, href: string): EmailComponent => ({
    type: 'button',
    props: { label, href, align: 'center' },
  }),

  /** Support footer */
  supportFooter: (): EmailComponent => ({
    type: 'footer',
    props: {
      content: 'Need help? Contact {{support_email}}\n{{merchant_name}} · Unsubscribe',
      align: 'center',
    },
  }),

  divider: (): EmailComponent => ({
    type: 'divider',
    props: {},
  }),

  spacer: (px = 24): EmailComponent => ({
    type: 'spacer',
    props: { height_px: px },
  }),
};

// ── Built-in templates ────────────────────────────────────────────────────────

export function createDefaultTemplate(
  id: string,
  name: string,
  trigger: string,
  bodyText: string
): ComponentTemplate {
  const now = new Date().toISOString();
  return {
    id,
    name,
    trigger,
    subject: `${name} — {{merchant_name}}`,
    layout: 'default',
    components: [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(bodyText),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.ctaButton('View Details', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      PRESET_COMPONENTS.supportFooter(),
    ],
    variables: [
      'merchant_name',
      'subscriber_name',
      'support_email',
      'invoice_url',
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export const BUILTIN_TEMPLATES: ComponentTemplate[] = [
  {
    id: 'payment_failed',
    name: 'Payment Failed',
    trigger: 'payment.failed',
    subject: 'Action required: Payment failed for {{subscription_name}}',
    layout: 'transactional',
    variables: [
      'merchant_name',
      'subscriber_name',
      'subscription_name',
      'amount',
      'currency',
      'invoice_url',
      'support_email',
    ],
    components: [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'We were unable to process your payment of {{currency}} {{amount}} for {{subscription_name}}. Please update your payment method to avoid service interruption.'
      ),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.ctaButton('Update Payment Method', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      PRESET_COMPONENTS.supportFooter(),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'renewal_reminder',
    name: 'Renewal Reminder',
    trigger: 'subscription.renewal_due',
    subject: 'Your {{subscription_name}} renews on {{next_billing_date}}',
    layout: 'default',
    variables: [
      'merchant_name',
      'subscriber_name',
      'subscription_name',
      'amount',
      'currency',
      'next_billing_date',
      'invoice_url',
      'support_email',
    ],
    components: [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'This is a friendly reminder that your {{subscription_name}} subscription will automatically renew on {{next_billing_date}} for {{currency}} {{amount}}.'
      ),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('View Subscription', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      PRESET_COMPONENTS.supportFooter(),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'subscription_cancelled',
    name: 'Subscription Cancelled',
    trigger: 'subscription.cancelled',
    subject: 'Your {{subscription_name}} subscription has been cancelled',
    layout: 'transactional',
    variables: [
      'merchant_name',
      'subscriber_name',
      'subscription_name',
      'support_email',
    ],
    components: [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'Your {{subscription_name}} subscription has been cancelled. You will continue to have access until the end of your current billing period.'
      ),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('Reactivate Subscription', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      PRESET_COMPONENTS.supportFooter(),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'welcome',
    name: 'Welcome',
    trigger: 'subscriber.created',
    subject: 'Welcome to {{merchant_name}}, {{subscriber_name}}!',
    layout: 'branded',
    variables: ['merchant_name', 'subscriber_name', 'subscription_name', 'support_email'],
    components: [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(32),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        "Welcome to {{merchant_name}}! You're all set with your {{subscription_name}} plan. We're excited to have you on board."
      ),
      PRESET_COMPONENTS.spacer(24),
      PRESET_COMPONENTS.ctaButton('Get Started', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      PRESET_COMPONENTS.supportFooter(),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ── Engine ────────────────────────────────────────────────────────────────────

export interface RenderResult {
  subject: string;
  html: string;
  /** Variables referenced in the template that were not supplied. */
  missingVariables: string[];
}

export interface EngineRenderOptions {
  /** Override the layout defined on the template. */
  layoutOverride?: LayoutName;
  /** Extra CSS appended after the layout and template CSS. */
  extraCss?: string;
}

export class EmailTemplateEngine {
  private templates = new Map<string, ComponentTemplate>();
  private layouts: Record<LayoutName, LayoutConfig> = { ...DEFAULT_LAYOUTS };
  private renderer = new ComponentRenderer();

  constructor() {
    // Register all built-in templates
    for (const tmpl of BUILTIN_TEMPLATES) {
      this.templates.set(tmpl.id, tmpl);
    }
  }

  // ── Layout management ────────────────────────────────────────────────────────

  registerLayout(config: LayoutConfig): void {
    this.layouts[config.name] = config;
  }

  getLayout(name: LayoutName): LayoutConfig {
    return this.layouts[name] ?? this.layouts['default'];
  }

  // ── Template management ──────────────────────────────────────────────────────

  registerTemplate(template: ComponentTemplate): void {
    this.templates.set(template.id, template);
  }

  getTemplate(id: string): ComponentTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(): ComponentTemplate[] {
    return Array.from(this.templates.values());
  }

  upsertTemplate(template: ComponentTemplate): void {
    const existing = this.templates.get(template.id);
    this.templates.set(template.id, {
      ...template,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  /**
   * Render a template to a complete HTML email.
   *
   * @param templateId  ID registered with `registerTemplate` / `upsertTemplate`.
   * @param variables   Key/value pairs substituted into `{{variable}}` placeholders.
   * @param options     Optional overrides for layout and extra CSS.
   */
  render(
    templateId: string,
    variables: Record<string, string> = {},
    options: EngineRenderOptions = {}
  ): RenderResult {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Email template "${templateId}" not found`);
    }
    return this.renderTemplate(template, variables, options);
  }

  /**
   * Render a template object directly (without registering it first).
   * Useful for preview / draft rendering.
   */
  renderTemplate(
    template: ComponentTemplate,
    variables: Record<string, string> = {},
    options: EngineRenderOptions = {}
  ): RenderResult {
    const layoutName = options.layoutOverride ?? template.layout;
    const layout = this.getLayout(layoutName);

    // Detect missing variables
    const allText = JSON.stringify(template.components) + template.subject;
    const placeholderMatches = allText.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g);
    const needed = new Set<string>();
    for (const [, key] of placeholderMatches) needed.add(key);
    const missingVariables = [...needed].filter((k) => variables[k] === undefined);

    const subject = substituteVariables(template.subject, variables);
    const bodyHtml = this.renderer.renderAll(template.components, variables);

    const css = [
      '* { box-sizing: border-box; }',
      'body { margin: 0; padding: 0; }',
      'img { border: 0; display: block; }',
      layout.extraCss ?? '',
      template.customCss ?? '',
      options.extraCss ?? '',
    ]
      .filter(Boolean)
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
  <style>${css}</style>
</head>
<body style="margin:0;padding:0;background-color:${layout.backgroundColor};font-family:${layout.fontFamily}">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${layout.backgroundColor}">
    <tr>
      <td align="center" style="padding:${layout.padding}px 16px">
        <table width="${layout.maxWidth}" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:${layout.maxWidth}px;width:100%;background-color:${layout.contentBackgroundColor};border-radius:8px;overflow:hidden">
          <tr>
            <td style="padding:${layout.padding}px">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return { subject, html, missingVariables };
  }

  // ── Component builder helpers ─────────────────────────────────────────────────

  /**
   * Build a component template from a legacy block-based template definition.
   * Used for gradual migration from the old EmailTemplateService format.
   */
  fromLegacyBlocks(
    id: string,
    name: string,
    trigger: string,
    subject: string,
    blocks: Array<{ type: string; content: string; order: number }>,
    layout: LayoutName = 'default'
  ): ComponentTemplate {
    const sorted = [...blocks].sort((a, b) => a.order - b.order);
    const components: EmailComponent[] = sorted.map((block) => {
      switch (block.type) {
        case 'header':
          return { type: 'header' as ComponentType, props: { content: block.content } };
        case 'body':
          return { type: 'text' as ComponentType, props: { content: block.content } };
        case 'cta_button':
          return {
            type: 'button' as ComponentType,
            props: { label: block.content, href: '{{invoice_url}}', align: 'center' },
          };
        case 'divider':
          return { type: 'divider' as ComponentType, props: {} };
        case 'footer':
          return { type: 'footer' as ComponentType, props: { content: block.content } };
        case 'image':
          return { type: 'image' as ComponentType, props: { src: block.content, alt: '' } };
        default:
          return { type: 'text' as ComponentType, props: { content: block.content } };
      }
    });

    const now = new Date().toISOString();
    return { id, name, trigger, subject, layout, components, variables: [], createdAt: now, updatedAt: now };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const emailTemplateEngine = new EmailTemplateEngine();
