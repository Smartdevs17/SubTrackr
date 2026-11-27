/**
 * React Email-based transactional email templates.
 *
 * Issue #2214: Refactor transactional email rendering using React Email.
 *
 * Re-defines the transactional templates from `transactionalEmailTemplates.ts`
 * using the React Email component API (Section, Text, Button, Hr, Footer, …)
 * instead of the legacy `ComponentTemplate` format. Rendering is handled by
 * `ReactEmailRenderer`, which produces table-based HTML and a plain-text
 * alternative.
 *
 * The templates are drop-in compatible with the existing system — same template
 * IDs, same required-variable enforcement, same subject lines — so callers can
 * switch from the legacy renderer to the React Email renderer without changes.
 */

import {
  Text,
  Heading,
  Button,
  Hr,
  Spacer,
  Footer,
  renderWithReactEmail,
  type ReactEmailElement,
  type RenderResult,
  type ReactEmailRenderer,
  type TransactionalEmailTemplateDef,
} from './reactEmailRenderer';

// ── Template IDs (same as legacy system) ──────────────────────────────────────

export type ReactEmailTemplateId =
  | 'receipt_payment_succeeded'
  | 'invoice_due'
  | 'invoice_overdue'
  | 'payment_method_updated'
  | 'refund_issued'
  | 'subscription_renewed'
  | 'password_reset'
  | 'email_verification';

// ── Helper: standard layout for transactional emails ─────────────────────────

function transactionalLayout(body: ReactEmailElement[]): ReactEmailElement[] {
  return [
    Heading({ children: '{{merchant_name}}' }),
    Spacer({ height: 16 }),
    Text({ children: 'Hi {{subscriber_name}},' }),
    Spacer({ height: 8 }),
    ...body,
    Hr(),
    Footer({
      children: 'This is an automated message from {{merchant_name}}.\nQuestions? {{support_email}}',
    }),
  ];
}

// ── Template definitions ─────────────────────────────────────────────────────

export const REACT_EMAIL_TEMPLATES: Record<ReactEmailTemplateId, TransactionalEmailTemplateDef> = {
  receipt_payment_succeeded: {
    id: 'receipt_payment_succeeded',
    name: 'Payment Receipt',
    subject: 'Receipt for your {{subscription_name}} payment',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'subscription_name', 'amount', 'currency', 'paid_at', 'receipt_url',
    ],
    components: transactionalLayout([
      Text({
        children:
          'We received your payment of {{currency}} {{amount}} for {{subscription_name}} on {{paid_at}}.',
      }),
      Spacer({ height: 16 }),
      Button({ href: '{{receipt_url}}', children: 'View Receipt' }),
    ]),
  },

  invoice_due: {
    id: 'invoice_due',
    name: 'Invoice Due',
    subject: 'Your invoice for {{subscription_name}} is due on {{due_date}}',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'subscription_name', 'amount', 'currency', 'due_date', 'invoice_url',
    ],
    components: transactionalLayout([
      Text({
        children:
          'Invoice for {{subscription_name}} is due on {{due_date}}. Amount payable: {{currency}} {{amount}}.',
      }),
      Spacer({ height: 16 }),
      Button({ href: '{{invoice_url}}', children: 'Pay Invoice' }),
    ]),
  },

  invoice_overdue: {
    id: 'invoice_overdue',
    name: 'Invoice Overdue',
    subject: '{{escalation_label}}: invoice {{invoice_number}} is {{overdue_phrase}} overdue',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'invoice_number', 'subscription_name', 'amount', 'currency',
      'due_date', 'overdue_phrase', 'invoice_url', 'escalation_label',
    ],
    components: transactionalLayout([
      Text({
        children:
          'Invoice {{invoice_number}} for {{subscription_name}} was due on {{due_date}} and is now {{overdue_phrase}} overdue. Amount outstanding: {{currency}} {{amount}}.',
      }),
      Text({
        children: 'Please settle the balance to avoid late fees or interruption of service.',
      }),
      Spacer({ height: 16 }),
      Button({ href: '{{invoice_url}}', children: 'Pay Invoice' }),
    ]),
  },

  payment_method_updated: {
    id: 'payment_method_updated',
    name: 'Payment Method Updated',
    subject: 'Your payment method was updated',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'card_brand', 'card_last4', 'effective_date',
    ],
    components: transactionalLayout([
      Text({
        children:
          'The payment method on file was changed to {{card_brand}} ending {{card_last4}}. It applies to charges from {{effective_date}}.',
      }),
    ]),
  },

  refund_issued: {
    id: 'refund_issued',
    name: 'Refund Issued',
    subject: 'Refund issued for {{subscription_name}}',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'subscription_name', 'amount', 'currency', 'refund_reference',
    ],
    components: transactionalLayout([
      Text({
        children:
          'We issued a refund of {{currency}} {{amount}} for {{subscription_name}}. Reference {{refund_reference}}.',
      }),
      Text({
        children: 'Depending on your bank, the funds may take 5-10 business days to appear.',
      }),
    ]),
  },

  subscription_renewed: {
    id: 'subscription_renewed',
    name: 'Subscription Renewed',
    subject: 'Your {{subscription_name}} subscription renewed',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'subscription_name', 'amount', 'currency', 'next_billing_date', 'invoice_url',
    ],
    components: transactionalLayout([
      Text({
        children:
          'Your {{subscription_name}} subscription renewed for {{currency}} {{amount}}. Next renewal: {{next_billing_date}}.',
      }),
      Button({ href: '{{invoice_url}}', children: 'Manage Subscription' }),
    ]),
  },

  password_reset: {
    id: 'password_reset',
    name: 'Password Reset',
    subject: 'Reset your {{merchant_name}} password',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'reset_url', 'expires_in_minutes',
    ],
    components: transactionalLayout([
      Text({
        children:
          'We received a request to reset your password. This link expires in {{expires_in_minutes}} minutes.',
      }),
      Spacer({ height: 16 }),
      Button({ href: '{{reset_url}}', children: 'Reset Password' }),
      Text({ children: 'If you did not request this, you can safely ignore this email.' }),
    ]),
  },

  email_verification: {
    id: 'email_verification',
    name: 'Email Verification',
    subject: 'Verify your email address',
    requiredVariables: [
      'merchant_name', 'subscriber_name', 'support_email',
      'verification_url',
    ],
    components: transactionalLayout([
      Text({ children: 'Confirm this address to finish setting up your account.' }),
      Spacer({ height: 16 }),
      Button({ href: '{{verification_url}}', children: 'Verify Email' }),
    ]),
  },
};

export const REACT_EMAIL_TEMPLATE_IDS = Object.keys(
  REACT_EMAIL_TEMPLATES,
) as ReactEmailTemplateId[];

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render a transactional email template using React Email components.
 *
 * @throws if the template id is unknown, a required variable is missing, or
 *         the render leaves an unresolved `{{placeholder}}`.
 */
export function renderReactEmailTemplate(
  templateId: ReactEmailTemplateId,
  variables: Record<string, string>,
  renderer?: ReactEmailRenderer,
): RenderResult {
  const template = REACT_EMAIL_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown React Email template "${templateId}"`);
  }
  return renderWithReactEmail(template, variables, renderer);
}

/** Get the list of required variables for a template. */
export function getRequiredVariables(templateId: ReactEmailTemplateId): string[] {
  const template = REACT_EMAIL_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown React Email template "${templateId}"`);
  }
  return [...template.requiredVariables];
}
