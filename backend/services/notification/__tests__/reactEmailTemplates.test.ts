/**
 * Tests for React Email-compatible transactional email rendering (Issue #2214).
 */

import {
  ReactEmailRenderer,
  Section,
  Container,
  Text,
  Heading,
  Button,
  Hr,
  Spacer,
  Row,
  Column,
  Footer,
  Img,
  substituteVariables,
  renderWithReactEmail,
  type TransactionalEmailTemplateDef,
  type ReactEmailElement,
} from '../reactEmailRenderer';

import {
  renderReactEmailTemplate,
  getRequiredVariables,
  REACT_EMAIL_TEMPLATE_IDS,
  REACT_EMAIL_TEMPLATES,
  type ReactEmailTemplateId,
} from '../reactEmailTemplates';

// ── Sample variables ─────────────────────────────────────────────────────────

const FULL_VARS: Record<string, string> = {
  merchant_name: 'Acme Inc',
  subscriber_name: 'Alice',
  support_email: 'help@acme.com',
  subscription_name: 'Pro Plan',
  amount: '29.99',
  currency: 'USD',
  paid_at: '2024-07-01',
  receipt_url: 'https://acme.com/receipt/123',
  due_date: '2024-07-15',
  invoice_url: 'https://acme.com/invoice/456',
  invoice_number: 'INV-789',
  overdue_phrase: '5 days',
  escalation_label: 'Reminder',
  card_brand: 'Visa',
  card_last4: '4242',
  effective_date: '2024-07-01',
  refund_reference: 'REF-001',
  next_billing_date: '2024-08-01',
  reset_url: 'https://acme.com/reset/abc',
  expires_in_minutes: '30',
  verification_url: 'https://acme.com/verify/xyz',
};

// ── Renderer: basic component tests ──────────────────────────────────────────

describe('ReactEmailRenderer — component rendering', () => {
  const renderer = new ReactEmailRenderer();

  it('renders Text with variable substitution', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Hello {{name}}' })] },
      { variables: { name: 'World' } },
    );
    expect(result.html).toContain('Hello World');
    expect(result.text).toContain('Hello World');
  });

  it('renders Heading with correct tag', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Heading({ children: 'Title', level: 2 })] },
      {},
    );
    expect(result.html).toContain('<h2');
    expect(result.html).toContain('Title');
  });

  it('renders Button as styled link', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Button({ href: 'https://example.com', children: 'Click Me' })] },
      {},
    );
    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain('Click Me');
    expect(result.html).toContain('background-color:#6366f1');
  });

  it('renders Hr as table with hr element', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Hr()] },
      {},
    );
    expect(result.html).toContain('<hr');
    expect(result.html).toContain('border-top:1px solid');
  });

  it('renders Spacer with height', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Spacer({ height: 40 })] },
      {},
    );
    expect(result.html).toContain('height:40px');
  });

  it('renders Footer with content', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Footer({ children: 'Copyright 2024' })] },
      {},
    );
    expect(result.html).toContain('Copyright 2024');
    expect(result.html).toContain('font-size:12px');
  });

  it('renders Img with src and alt', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Img({ src: 'https://example.com/logo.png', alt: 'Logo', width: 200 })] },
      {},
    );
    expect(result.html).toContain('src="https://example.com/logo.png"');
    expect(result.html).toContain('alt="Logo"');
    expect(result.html).toContain('width="200"');
  });

  it('renders Section wrapping children', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Section({ children: [Text({ children: 'Inside section' })] })] },
      {},
    );
    expect(result.html).toContain('Inside section');
    expect(result.html).toContain('<table');
  });

  it('renders Container with max-width', () => {
    const renderer = new ReactEmailRenderer({ maxWidth: 500 });
    const result = renderer.render(
      { subject: 'Test', components: [Container({ children: [Text({ children: 'Body' })] })] },
      {},
    );
    expect(result.html).toContain('max-width:500px');
  });

  it('renders Row with multiple columns', () => {
    const result = renderer.render(
      {
        subject: 'Test',
        components: [
          Row({
            children: [
              Column({ children: [Text({ children: 'Left' })] }),
              Column({ children: [Text({ children: 'Right' })] }),
            ],
          }),
        ],
      },
      {},
    );
    expect(result.html).toContain('Left');
    expect(result.html).toContain('Right');
    expect(result.html).toContain('width="50%"');
  });

  it('substitutes variables in subject line', () => {
    const result = renderer.render(
      { subject: 'Hello {{name}}', components: [] },
      { variables: { name: 'Alice' } },
    );
    expect(result.subject).toBe('Hello Alice');
  });

  it('produces plain text alternative', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Line 1' }), Hr(), Text({ children: 'Line 2' })] },
      {},
    );
    expect(result.text).toContain('Line 1');
    expect(result.text).toContain('Line 2');
    expect(result.text).toContain('---');
  });

  it('wraps HTML in DOCTYPE and body', () => {
    const result = renderer.render(
      { subject: 'My Subject', components: [Text({ children: 'Hi' })] },
      {},
    );
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<title>My Subject</title>');
    expect(result.html).toContain('<body');
  });
});

// ── Renderer: variable validation ────────────────────────────────────────────

describe('ReactEmailRenderer — variable validation', () => {
  const renderer = new ReactEmailRenderer();

  it('reports missing variables in text', () => {
    const result = renderer.render(
      { subject: 'Test {{missing_var}}', components: [Text({ children: 'Value: {{another_missing}}' })] },
      { variables: {} },
    );
    expect(result.missingVariables).toContain('missing_var');
    expect(result.missingVariables).toContain('another_missing');
  });

  it('reports no missing variables when all provided', () => {
    const result = renderer.render(
      { subject: 'Hello {{name}}', components: [Text({ children: 'Hi {{name}}' })] },
      { variables: { name: 'Alice' } },
    );
    expect(result.missingVariables).toHaveLength(0);
  });

  it('detects missing variables in nested components', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Section({ children: [Text({ children: '{{nested_var}}' })] })] },
      { variables: {} },
    );
    expect(result.missingVariables).toContain('nested_var');
  });

  it('substituteVariables replaces known keys', () => {
    expect(substituteVariables('Hi {{name}}', { name: 'Bob' })).toBe('Hi Bob');
  });

  it('substituteVariables leaves placeholder for unknown keys', () => {
    expect(substituteVariables('Hi {{unknown}}', {})).toBe('Hi [unknown]');
  });
});

// ── renderWithReactEmail: required variable enforcement ──────────────────────

describe('renderWithReactEmail — enforcement', () => {
  const template: TransactionalEmailTemplateDef = {
    id: 'test_template',
    name: 'Test',
    subject: 'Subject {{required_one}}',
    requiredVariables: ['required_one', 'required_two'],
    components: [Text({ children: '{{required_one}} and {{required_two}}' })],
  };

  it('throws when required variables are missing', () => {
    expect(() => renderWithReactEmail(template, { required_one: 'a' })).toThrow(
      /missing required variables: required_two/,
    );
  });

  it('throws when empty string provided for required variable', () => {
    expect(() => renderWithReactEmail(template, { required_one: 'a', required_two: '' })).toThrow(
      /missing required variables/,
    );
  });

  it('throws when unresolved variables remain after render', () => {
    const templateWithUnresolved: TransactionalEmailTemplateDef = {
      id: 'test',
      name: 'Test',
      subject: 'Test',
      requiredVariables: [],
      components: [Text({ children: '{{unresolved_var}}' })],
    };
    expect(() => renderWithReactEmail(templateWithUnresolved, {})).toThrow(
      /unresolved variables: unresolved_var/,
    );
  });

  it('succeeds when all required variables are provided', () => {
    const result = renderWithReactEmail(template, { required_one: 'a', required_two: 'b' });
    expect(result.html).toContain('a and b');
    expect(result.subject).toBe('Subject a');
  });
});

// ── React Email transactional templates ───────────────────────────────────────

describe('ReactEmailTemplates — transactional definitions', () => {
  it('defines all 8 template IDs', () => {
    expect(REACT_EMAIL_TEMPLATE_IDS).toHaveLength(8);
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('receipt_payment_succeeded');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('invoice_due');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('invoice_overdue');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('payment_method_updated');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('refund_issued');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('subscription_renewed');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('password_reset');
    expect(REACT_EMAIL_TEMPLATE_IDS).toContain('email_verification');
  });

  it('renderReactEmailTemplate throws on unknown template', () => {
    expect(() => renderReactEmailTemplate('nonexistent' as ReactEmailTemplateId, FULL_VARS)).toThrow(
      /Unknown React Email template/,
    );
  });

  it('renderReactEmailTemplate throws on missing required variables', () => {
    expect(() =>
      renderReactEmailTemplate('receipt_payment_succeeded', {
        merchant_name: 'Acme',
        subscriber_name: 'Alice',
        support_email: 'help@acme.com',
      }),
    ).toThrow(/missing required variables/);
  });

  it('renders receipt_payment_succeeded with all variables', () => {
    const result = renderReactEmailTemplate('receipt_payment_succeeded', FULL_VARS);
    expect(result.html).toContain('Acme Inc');
    expect(result.html).toContain('Pro Plan');
    expect(result.html).toContain('29.99');
    expect(result.html).toContain('USD');
    expect(result.html).toContain('View Receipt');
    expect(result.html).toContain('https://acme.com/receipt/123');
    expect(result.text).toContain('Acme Inc');
    expect(result.text).toContain('29.99');
  });

  it('renders invoice_due with all variables', () => {
    const result = renderReactEmailTemplate('invoice_due', FULL_VARS);
    expect(result.html).toContain('2024-07-15');
    expect(result.html).toContain('Pay Invoice');
    expect(result.html).toContain('https://acme.com/invoice/456');
  });

  it('renders invoice_overdue with all variables', () => {
    const result = renderReactEmailTemplate('invoice_overdue', FULL_VARS);
    expect(result.html).toContain('INV-789');
    expect(result.html).toContain('5 days');
    expect(result.html).toContain('Reminder');
  });

  it('renders payment_method_updated with all variables', () => {
    const result = renderReactEmailTemplate('payment_method_updated', FULL_VARS);
    expect(result.html).toContain('Visa');
    expect(result.html).toContain('4242');
    expect(result.html).toContain('2024-07-01');
  });

  it('renders refund_issued with all variables', () => {
    const result = renderReactEmailTemplate('refund_issued', FULL_VARS);
    expect(result.html).toContain('REF-001');
    expect(result.html).toContain('5-10 business days');
  });

  it('renders subscription_renewed with all variables', () => {
    const result = renderReactEmailTemplate('subscription_renewed', FULL_VARS);
    expect(result.html).toContain('Next renewal: 2024-08-01');
    expect(result.html).toContain('Manage Subscription');
  });

  it('renders password_reset with all variables', () => {
    const result = renderReactEmailTemplate('password_reset', FULL_VARS);
    expect(result.html).toContain('Reset Password');
    expect(result.html).toContain('https://acme.com/reset/abc');
    expect(result.html).toContain('30 minutes');
  });

  it('renders email_verification with all variables', () => {
    const result = renderReactEmailTemplate('email_verification', FULL_VARS);
    expect(result.html).toContain('Verify Email');
    expect(result.html).toContain('https://acme.com/verify/xyz');
  });

  it('getRequiredVariables returns the list for a known template', () => {
    const vars = getRequiredVariables('receipt_payment_succeeded');
    expect(vars).toContain('merchant_name');
    expect(vars).toContain('amount');
    expect(vars).toContain('receipt_url');
  });

  it('getRequiredVariables throws on unknown template', () => {
    expect(() => getRequiredVariables('bad' as ReactEmailTemplateId)).toThrow(
      /Unknown React Email template/,
    );
  });

  it('produces valid HTML with DOCTYPE for every template', () => {
    for (const id of REACT_EMAIL_TEMPLATE_IDS) {
      const result = renderReactEmailTemplate(id, FULL_VARS);
      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<html');
      expect(result.html).toContain('</html>');
    }
  });

  it('produces plain text for every template', () => {
    for (const id of REACT_EMAIL_TEMPLATE_IDS) {
      const result = renderReactEmailTemplate(id, FULL_VARS);
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toContain('Acme Inc');
    }
  });
});

// ── Custom renderer options ──────────────────────────────────────────────────

describe('ReactEmailRenderer — custom options', () => {
  it('accepts custom background colors', () => {
    const renderer = new ReactEmailRenderer({
      backgroundColor: '#ff0000',
      contentBackgroundColor: '#00ff00',
    });
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Hi' })] },
      {},
    );
    expect(result.html).toContain('#ff0000');
    expect(result.html).toContain('#00ff00');
  });

  it('accepts custom font family', () => {
    const renderer = new ReactEmailRenderer({ fontFamily: 'Arial, sans-serif' });
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Hi' })] },
      {},
    );
    expect(result.html).toContain('Arial, sans-serif');
  });
});

// ── Style overrides ──────────────────────────────────────────────────────────

describe('ReactEmailRenderer — style overrides', () => {
  it('Text style overrides defaults', () => {
    const renderer = new ReactEmailRenderer();
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Red text', style: { color: '#ff0000', fontSize: 20 } })] },
      {},
    );
    expect(result.html).toContain('color:#ff0000');
    expect(result.html).toContain('font-size:20px');
  });

  it('Button style overrides defaults', () => {
    const renderer = new ReactEmailRenderer();
    const result = renderer.render(
      {
        subject: 'Test',
        components: [
          Button({ href: '#', children: 'Custom', style: { backgroundColor: '#00ff00', borderRadius: 12 } }),
        ],
      },
      {},
    );
    expect(result.html).toContain('background-color:#00ff00');
    expect(result.html).toContain('border-radius:12px');
  });
});

// ── Edge cases for branch coverage ───────────────────────────────────────────

describe('ReactEmailRenderer — edge cases', () => {
  const renderer = new ReactEmailRenderer();

  it('renders empty string for unknown component type', () => {
    const result = renderer.render(
      {
        subject: 'Test',
        components: [{ type: 'UnknownType', props: {} } as unknown as ReactEmailElement],
      },
      {},
    );
    // Unknown type renders nothing — body still has the wrapper HTML
    expect(result.html).toContain('<!DOCTYPE html>');
  });

  it('renders Img without explicit width/height', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Img({ src: 'https://example.com/img.png' })] },
      {},
    );
    expect(result.html).toContain('src="https://example.com/img.png"');
    expect(result.html).toContain('width="100%"');
  });

  it('collects missing variables from Img src and alt', () => {
    const result = renderer.render(
      {
        subject: 'Test',
        components: [Img({ src: '{{logo_url}}', alt: '{{logo_alt}}' })],
      },
      { variables: {} },
    );
    expect(result.missingVariables).toContain('logo_url');
    expect(result.missingVariables).toContain('logo_alt');
  });

  it('renders Heading level 3', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Heading({ children: 'Subtitle', level: 3 })] },
      {},
    );
    expect(result.html).toContain('<h3');
  });

  it('renders Heading level 1 by default', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Heading({ children: 'Big Title' })] },
      {},
    );
    expect(result.html).toContain('<h1');
  });

  it('renders Button with empty href as empty string', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Button({ href: '', children: 'No Link' })] },
      {},
    );
    expect(result.html).toContain('href=""');
    expect(result.html).toContain('No Link');
  });

  it('renders Text with newlines converted to <br>', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Text({ children: 'Line A\nLine B' })] },
      {},
    );
    expect(result.html).toContain('Line A<br>Line B');
  });

  it('renders Footer with newlines converted to <br>', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Footer({ children: 'Row 1\nRow 2' })] },
      {},
    );
    expect(result.html).toContain('Row 1<br>Row 2');
  });

  it('Hr renders with custom color', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Hr({ style: { color: '#ff0000' } })] },
      {},
    );
    expect(result.html).toContain('#ff0000');
  });

  it('renders Section with custom style', () => {
    const result = renderer.render(
      {
        subject: 'Test',
        components: [Section({ children: [Text({ children: 'Styled' })], style: { backgroundColor: '#eee' } })],
      },
      {},
    );
    expect(result.html).toContain('background-color:#eee');
  });

  it('renders Column directly in text output', () => {
    const result = renderer.render(
      {
        subject: 'Test',
        components: [
          Row({
            children: [
              Column({ children: [Text({ children: 'Col A' })] }),
            ],
          }),
        ],
      },
      {},
    );
    expect(result.text).toContain('Col A');
  });

  it('produces empty text for components with no text content', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Spacer({ height: 10 }), Hr()] },
      {},
    );
    // Spacer and Hr produce '---' for Hr but Spacer produces nothing in text
    expect(result.text).toContain('---');
  });

  it('Button text output includes href', () => {
    const result = renderer.render(
      { subject: 'Test', components: [Button({ href: 'https://link.com', children: 'Go' })] },
      {},
    );
    expect(result.text).toContain('Go: https://link.com');
  });
});
