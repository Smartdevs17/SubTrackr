/**
 * Transactional email templates (#1254)
 *
 * System-generated, non-promotional email: receipts, invoices, password
 * resets, refunds, subscription lifecycle events. These differ from the
 * marketing/retention templates in `emailTemplateEngine.ts` in three ways:
 *
 *   1. Required-variable enforcement — a transactional mail that renders
 *      `{{amount}}` as a literal placeholder is a support incident, so
 *      `renderTransactionalEmail` fails loudly instead of shipping "[amount]".
 *   2. A plain-text alternative, because transactional mail is read in
 *      terminals, mail clients with images disabled and accessibility tools.
 *   3. A `transactional` layout that keeps chrome minimal and legally
 *      required footer content (support address, unsubscribe for marketing).
 *
 * Templates are registered on the shared `emailTemplateEngine` singleton so
 * `buildEmailTransport` can resolve them by id like any other template.
 */

import { emailTemplateEngine, PRESET_COMPONENTS } from './emailTemplateEngine';
import type {
  ComponentTemplate,
  EmailComponent,
  EmailTemplateEngine,
  RenderResult,
} from './emailTemplateEngine';
import { substituteVariables } from './emailTemplateEngine';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TransactionalTemplateId =
  | 'receipt_payment_succeeded'
  | 'invoice_due'
  | 'payment_method_updated'
  | 'refund_issued'
  | 'subscription_renewed'
  | 'password_reset'
  | 'email_verification';

export interface TransactionalTemplateDefinition {
  template: ComponentTemplate;
  /** Variables that must be present or the render fails. */
  requiredVariables: string[];
  /** Tag lines for the plain-text alternative, in order. */
  text: string[];
  /** Legal / compliance footer lines appended to the plain-text body. */
  footerLines: string[];
}

export interface TransactionalRenderResult extends RenderResult {
  templateId: TransactionalTemplateId;
  /** HTML- and text-stripped subject, safe to put in a `Subject:` header. */
  plainSubject: string;
  text: string;
}

// ─── Definitions ───────────────────────────────────────────────────────────────

function define(
  id: TransactionalTemplateId,
  name: string,
  trigger: string,
  subject: string,
  requiredVariables: string[],
  components: EmailComponent[],
  text: string[],
  footerLines: string[]
): TransactionalTemplateDefinition {
  const now = new Date().toISOString();
  // `subscriber_name` (greeting) and `support_email` (footer) are referenced by
  // the shared components, so they are required for every template.
  const required = Array.from(new Set([...requiredVariables, 'subscriber_name', 'support_email']));
  return {
    template: {
      id,
      name,
      trigger,
      subject,
      layout: 'transactional',
      components,
      variables: Array.from(new Set([...required, 'support_email'])),
      createdAt: now,
      updatedAt: now,
    },
    requiredVariables: required,
    text,
    footerLines,
  };
}

const SUPPORT_FOOTER: EmailComponent = {
  type: 'footer',
  props: {
    content: 'This is an automated message from {{merchant_name}}.\nQuestions? {{support_email}}',
    align: 'center',
  },
};

export const TRANSACTIONAL_TEMPLATES: Record<TransactionalTemplateId, TransactionalTemplateDefinition> = {
  receipt_payment_succeeded: define(
    'receipt_payment_succeeded',
    'Payment Receipt',
    'payment.succeeded',
    'Receipt for your {{subscription_name}} payment',
    ['merchant_name', 'subscription_name', 'amount', 'currency', 'paid_at', 'receipt_url'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'We received your payment of {{currency}} {{amount}} for {{subscription_name}} on {{paid_at}}.'
      ),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('View Receipt', '{{receipt_url}}'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'We received your payment of {{currency}} {{amount}} for {{subscription_name}} on {{paid_at}}.',
      'View your receipt: {{receipt_url}}',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  invoice_due: define(
    'invoice_due',
    'Invoice Due',
    'invoice.due',
    'Your invoice for {{subscription_name}} is due on {{due_date}}',
    ['merchant_name', 'subscription_name', 'amount', 'currency', 'due_date', 'invoice_url'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'Invoice for {{subscription_name}} is due on {{due_date}}. Amount payable: {{currency}} {{amount}}.'
      ),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('Pay Invoice', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'Invoice for {{subscription_name}} is due on {{due_date}}.',
      'Amount payable: {{currency}} {{amount}}',
      'Pay now: {{invoice_url}}',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  payment_method_updated: define(
    'payment_method_updated',
    'Payment Method Updated',
    'payment_method.updated',
    'Your payment method was updated',
    ['merchant_name', 'card_brand', 'card_last4', 'effective_date'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'The payment method on file was changed to {{card_brand}} ending {{card_last4}}. It applies to charges from {{effective_date}}.'
      ),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'The payment method on file was changed to {{card_brand}} ending {{card_last4}}.',
      'It applies to charges from {{effective_date}}.',
      'If this was not you, contact {{support_email}} immediately.',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  refund_issued: define(
    'refund_issued',
    'Refund Issued',
    'payment.refunded',
    'Refund issued for {{subscription_name}}',
    ['merchant_name', 'subscription_name', 'amount', 'currency', 'refund_reference'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'We issued a refund of {{currency}} {{amount}} for {{subscription_name}}. Reference {{refund_reference}}.'
      ),
      PRESET_COMPONENTS.body('Depending on your bank, the funds may take 5–10 business days to appear.'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'We issued a refund of {{currency}} {{amount}} for {{subscription_name}}.',
      'Reference: {{refund_reference}}',
      'Depending on your bank, the funds may take 5-10 business days to appear.',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  subscription_renewed: define(
    'subscription_renewed',
    'Subscription Renewed',
    'subscription.renewed',
    'Your {{subscription_name}} subscription renewed',
    ['merchant_name', 'subscription_name', 'amount', 'currency', 'next_billing_date', 'invoice_url'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'Your {{subscription_name}} subscription renewed for {{currency}} {{amount}}. Next renewal: {{next_billing_date}}.'
      ),
      PRESET_COMPONENTS.ctaButton('Manage Subscription', '{{invoice_url}}'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'Your {{subscription_name}} subscription renewed for {{currency}} {{amount}}.',
      'Next renewal: {{next_billing_date}}',
      'Manage your subscription: {{invoice_url}}',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  password_reset: define(
    'password_reset',
    'Password Reset',
    'auth.password_reset',
    'Reset your {{merchant_name}} password',
    ['merchant_name', 'reset_url', 'expires_in_minutes'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body(
        'We received a request to reset your password. This link expires in {{expires_in_minutes}} minutes.'
      ),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('Reset Password', '{{reset_url}}'),
      PRESET_COMPONENTS.body('If you did not request this, you can safely ignore this email.'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'We received a request to reset your password.',
      'Reset link (expires in {{expires_in_minutes}} minutes): {{reset_url}}',
      'If you did not request this, you can safely ignore this email.',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),

  email_verification: define(
    'email_verification',
    'Email Verification',
    'auth.verify_email',
    'Verify your email address',
    ['merchant_name', 'verification_url'],
    [
      PRESET_COMPONENTS.brandedHeader(),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.greeting(),
      PRESET_COMPONENTS.spacer(8),
      PRESET_COMPONENTS.body('Confirm this address to finish setting up your account.'),
      PRESET_COMPONENTS.spacer(16),
      PRESET_COMPONENTS.ctaButton('Verify Email', '{{verification_url}}'),
      PRESET_COMPONENTS.divider(),
      SUPPORT_FOOTER,
    ],
    [
      'Hi {{subscriber_name}},',
      'Confirm this address to finish setting up your account: {{verification_url}}',
    ],
    ['This is an automated message from {{merchant_name}}.', 'Questions? {{support_email}}']
  ),
};

export const TRANSACTIONAL_TEMPLATE_IDS = Object.keys(
  TRANSACTIONAL_TEMPLATES
) as TransactionalTemplateId[];

// ─── Rendering ─────────────────────────────────────────────────────────────────

/** Raised when a transactional template is asked for with data it cannot use. */
export class TransactionalTemplateError extends Error {
  constructor(
    message: string,
    readonly templateId: string,
    readonly code: 'UNKNOWN_TEMPLATE' | 'MISSING_VARIABLES' | 'UNRESOLVED_VARIABLES'
  ) {
    super(message);
    this.name = 'TransactionalTemplateError';
  }
}

/** Compose the plain-text body from a definition's tag lines. */
export function renderTransactionalText(
  definition: TransactionalTemplateDefinition,
  variables: Record<string, string>
): string {
  const lines = definition.text.map((line) => substituteVariables(line, variables));
  const footer = definition.footerLines.map((line) => substituteVariables(line, variables));
  return [...lines, '', '--', ...footer].join('\n');
}

/**
 * Render a transactional template to both HTML and plain text.
 *
 * @throws {TransactionalTemplateError} when the template id is unknown, a
 *         required variable is absent, or the caller left an optional
 *         `{{placeholder}}` unresolved.
 */
export function renderTransactionalEmail(
  templateId: TransactionalTemplateId,
  variables: Record<string, string>,
  engine: EmailTemplateEngine = emailTemplateEngine
): TransactionalRenderResult {
  const definition = TRANSACTIONAL_TEMPLATES[templateId];
  if (!definition) {
    throw new TransactionalTemplateError(
      `Unknown transactional template "${templateId}"`,
      String(templateId),
      'UNKNOWN_TEMPLATE'
    );
  }

  const missing = definition.requiredVariables.filter(
    (name) => variables[name] === undefined || variables[name] === ''
  );
  if (missing.length) {
    throw new TransactionalTemplateError(
      `Template "${templateId}" is missing required variables: ${missing.join(', ')}`,
      templateId,
      'MISSING_VARIABLES'
    );
  }

  const rendered = engine.renderTemplate(definition.template, variables);
  if (rendered.missingVariables.length) {
    throw new TransactionalTemplateError(
      `Template "${templateId}" has unresolved variables: ${rendered.missingVariables.join(', ')}`,
      templateId,
      'UNRESOLVED_VARIABLES'
    );
  }

  return {
    ...rendered,
    templateId,
    plainSubject: rendered.subject.replace(/[\r\n]+/g, ' ').trim(),
    text: renderTransactionalText(definition, variables),
  };
}

/** Register every transactional template on the shared engine. */
export function registerTransactionalTemplates(
  engine: EmailTemplateEngine = emailTemplateEngine
): TransactionalTemplateId[] {
  for (const id of TRANSACTIONAL_TEMPLATE_IDS) {
    engine.upsertTemplate(TRANSACTIONAL_TEMPLATES[id].template);
  }
  return TRANSACTIONAL_TEMPLATE_IDS;
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

registerTransactionalTemplates();
