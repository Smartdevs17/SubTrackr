/**
 * Transactional email templates (#1254)
 *
 * Covers: registration on the shared engine, required-variable enforcement,
 * unresolved-placeholder detection, plain-text rendering, and the failure
 * paths (unknown template, missing data).
 */

import { describe, expect, it } from '@jest/globals';
import {
  TRANSACTIONAL_TEMPLATES,
  TRANSACTIONAL_TEMPLATE_IDS,
  TransactionalTemplateError,
  registerTransactionalTemplates,
  renderTransactionalEmail,
  renderTransactionalText,
} from '../transactionalEmailTemplates';
import { EmailTemplateEngine } from '../emailTemplateEngine';

const RECEIPT_VARS = {
  merchant_name: 'Acme SaaS',
  subscriber_name: 'Dana',
  subscription_name: 'Pro Plan',
  amount: '49.00',
  currency: 'EUR',
  paid_at: '2026-03-10',
  receipt_url: 'https://example.com/r/1',
  support_email: 'support@example.com',
};

describe('registerTransactionalTemplates', () => {
  it('registers every template on a fresh engine', () => {
    const engine = new EmailTemplateEngine();
    expect(registerTransactionalTemplates(engine)).toEqual(TRANSACTIONAL_TEMPLATE_IDS);

    for (const id of TRANSACTIONAL_TEMPLATE_IDS) {
      expect(engine.getTemplate(id)).toBeDefined();
    }
  });

  it('is idempotent — re-registering keeps the same ids', () => {
    const engine = new EmailTemplateEngine();
    registerTransactionalTemplates(engine);
    const before = engine.listTemplates().length;
    registerTransactionalTemplates(engine);
    expect(engine.listTemplates().length).toBe(before);
  });
});

describe('renderTransactionalEmail', () => {
  it('renders HTML and a plain-text alternative for a receipt', () => {
    const result = renderTransactionalEmail('receipt_payment_succeeded', RECEIPT_VARS);

    expect(result.templateId).toBe('receipt_payment_succeeded');
    expect(result.subject).toBe('Receipt for your Pro Plan payment');
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('49.00');
    expect(result.missingVariables).toEqual([]);

    expect(result.text).toContain('Hi Dana,');
    expect(result.text).toContain('EUR 49.00');
    expect(result.text).toContain('https://example.com/r/1');
    expect(result.text).toContain('support@example.com');
  });

  it('strips newlines from the plain subject', () => {
    const result = renderTransactionalEmail('receipt_payment_succeeded', {
      ...RECEIPT_VARS,
      subscription_name: 'Pro\nPlan',
    });
    expect(result.plainSubject).not.toContain('\n');
  });

  it('throws when a required variable is missing', () => {
    const { receipt_url: _omitted, ...incomplete } = RECEIPT_VARS;
    expect(() => renderTransactionalEmail('receipt_payment_succeeded', incomplete)).toThrow(
      TransactionalTemplateError
    );
    expect(() => renderTransactionalEmail('receipt_payment_succeeded', incomplete)).toThrow(
      /receipt_url/
    );
  });

  it('treats an empty string as a missing variable', () => {
    expect(() =>
      renderTransactionalEmail('receipt_payment_succeeded', { ...RECEIPT_VARS, amount: '' })
    ).toThrow(/amount/);
  });

  it('throws for an unknown template id', () => {
    expect(() =>
      renderTransactionalEmail('nope' as never, RECEIPT_VARS)
    ).toThrow(/Unknown transactional template/);
  });

  it('renders a password reset with its expiry and link', () => {
    const result = renderTransactionalEmail('password_reset', {
      merchant_name: 'Acme SaaS',
      subscriber_name: 'Dana',
      support_email: 'support@example.com',
      reset_url: 'https://example.com/reset/abc',
      expires_in_minutes: '30',
    });

    expect(result.subject).toBe('Reset your Acme SaaS password');
    expect(result.html).toContain('https://example.com/reset/abc');
    expect(result.text).toContain('30 minutes');
  });
});

describe('renderTransactionalText', () => {
  it('renders the footer and separates it with a rule', () => {
    const text = renderTransactionalText(
      TRANSACTIONAL_TEMPLATES.receipt_payment_succeeded,
      RECEIPT_VARS
    );
    expect(text).toContain('--');
    expect(text).toContain('This is an automated message from Acme SaaS.');
  });
});

describe('template definitions', () => {
  it('declares required variables that are a subset of the template variables', () => {
    for (const id of TRANSACTIONAL_TEMPLATE_IDS) {
      const definition = TRANSACTIONAL_TEMPLATES[id];
      for (const variable of definition.requiredVariables) {
        expect(definition.template.variables).toContain(variable);
      }
    }
  });

  it('uses the transactional layout for every template', () => {
    for (const id of TRANSACTIONAL_TEMPLATE_IDS) {
      expect(TRANSACTIONAL_TEMPLATES[id].template.layout).toBe('transactional');
    }
  });
});
