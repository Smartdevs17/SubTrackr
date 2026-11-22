/**
 * Unit tests for emailTemplateEngine.ts
 *
 * Covers:
 *  - ComponentRenderer: all 9 component types produce valid HTML
 *  - Variable substitution: filled values, missing variables, nested placeholders
 *  - Layout system: default / minimal / branded / transactional
 *  - Template registration, retrieval, upsert, delete
 *  - RenderResult: subject, html envelope, missingVariables detection
 *  - Built-in templates: all 4 are registered and renderable
 *  - fromLegacyBlocks migration helper
 *  - Custom layout registration
 *  - Error handling: unknown template ID
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  EmailTemplateEngine,
  ComponentRenderer,
  substituteVariables,
  BUILTIN_TEMPLATES,
  PRESET_COMPONENTS,
  createDefaultTemplate,
  type EmailComponent,
  type ComponentTemplate,
  type LayoutConfig,
} from '../emailTemplateEngine';

// ── Helpers ───────────────────────────────────────────────────────────────────

const vars: Record<string, string> = {
  merchant_name: 'Acme Corp',
  subscriber_name: 'Jane Doe',
  amount: '29.99',
  currency: 'USD',
  subscription_name: 'Pro Plan',
  next_billing_date: '2026-09-01',
  invoice_url: 'https://example.com/inv/123',
  support_email: 'help@acme.com',
};

// ── substituteVariables ───────────────────────────────────────────────────────

describe('substituteVariables', () => {
  it('replaces known placeholders', () => {
    expect(substituteVariables('Hi {{subscriber_name}}!', vars)).toBe('Hi Jane Doe!');
  });

  it('fills placeholders with spaces around the key', () => {
    expect(substituteVariables('{{ merchant_name }} billing', vars)).toBe('Acme Corp billing');
  });

  it('replaces multiple occurrences', () => {
    const result = substituteVariables('{{subscriber_name}} — {{merchant_name}}', vars);
    expect(result).toBe('Jane Doe — Acme Corp');
  });

  it('replaces missing placeholders with [key]', () => {
    expect(substituteVariables('Balance: {{balance}}', vars)).toBe('Balance: [balance]');
  });

  it('returns the string unchanged when no placeholders present', () => {
    expect(substituteVariables('Plain text', vars)).toBe('Plain text');
  });
});

// ── ComponentRenderer ────────────────────────────────────────────────────────

describe('ComponentRenderer', () => {
  let renderer: ComponentRenderer;

  beforeEach(() => {
    renderer = new ComponentRenderer();
  });

  it('renders a header with substituted content', () => {
    const c: EmailComponent = { type: 'header', props: { content: '{{merchant_name}}' } };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('Acme Corp');
    expect(html).toContain('<h1');
  });

  it('renders a text paragraph with newlines converted to <br>', () => {
    const c: EmailComponent = { type: 'text', props: { content: 'Line1\nLine2' } };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('<br>');
    expect(html).toContain('Line1');
    expect(html).toContain('Line2');
  });

  it('renders raw HTML for html component', () => {
    const raw = '<strong>Bold</strong>';
    const c: EmailComponent = { type: 'html', props: { content: raw } };
    expect(renderer.renderComponent(c, vars)).toBe(raw);
  });

  it('renders a button with href and label', () => {
    const c: EmailComponent = {
      type: 'button',
      props: { label: 'Pay Now', href: '{{invoice_url}}', align: 'center' },
    };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('Pay Now');
    expect(html).toContain('https://example.com/inv/123');
    expect(html).toContain('<a ');
  });

  it('renders a divider with <hr>', () => {
    const c: EmailComponent = { type: 'divider', props: {} };
    expect(renderer.renderComponent(c, vars)).toContain('<hr');
  });

  it('renders an image tag', () => {
    const c: EmailComponent = {
      type: 'image',
      props: { src: 'https://img.example.com/logo.png', alt: 'Logo', width: 200 },
    };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('<img');
    expect(html).toContain('https://img.example.com/logo.png');
    expect(html).toContain('alt="Logo"');
  });

  it('renders an image wrapped in a link when link prop is set', () => {
    const c: EmailComponent = {
      type: 'image',
      props: {
        src: 'https://img.example.com/logo.png',
        alt: 'Logo',
        link: 'https://acme.com',
      },
    };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('<a href="https://acme.com">');
  });

  it('renders a spacer with the correct height', () => {
    const c: EmailComponent = { type: 'spacer', props: { height_px: 48 } };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('height:48px');
  });

  it('renders a columns layout with one td per column', () => {
    const col1: EmailComponent = { type: 'text', props: { content: 'Left' } };
    const col2: EmailComponent = { type: 'text', props: { content: 'Right' } };
    const c: EmailComponent = { type: 'columns', props: { columns: [[col1], [col2]] } };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('Left');
    expect(html).toContain('Right');
    // Two <td> elements
    const tdCount = (html.match(/<td/g) ?? []).length;
    expect(tdCount).toBeGreaterThanOrEqual(2);
  });

  it('renders a footer with small font', () => {
    const c: EmailComponent = {
      type: 'footer',
      props: { content: 'Contact {{support_email}}', align: 'center' },
    };
    const html = renderer.renderComponent(c, vars);
    expect(html).toContain('help@acme.com');
    expect(html).toContain('font-size:12px');
  });

  it('renderAll joins multiple components', () => {
    const components: EmailComponent[] = [
      { type: 'text', props: { content: 'Alpha' } },
      { type: 'divider', props: {} },
      { type: 'text', props: { content: 'Beta' } },
    ];
    const html = renderer.renderAll(components, vars);
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('<hr');
  });
});

// ── EmailTemplateEngine ───────────────────────────────────────────────────────

describe('EmailTemplateEngine', () => {
  let engine: EmailTemplateEngine;

  beforeEach(() => {
    engine = new EmailTemplateEngine();
  });

  // ── Built-in templates

  it('registers all 4 built-in templates on construction', () => {
    const ids = engine.listTemplates().map((t) => t.id);
    expect(ids).toContain('payment_failed');
    expect(ids).toContain('renewal_reminder');
    expect(ids).toContain('subscription_cancelled');
    expect(ids).toContain('welcome');
  });

  it('throws when rendering an unknown template ID', () => {
    expect(() => engine.render('nonexistent', vars)).toThrow(/not found/);
  });

  // ── render — payment_failed

  describe('render — payment_failed', () => {
    it('returns a subject with substituted variables', () => {
      const result = engine.render('payment_failed', vars);
      expect(result.subject).toContain('Pro Plan');
    });

    it('produces a valid HTML document', () => {
      const { html } = engine.render('payment_failed', vars);
      expect(html).toMatch(/<!DOCTYPE html>/i);
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('includes subscriber name in the body', () => {
      const { html } = engine.render('payment_failed', vars);
      expect(html).toContain('Jane Doe');
    });

    it('includes the CTA button linking to invoice_url', () => {
      const { html } = engine.render('payment_failed', vars);
      expect(html).toContain('https://example.com/inv/123');
    });

    it('reports no missing variables when all are supplied', () => {
      const { missingVariables } = engine.render('payment_failed', vars);
      expect(missingVariables).toHaveLength(0);
    });

    it('reports missing variables when not supplied', () => {
      const { missingVariables } = engine.render('payment_failed', {});
      expect(missingVariables.length).toBeGreaterThan(0);
    });
  });

  // ── render — renewal_reminder

  it('renewal_reminder subject includes next_billing_date', () => {
    const { subject } = engine.render('renewal_reminder', vars);
    expect(subject).toContain('2026-09-01');
  });

  // ── render — welcome

  it('welcome template uses branded layout', () => {
    const tmpl = engine.getTemplate('welcome')!;
    expect(tmpl.layout).toBe('branded');
  });

  // ── Layout system

  it('applies the correct layout background color', () => {
    const layout = engine.getLayout('transactional');
    expect(layout.backgroundColor).toBe('#f8fafc');
  });

  it('falls back to default layout for unknown layout name', () => {
    const layout = engine.getLayout('unknown' as any);
    expect(layout.name).toBe('default');
  });

  it('respects layoutOverride render option', () => {
    const defaultHtml = engine.render('payment_failed', vars).html;
    const minimalHtml = engine.render('payment_failed', vars, { layoutOverride: 'minimal' }).html;
    // Minimal has white background
    expect(minimalHtml).toContain('#ffffff');
    // They should differ
    expect(defaultHtml).not.toBe(minimalHtml);
  });

  it('custom layout can be registered and used', () => {
    const customLayout: LayoutConfig = {
      name: 'branded' as any,
      backgroundColor: '#ff0000',
      contentBackgroundColor: '#ffffff',
      maxWidth: 500,
      fontFamily: 'Comic Sans',
      padding: 10,
    };
    engine.registerLayout(customLayout as any);
    const tmpl = createDefaultTemplate('t1', 'T1', 'test', 'Hello {{subscriber_name}}');
    engine.registerTemplate({ ...tmpl, layout: 'branded' });
    const { html } = engine.render('t1', vars);
    expect(html).toContain('Comic Sans');
  });

  it('extraCss option is injected into the <style> block', () => {
    const { html } = engine.render('payment_failed', vars, {
      extraCss: '.special { color: red; }',
    });
    expect(html).toContain('.special { color: red; }');
  });

  // ── Template management

  it('upsertTemplate adds a new template', () => {
    const tmpl = createDefaultTemplate('custom_1', 'Custom One', 'custom.event', 'Hello!');
    engine.upsertTemplate(tmpl);
    expect(engine.getTemplate('custom_1')).toBeDefined();
  });

  it('upsertTemplate updates an existing template and bumps updatedAt', async () => {
    const tmpl = createDefaultTemplate('custom_2', 'Original', 'test', 'Body');
    engine.upsertTemplate(tmpl);
    const originalUpdatedAt = engine.getTemplate('custom_2')!.updatedAt;

    await new Promise((r) => setTimeout(r, 5));

    engine.upsertTemplate({ ...tmpl, name: 'Updated' });
    const updated = engine.getTemplate('custom_2')!;
    expect(updated.name).toBe('Updated');
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('deleteTemplate removes the template', () => {
    const tmpl = createDefaultTemplate('del_me', 'Delete Me', 'test', 'Bye');
    engine.registerTemplate(tmpl);
    expect(engine.deleteTemplate('del_me')).toBe(true);
    expect(engine.getTemplate('del_me')).toBeUndefined();
  });

  it('deleteTemplate returns false for a non-existent id', () => {
    expect(engine.deleteTemplate('ghost')).toBe(false);
  });

  // ── renderTemplate direct

  it('renderTemplate renders a template object without registering it', () => {
    const tmpl = createDefaultTemplate('inline', 'Inline', 'test', '{{subscriber_name}} welcome');
    const { html, subject } = engine.renderTemplate(tmpl, vars);
    expect(html).toContain('Jane Doe');
    expect(subject).toContain('Inline');
  });

  // ── PRESET_COMPONENTS

  it('PRESET_COMPONENTS.ctaButton produces a button component', () => {
    const btn = PRESET_COMPONENTS.ctaButton('Go', '{{invoice_url}}');
    expect(btn.type).toBe('button');
    expect(btn.props.label).toBe('Go');
    expect(btn.props.href).toBe('{{invoice_url}}');
  });

  it('PRESET_COMPONENTS.brandedHeader uses {{merchant_name}}', () => {
    const header = PRESET_COMPONENTS.brandedHeader();
    expect(header.props.content).toContain('{{merchant_name}}');
  });

  // ── fromLegacyBlocks migration

  describe('fromLegacyBlocks', () => {
    it('converts legacy header block to header component', () => {
      const tmpl = engine.fromLegacyBlocks(
        'legacy_1',
        'Legacy',
        'test',
        'Subject',
        [{ type: 'header', content: '{{merchant_name}}', order: 0 }]
      );
      expect(tmpl.components[0].type).toBe('header');
      expect(tmpl.components[0].props.content).toBe('{{merchant_name}}');
    });

    it('converts legacy cta_button to button component', () => {
      const tmpl = engine.fromLegacyBlocks(
        'legacy_2',
        'Legacy',
        'test',
        'Subject',
        [{ type: 'cta_button', content: 'Click Me', order: 0 }]
      );
      expect(tmpl.components[0].type).toBe('button');
      expect(tmpl.components[0].props.label).toBe('Click Me');
    });

    it('sorts blocks by order before converting', () => {
      const tmpl = engine.fromLegacyBlocks(
        'legacy_3',
        'Legacy',
        'test',
        'Subject',
        [
          { type: 'footer', content: 'Footer', order: 2 },
          { type: 'header', content: 'Header', order: 0 },
          { type: 'body', content: 'Body', order: 1 },
        ]
      );
      expect(tmpl.components[0].type).toBe('header');
      expect(tmpl.components[1].type).toBe('text');
      expect(tmpl.components[2].type).toBe('footer');
    });

    it('can register and render a migrated legacy template', () => {
      const tmpl = engine.fromLegacyBlocks(
        'legacy_4',
        'Legacy',
        'test',
        '{{merchant_name}} — Update',
        [
          { type: 'header', content: '{{merchant_name}}', order: 0 },
          { type: 'body', content: 'Hi {{subscriber_name}}', order: 1 },
        ]
      );
      engine.registerTemplate(tmpl);
      const { html } = engine.render('legacy_4', vars);
      expect(html).toContain('Acme Corp');
      expect(html).toContain('Jane Doe');
    });
  });

  // ── All built-in templates are renderable

  it.each(BUILTIN_TEMPLATES.map((t) => t.id))(
    'built-in template "%s" renders without throwing',
    (id) => {
      expect(() => engine.render(id, vars)).not.toThrow();
    }
  );

  // ── HTML structure

  it('rendered HTML contains a wrapping table for email clients', () => {
    const { html } = engine.render('welcome', vars);
    expect(html).toContain('<table');
  });

  it('rendered HTML contains a <style> block', () => {
    const { html } = engine.render('welcome', vars);
    expect(html).toContain('<style>');
  });
});
