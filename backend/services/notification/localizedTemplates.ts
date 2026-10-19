/**
 * Localised notification templates (#1752)
 *
 * Templates used to be English-only. This module adds locale-aware rendering
 * for transactional notifications so partners and subscribers receive copy in
 * their preferred language, with a deterministic fallback to the default
 * locale (`en`) when a translation is missing.
 *
 * Design
 * ──────
 *   • `LocaleCatalog` — a record of `locale → translationKey → LocalizedCopy`.
 *   • `resolveLocale(locale)` — normalises to a supported locale, falling back
 *     to `DEFAULT_LOCALE` when the requested one is unknown.
 *   • `renderLocalized(...)` — resolves the copy for a (templateId, locale),
 *     falling back per-key to the default locale so a missing Spanish
 *     translation still renders the English string instead of `{{amount}}`.
 *   • `substituteVariables` — the same `{{variable}}` placeholder syntax used
 *     by the rest of the notification pipeline.
 *
 * The service is transport-agnostic: it returns `{ subject, body }` strings
 * that email, SMS, push, and in-app channels can consume. Rich-text HTML
 * sanitisation still happens downstream via `templateService.ts`.
 */

/** BCP-47-ish locale codes used by SubTrackr. Kept intentionally small. */
export type SupportedLocale = 'en' | 'es' | 'fr' | 'ar';

/** Fallback locale used when the requested locale has no translation. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en', 'es', 'fr', 'ar'];

export interface LocalizedCopy {
  /** Plain-text subject line (no HTML). */
  subject: string;
  /** Body text with `{{variable}}` placeholders. */
  body: string;
}

/** Translation keys for every localisable notification template. */
export type LocalizedTemplateId =
  | 'receipt_payment_succeeded'
  | 'invoice_due'
  | 'payment_failed'
  | 'subscription_renewed'
  | 'subscription_cancelled'
  | 'trial_ending'
  | 'password_reset'
  | 'email_verification';

/** locale → templateId → copy. */
export type LocaleCatalog = Record<SupportedLocale, Partial<Record<LocalizedTemplateId, LocalizedCopy>>>;

export interface RenderedTemplate {
  templateId: LocalizedTemplateId;
  /** The locale that was actually used (may differ from the request when fallback kicked in). */
  resolvedLocale: SupportedLocale;
  /** True when the requested locale had no entry and the default locale was used. */
  fellBack: boolean;
  subject: string;
  body: string;
  /** Variables declared in the template that the caller did not supply. */
  missingVariables: string[];
}

// ─── Locale resolution ─────────────────────────────────────────────────────────

const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  'en-US': 'en',
  'en-GB': 'en',
  'es-ES': 'es',
  'es-MX': 'es',
  'fr-FR': 'fr',
  'fr-CA': 'fr',
  'ar-SA': 'ar',
  'ar-EG': 'ar',
};

/**
 * Normalises a caller-supplied locale tag to a supported locale.
 * Returns `DEFAULT_LOCALE` for unknown / empty input so callers always get
 * a usable locale back.
 */
export function resolveLocale(locale: string | undefined | null): SupportedLocale {
  if (!locale || typeof locale !== 'string') return DEFAULT_LOCALE;
  const normalised = locale.trim().toLowerCase();
  if (!normalised) return DEFAULT_LOCALE;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(normalised)) {
    return normalised as SupportedLocale;
  }
  const alias = LOCALE_ALIASES[normalised] ?? LOCALE_ALIASES[normalised.split('-')[0]];
  return alias ?? DEFAULT_LOCALE;
}

// ─── Variable substitution ──────────────────────────────────────────────────────

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Replace `{{variable}}` placeholders with values from `variables`. */
export function substituteVariables(
  template: string,
  variables: Record<string, string> = {},
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null || value === '') {
      // Record the missing variable but render an empty string — never leak
      // the raw `{{placeholder}}` to a recipient.
      if (!missing.includes(name)) missing.push(name);
      return '';
    }
    return String(value);
  });
  return { text, missing };
}

// ─── Default catalog ───────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATE_CATALOG: LocaleCatalog = {
  en: {
    receipt_payment_succeeded: {
      subject: 'Receipt for your {{subscription_name}} payment',
      body: 'We received your payment of {{currency}} {{amount}} for {{subscription_name}} on {{paid_at}}.',
    },
    invoice_due: {
      subject: 'Your invoice for {{subscription_name}} is due on {{due_date}}',
      body: 'Invoice for {{subscription_name}} is due on {{due_date}}. Amount payable: {{currency}} {{amount}}.',
    },
    payment_failed: {
      subject: 'Your payment for {{subscription_name}} failed',
      body: 'We could not process your payment of {{currency}} {{amount}} for {{subscription_name}}. Please update your payment method.',
    },
    subscription_renewed: {
      subject: 'Your {{subscription_name}} subscription renewed',
      body: 'Your {{subscription_name}} subscription renewed for {{currency}} {{amount}}. Next renewal: {{next_billing_date}}.',
    },
    subscription_cancelled: {
      subject: 'Your {{subscription_name}} subscription was cancelled',
      body: 'Your {{subscription_name}} subscription has been cancelled. You will retain access until {{access_until}}.',
    },
    trial_ending: {
      subject: 'Your {{subscription_name}} trial ends on {{trial_end_date}}',
      body: 'Your free trial of {{subscription_name}} ends on {{trial_end_date}}. Add a payment method to keep your subscription active.',
    },
    password_reset: {
      subject: 'Reset your {{merchant_name}} password',
      body: 'We received a request to reset your password. This link expires in {{expires_in_minutes}} minutes: {{reset_url}}',
    },
    email_verification: {
      subject: 'Verify your email address',
      body: 'Confirm this address to finish setting up your account: {{verification_url}}',
    },
  },
  es: {
    receipt_payment_succeeded: {
      subject: 'Recibo de tu pago de {{subscription_name}}',
      body: 'Recibimos tu pago de {{currency}} {{amount}} por {{subscription_name}} el {{paid_at}}.',
    },
    invoice_due: {
      subject: 'Tu factura de {{subscription_name}} vence el {{due_date}}',
      body: 'La factura de {{subscription_name}} vence el {{due_date}}. Importe a pagar: {{currency}} {{amount}}.',
    },
    payment_failed: {
      subject: 'Tu pago de {{subscription_name}} ha fallado',
      body: 'No pudimos procesar tu pago de {{currency}} {{amount}} por {{subscription_name}}. Actualiza tu método de pago.',
    },
    subscription_renewed: {
      subject: 'Tu suscripción a {{subscription_name}} se renovó',
      body: 'Tu suscripción a {{subscription_name}} se renovó por {{currency}} {{amount}}. Próxima renovación: {{next_billing_date}}.',
    },
    subscription_cancelled: {
      subject: 'Tu suscripción a {{subscription_name}} fue cancelada',
      body: 'Tu suscripción a {{subscription_name}} ha sido cancelada. Mantendrás acceso hasta el {{access_until}}.',
    },
    trial_ending: {
      subject: 'Tu prueba de {{subscription_name}} termina el {{trial_end_date}}',
      body: 'Tu prueba gratuita de {{subscription_name}} termina el {{trial_end_date}}. Añade un método de pago para mantener tu suscripción activa.',
    },
    password_reset: {
      subject: 'Restablece tu contraseña de {{merchant_name}}',
      body: 'Recibimos una solicitud para restablecer tu contraseña. Este enlace caduca en {{expires_in_minutes}} minutos: {{reset_url}}',
    },
    email_verification: {
      subject: 'Verifica tu correo electrónico',
      body: 'Confirma esta dirección para terminar de configurar tu cuenta: {{verification_url}}',
    },
  },
  fr: {
    receipt_payment_succeeded: {
      subject: 'Reçu de votre paiement {{subscription_name}}',
      body: 'Nous avons reçu votre paiement de {{currency}} {{amount}} pour {{subscription_name}} le {{paid_at}}.',
    },
    invoice_due: {
      subject: 'Votre facture {{subscription_name}} est due le {{due_date}}',
      body: 'La facture {{subscription_name}} est due le {{due_date}}. Montant à payer : {{currency}} {{amount}}.',
    },
    payment_failed: {
      subject: 'Votre paiement pour {{subscription_name}} a échoué',
      body: 'Nous n\u2019avons pas pu traiter votre paiement de {{currency}} {{amount}} pour {{subscription_name}}. Veuillez mettre à jour votre moyen de paiement.',
    },
    subscription_renewed: {
      subject: 'Votre abonnement {{subscription_name}} a été renouvelé',
      body: 'Votre abonnement {{subscription_name}} a été renouvelé pour {{currency}} {{amount}}. Prochain renouvellement : {{next_billing_date}}.',
    },
    subscription_cancelled: {
      subject: 'Votre abonnement {{subscription_name}} a été annulé',
      body: 'Votre abonnement {{subscription_name}} a été annulé. Vous conservez l\u2019accès jusqu\u2019au {{access_until}}.',
    },
    trial_ending: {
      subject: 'Votre essai de {{subscription_name}} se termine le {{trial_end_date}}',
      body: 'Votre essai gratuit de {{subscription_name}} se termine le {{trial_end_date}}. Ajoutez un moyen de paiement pour conserver votre abonnement actif.',
    },
    password_reset: {
      subject: 'Réinitialisez votre mot de passe {{merchant_name}}',
      body: 'Nous avons reçu une demande de réinitialisation de votre mot de passe. Ce lien expire dans {{expires_in_minutes}} minutes : {{reset_url}}',
    },
    email_verification: {
      subject: 'Vérifiez votre adresse e-mail',
      body: 'Confirmez cette adresse pour finaliser la configuration de votre compte : {{verification_url}}',
    },
  },
  ar: {
    receipt_payment_succeeded: {
      subject: 'إيصال دفع اشتراكك في {{subscription_name}}',
      body: 'لقد استلمنا دفعتك بقيمة {{currency}} {{amount}} لاشتراك {{subscription_name}} في {{paid_at}}.',
    },
    invoice_due: {
      subject: 'فاتورة اشتراك {{subscription_name}} مستحقة في {{due_date}}',
      body: 'فاتورة اشتراك {{subscription_name}} مستحقة في {{due_date}}. المبلغ المستحق: {{currency}} {{amount}}.',
    },
    payment_failed: {
      subject: 'فشل دفع اشتراك {{subscription_name}}',
      body: 'تعذر معالجة دفعتك بقيمة {{currency}} {{amount}} لاشتراك {{subscription_name}}. يرجى تحديث طريقة الدفع.',
    },
    subscription_renewed: {
      subject: 'تم تجديد اشتراك {{subscription_name}}',
      body: 'تم تجديد اشتراك {{subscription_name}} بقيمة {{currency}} {{amount}}. التجديد التالي: {{next_billing_date}}.',
    },
    subscription_cancelled: {
      subject: 'تم إلغاء اشتراك {{subscription_name}}',
      body: 'تم إلغاء اشتراك {{subscription_name}}. سيبقى لديك الوصول حتى {{access_until}}.',
    },
    trial_ending: {
      subject: 'تنتهي فترة التجربة لـ {{subscription_name}} في {{trial_end_date}}',
      body: 'تنتهي فترة التجربة المجانية لـ {{subscription_name}} في {{trial_end_date}}. أضف طريقة دفع للاحتفاظ باشتراكك نشطًا.',
    },
    password_reset: {
      subject: 'إعادة تعيين كلمة مرور {{merchant_name}}',
      body: 'لقد تلقينا طلبًا لإعادة تعيين كلمة المرور. تنتهي صلاحية هذا الرابط خلال {{expires_in_minutes}} دقيقة: {{reset_url}}',
    },
    email_verification: {
      subject: 'تحقق من عنوان بريدك الإلكتروني',
      body: 'قم بتأكيد هذا العنوان لإكمال إعداد حسابك: {{verification_url}}',
    },
  },
};

// ─── Service ───────────────────────────────────────────────────────────────────

export class LocalizedTemplateService {
  private readonly catalog: LocaleCatalog;
  private readonly defaultLocale: SupportedLocale;

  constructor(catalog: LocaleCatalog = DEFAULT_TEMPLATE_CATALOG, defaultLocale: SupportedLocale = DEFAULT_LOCALE) {
    this.catalog = catalog;
    this.defaultLocale = defaultLocale;
  }

  /** Returns the supported locales that have at least one template defined. */
  listLocales(): SupportedLocale[] {
    return (Object.keys(this.catalog) as SupportedLocale[]).filter(
      (locale) => this.catalog[locale] && Object.keys(this.catalog[locale]).length > 0,
    );
  }

  /** Returns the template ids available for every locale (union). */
  listTemplateIds(): LocalizedTemplateId[] {
    const ids = new Set<LocalizedTemplateId>();
    for (const locale of Object.keys(this.catalog) as SupportedLocale[]) {
      const block = this.catalog[locale];
      if (!block) continue;
      for (const id of Object.keys(block) as LocalizedTemplateId[]) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Look up the localised copy for a template, falling back to the default
   * locale per-template when the requested locale has no entry.
   *
   * @throws when neither the requested locale nor the default locale has the
   *         template — that's a configuration bug, not a runtime path.
   */
  resolveCopy(
    templateId: LocalizedTemplateId,
    locale: SupportedLocale,
  ): { copy: LocalizedCopy; resolvedLocale: SupportedLocale; fellBack: boolean } {
    const requested = this.catalog[locale]?.[templateId];
    if (requested) {
      return { copy: requested, resolvedLocale: locale, fellBack: locale !== this.defaultLocale ? false : false };
    }
    const fallback = this.catalog[this.defaultLocale]?.[templateId];
    if (!fallback) {
      throw new Error(`No template "${templateId}" found for locale "${locale}" or default "${this.defaultLocale}"`);
    }
    return { copy: fallback, resolvedLocale: this.defaultLocale, fellBack: true };
  }

  /**
   * Render a localised template with the caller's variables. Missing variables
   * are recorded but never leaked to the recipient — the placeholder is
   * replaced with an empty string.
   */
  renderLocalized(
    templateId: LocalizedTemplateId,
    locale: string | undefined,
    variables: Record<string, string> = {},
  ): RenderedTemplate {
    const resolvedLocale = resolveLocale(locale);
    const { copy, resolvedLocale: usedLocale, fellBack } = this.resolveCopy(templateId, resolvedLocale);

    const subject = substituteVariables(copy.subject, variables);
    const body = substituteVariables(copy.body, variables);

    const missingVariables = [...new Set([...subject.missing, ...body.missing])];

    return {
      templateId,
      resolvedLocale: usedLocale,
      fellBack,
      subject: subject.text,
      body: body.text,
      missingVariables,
    };
  }
}

/** Default singleton — uses the bundled catalog and `en` fallback. */
export const localizedTemplateService = new LocalizedTemplateService();
