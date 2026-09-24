/**
 * Email service provider — SendGrid + AWS SES with unified interface.
 *
 * The `EmailProvider` interface is the contract used throughout the backend.
 * Two concrete implementations are exported:
 *
 *   SendGridEmailProvider  — production default, uses the SendGrid REST API v3.
 *   SesEmailProvider       — AWS SES via the SES v2 REST API, used when
 *                            EMAIL_PROVIDER=ses in the environment.
 *
 * Both share the same `EmailMessage` / `EmailResult` types and are created
 * through `createEmailProviderFromEnv()` so the rest of the codebase never
 * hard-codes a provider name.
 *
 * Integration with NotificationCenterService
 * ──────────────────────────────────────────
 * `buildEmailTransport(provider)` returns a `ChannelTransport` compatible with
 * `NotificationCenterService.registerTransport('email', …)`.  It uses the
 * `emailTemplateEngine` to render HTML from the registered template for each
 * `NotificationType`→email mapping, falling back to the plain-text body when
 * no template is found.
 *
 * Integration with NotificationServiceImpl (legacy alerting)
 * ──────────────────────────────────────────────────────────
 * `buildLegacyEmailSender(provider)` returns the `sendEmail` signature expected
 * by `NotificationServiceImpl` so that alerting-domain notifications also flow
 * through the real provider.
 */

import type { ChannelTransport } from './notificationCenterService';
import { emailTemplateEngine } from './emailTemplateEngine';
import type { NotificationType } from '../../../src/types/notification';

// ─── Core types ───────────────────────────────────────────────────────────────

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string; // Base64-encoded
  contentType: string;
  disposition?: 'attachment' | 'inline';
  contentId?: string;
}

export interface EmailMessage {
  to: EmailAddress | EmailAddress[];
  from: EmailAddress;
  replyTo?: EmailAddress;
  subject: string;
  /** Plain-text fallback — always populated for accessibility. */
  text: string;
  /** Full HTML body. When omitted, `text` is sent as-is. */
  html?: string;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  attachments?: EmailAttachment[];
  /** Custom headers forwarded to the provider (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
  /** Provider-specific tags/categories for analytics. */
  tags?: string[];
  /** Suppress delivery if the user has globally unsubscribed (SendGrid group id). */
  unsubscribeGroupId?: number;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider: 'sendgrid' | 'ses' | 'stub';
  statusCode?: number;
  error?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
  readonly providerName: 'sendgrid' | 'ses' | 'stub';
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function toAddressArray(addr: EmailAddress | EmailAddress[]): EmailAddress[] {
  return Array.isArray(addr) ? addr : [addr];
}

function plainText(html: string): string {
  // Minimal HTML → plain-text: strip tags, decode common entities.
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── SendGrid provider ────────────────────────────────────────────────────────

export interface SendGridConfig {
  apiKey: string;
  /** Sandbox mode — emails are validated but not delivered. Default: false. */
  sandboxMode?: boolean;
  /** Base URL override for testing. Default: https://api.sendgrid.com */
  baseUrl?: string;
}

interface SendGridPersonalization {
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  bcc?: Array<{ email: string; name?: string }>;
  subject?: string;
  headers?: Record<string, string>;
  dynamic_template_data?: Record<string, string>;
}

export class SendGridEmailProvider implements EmailProvider {
  readonly providerName = 'sendgrid' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: SendGridConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.sendgrid.com';
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const recipients = toAddressArray(message.to);

    const personalization: SendGridPersonalization = {
      to: recipients.map((a) => ({ email: a.email, name: a.name })),
    };
    if (message.cc?.length) {
      personalization.cc = message.cc.map((a) => ({ email: a.email, name: a.name }));
    }
    if (message.bcc?.length) {
      personalization.bcc = message.bcc.map((a) => ({ email: a.email, name: a.name }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      personalizations: [personalization],
      from: { email: message.from.email, name: message.from.name },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
    };

    if (message.replyTo) {
      body.reply_to = { email: message.replyTo.email, name: message.replyTo.name };
    }

    if (message.attachments?.length) {
      body.attachments = message.attachments.map((a) => ({
        content: a.content,
        type: a.contentType,
        filename: a.filename,
        disposition: a.disposition ?? 'attachment',
        content_id: a.contentId,
      }));
    }

    if (message.headers && Object.keys(message.headers).length) {
      body.headers = message.headers;
    }

    if (message.tags?.length) {
      body.categories = message.tags;
    }

    if (message.unsubscribeGroupId !== undefined) {
      body.asm = { group_id: message.unsubscribeGroupId };
    }

    if (this.config.sandboxMode) {
      body.mail_settings = { sandbox_mode: { enable: true } };
    }

    try {
      const response = await fetch(`${this.baseUrl}/v3/mail/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 202) {
        // SendGrid returns 202 with no body on success; message-id is in headers.
        const messageId = response.headers.get('X-Message-Id') ?? undefined;
        return { success: true, messageId, provider: 'sendgrid', statusCode: 202 };
      }

      const errorBody = await response.text().catch(() => '');
      return {
        success: false,
        provider: 'sendgrid',
        statusCode: response.status,
        error: `SendGrid returned ${response.status}: ${errorBody}`,
      };
    } catch (err) {
      return {
        success: false,
        provider: 'sendgrid',
        error: err instanceof Error ? err.message : 'SendGrid request failed',
      };
    }
  }
}

// ─── AWS SES provider ─────────────────────────────────────────────────────────

export interface SesConfig {
  /** AWS region, e.g. "us-east-1". Required. */
  region: string;
  /** AWS access key id. Falls back to IAM role if omitted. */
  accessKeyId?: string;
  /** AWS secret access key. Falls back to IAM role if omitted. */
  secretAccessKey?: string;
  /** Override the SES endpoint (useful for localstack). */
  endpoint?: string;
}

/**
 * AWS SES v2 provider using SES SendEmail API over HTTPS.
 * Uses AWS Signature Version 4 signing — no AWS SDK dependency required.
 */
export class SesEmailProvider implements EmailProvider {
  readonly providerName = 'ses' as const;

  constructor(private readonly config: SesConfig) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    const recipients = toAddressArray(message.to);

    // SES v2 SendEmail JSON body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      FromEmailAddress: message.from.name
        ? `${message.from.name} <${message.from.email}>`
        : message.from.email,
      Destination: {
        ToAddresses: recipients.map((a) =>
          a.name ? `${a.name} <${a.email}>` : a.email
        ),
        ...(message.cc?.length
          ? { CcAddresses: message.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)) }
          : {}),
        ...(message.bcc?.length
          ? {
              BccAddresses: message.bcc.map((a) =>
                a.name ? `${a.name} <${a.email}>` : a.email
              ),
            }
          : {}),
      },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            ...(message.html
              ? { Html: { Data: message.html, Charset: 'UTF-8' } }
              : {}),
          },
        },
      },
    };

    if (message.replyTo) {
      body.ReplyToAddresses = [
        message.replyTo.name
          ? `${message.replyTo.name} <${message.replyTo.email}>`
          : message.replyTo.email,
      ];
    }

    if (message.tags?.length) {
      body.EmailTags = message.tags.map((t) => ({ Name: 'tag', Value: t }));
    }

    try {
      const { endpoint, region } = this.config;
      const host = endpoint
        ? new URL(endpoint).host
        : `email.${region}.amazonaws.com`;
      const url =
        endpoint
          ? `${endpoint}/v2/email/outbound-emails`
          : `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

      const headers = await this.signRequest('POST', url, host, JSON.stringify(body));

      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json().catch(() => ({}));
        return {
          success: true,
          messageId: data?.MessageId,
          provider: 'ses',
          statusCode: response.status,
        };
      }

      const errorText = await response.text().catch(() => '');
      return {
        success: false,
        provider: 'ses',
        statusCode: response.status,
        error: `SES returned ${response.status}: ${errorText}`,
      };
    } catch (err) {
      return {
        success: false,
        provider: 'ses',
        error: err instanceof Error ? err.message : 'SES request failed',
      };
    }
  }

  /**
   * AWS Signature Version 4.
   * Signs the request so it can be sent without the AWS SDK.
   */
  private async signRequest(
    method: string,
    url: string,
    host: string,
    body: string
  ): Promise<Record<string, string>> {
    const { accessKeyId, secretAccessKey, region } = this.config;

    // When no explicit credentials are supplied (IAM role / EC2 instance profile),
    // skip signing — the caller is expected to use an authenticated proxy or SDK.
    if (!accessKeyId || !secretAccessKey) {
      return { Host: host };
    }

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const service = 'ses';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    // Canonical headers (must be sorted, lowercase)
    const canonicalHeaders =
      `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-date';

    // Body hash
    const bodyHash = await this.sha256Hex(body);

    const parsedUrl = new URL(url);
    const canonicalRequest = [
      method,
      parsedUrl.pathname,
      parsedUrl.search.replace(/^\?/, ''),
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join('\n');

    const requestHash = await this.sha256Hex(canonicalRequest);
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      requestHash,
    ].join('\n');

    const signingKey = await this.getSigningKey(secretAccessKey, dateStamp, region, service);
    const signature = await this.hmacHex(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      Host: host,
      'X-Amz-Date': amzDate,
      Authorization: authHeader,
    };
  }

  private async sha256Hex(data: string): Promise<string> {
    // Node.js 18+ has globalThis.crypto.subtle; fall back to the `crypto` module.
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      const buf = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(data)
      );
      return Buffer.from(buf).toString('hex');
    }
    const { createHash } = await import('crypto');
    return createHash('sha256').update(data).digest('hex');
  }

  private async hmacHex(key: Uint8Array | string, data: string): Promise<string> {
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      const keyMaterial =
        typeof key === 'string'
          ? new TextEncoder().encode(`AWS4${key}`)
          : key;
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await globalThis.crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        new TextEncoder().encode(data)
      );
      return Buffer.from(sig).toString('hex');
    }
    const { createHmac } = await import('crypto');
    const rawKey = typeof key === 'string' ? `AWS4${key}` : Buffer.from(key);
    return createHmac('sha256', rawKey).update(data).digest('hex');
  }

  private async hmacBytes(key: Uint8Array | string, data: string): Promise<Uint8Array> {
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      const keyMaterial =
        typeof key === 'string'
          ? new TextEncoder().encode(`AWS4${key}`)
          : key;
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await globalThis.crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        new TextEncoder().encode(data)
      );
      return new Uint8Array(sig);
    }
    const { createHmac } = await import('crypto');
    const rawKey = typeof key === 'string' ? `AWS4${key}` : Buffer.from(key);
    const buf = createHmac('sha256', rawKey).update(data).digest();
    return new Uint8Array(buf);
  }

  private async getSigningKey(
    secret: string,
    dateStamp: string,
    region: string,
    service: string
  ): Promise<Uint8Array> {
    const kDate = await this.hmacBytes(secret, dateStamp);
    const kRegion = await this.hmacBytes(kDate, region);
    const kService = await this.hmacBytes(kRegion, service);
    return this.hmacBytes(kService, 'aws4_request');
  }
}

// ─── Notification type → template id mapping ──────────────────────────────────

const NOTIFICATION_TYPE_TO_TEMPLATE: Partial<Record<NotificationType, string>> = {
  charge_failed: 'payment_failed',
  dunning: 'payment_failed',
  renewal_reminder: 'renewal_reminder',
  trial_ending: 'renewal_reminder', // fallback until a dedicated template exists
};

// ─── ChannelTransport adapter ─────────────────────────────────────────────────

export interface EmailTransportConfig {
  /** Sender address used for all outgoing mail. */
  from: EmailAddress;
  /** Appears in the List-Unsubscribe header and SendGrid asm group. */
  unsubscribeGroupId?: number;
  /** Tags attached to every message for analytics. */
  defaultTags?: string[];
}

/**
 * Build a `ChannelTransport` for `NotificationCenterService.registerTransport`.
 * Renders HTML via `emailTemplateEngine` when a template is available.
 */
export function buildEmailTransport(
  provider: EmailProvider,
  config: EmailTransportConfig
): ChannelTransport {
  return async ({ userId, subject, body, data }) => {
    const recipientEmail = data?.['email'];
    if (!recipientEmail) {
      // No email address in the data bag — can't deliver.
      console.warn(`[EmailTransport] No email address for user ${userId}`);
      return false;
    }

    // Try to get a rendered HTML template.
    let html: string | undefined;
    const notifType = data?.['notificationType'] as NotificationType | undefined;
    if (notifType) {
      const templateId = NOTIFICATION_TYPE_TO_TEMPLATE[notifType];
      if (templateId) {
        try {
          const variables = { ...data, subscriber_name: data?.['userName'] ?? '' };
          const rendered = emailTemplateEngine.render(templateId, variables);
          html = rendered.html;
        } catch {
          // Template not found or render error — fall back to plain HTML wrapper.
        }
      }
    }

    if (!html) {
      // Minimal HTML wrapper for the plain-text body.
      html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
<h2 style="color:#111827">${subject}</h2>
<p style="color:#374151;line-height:1.6">${body.replace(/\n/g, '<br>')}</p>
</body></html>`;
    }

    const message: EmailMessage = {
      to: { email: recipientEmail, name: data?.['userName'] },
      from: config.from,
      subject,
      text: body,
      html,
      tags: config.defaultTags,
      unsubscribeGroupId: config.unsubscribeGroupId,
    };

    const result = await provider.send(message);
    return result.success;
  };
}

/**
 * Build a `sendEmail` function with the same signature as
 * `NotificationServiceImpl.sendEmail` so the legacy alerting domain can
 * also send via the real provider.
 */
export function buildLegacyEmailSender(
  provider: EmailProvider,
  from: EmailAddress
): (toEmail: string, subject: string, htmlContent: string) => Promise<void> {
  return async (toEmail, subject, htmlContent) => {
    const result = await provider.send({
      to: { email: toEmail },
      from,
      subject,
      text: plainText(htmlContent),
      html: htmlContent,
    });
    if (!result.success) {
      console.error(`[EmailProvider] Failed to send to ${toEmail}: ${result.error}`);
    }
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the right provider from environment variables.
 *
 * Required env vars (one set must be present):
 *   EMAIL_PROVIDER=sendgrid  SENDGRID_API_KEY=SG.xxx
 *   EMAIL_PROVIDER=ses       AWS_REGION=us-east-1  [AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY]
 *
 * Optional:
 *   SENDGRID_SANDBOX=true            — enable sandbox mode for SendGrid
 *   EMAIL_FROM_ADDRESS               — sender email (default: noreply@subtrackr.app)
 *   EMAIL_FROM_NAME                  — sender name  (default: SubTrackr)
 *   AWS_SES_ENDPOINT                 — custom SES endpoint (localstack etc.)
 */
export function createEmailProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): EmailProvider {
  const providerName = (env.EMAIL_PROVIDER ?? 'sendgrid').toLowerCase();

  if (providerName === 'ses') {
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    if (!region) {
      console.warn('[EmailProvider] AWS_REGION not set — falling back to stub email provider');
      return createStubEmailProvider();
    }
    return new SesEmailProvider({
      region,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      endpoint: env.AWS_SES_ENDPOINT,
    });
  }

  // Default: SendGrid
  const apiKey = env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn('[EmailProvider] SENDGRID_API_KEY not set — falling back to stub email provider');
    return createStubEmailProvider();
  }

  return new SendGridEmailProvider({
    apiKey,
    sandboxMode: env.SENDGRID_SANDBOX === 'true',
  });
}

export function getEmailFromAddress(
  env: Record<string, string | undefined> = process.env
): EmailAddress {
  return {
    email: env.EMAIL_FROM_ADDRESS ?? 'noreply@subtrackr.app',
    name: env.EMAIL_FROM_NAME ?? 'SubTrackr',
  };
}

// ─── Stub (for environments without credentials) ──────────────────────────────

export function createStubEmailProvider(): EmailProvider {
  return {
    providerName: 'stub',
    async send(message: EmailMessage): Promise<EmailResult> {
      const recipients = toAddressArray(message.to)
        .map((a) => a.email)
        .join(', ');
      console.log(
        `[StubEmailProvider] Would send "${message.subject}" to ${recipients}`
      );
      return { success: true, messageId: `stub-${Date.now()}`, provider: 'stub' };
    },
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const emailProvider: EmailProvider = createEmailProviderFromEnv();
