/**
 * Server-side HTML sanitization for rich-text template fields.
 *
 * Issue #611: Email and notification templates accept rich text containing
 * HTML. Without sanitization these fields are stored XSS vectors — a malicious
 * admin can inject `<script>` (or `onerror`, `javascript:` URLs, hostile SVGs)
 * that execute in other admins' browsers when a template is previewed or sent.
 *
 * This service wraps DOMPurify (running in a jsdom window so it works in Node)
 * and enforces a strict allowlist:
 *   - Tags:        p span a img table tr td th h1-h6 ul ol li strong em br hr
 *   - Attributes:  href src alt style class target  (rel=noreferrer forced)
 *   - Protocols:   href only http:/https:/mailto:  (javascript:/data:/vbscript: rejected)
 *   - SVG:         all SVG tags/attributes stripped (common XSS vector)
 *
 * `dompurify` and `jsdom` are backend-only dependencies, dynamically imported
 * so this module never lands in the React Native bundle and so environments
 * without them fail loudly only when sanitization is actually invoked.
 */

// ── Allowlists ────────────────────────────────────────────────────────────────

export const ALLOWED_TAGS = [
  'p', 'span', 'a', 'img', 'table', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr',
] as const;

export const ALLOWED_ATTR = ['href', 'src', 'alt', 'style', 'class', 'target'] as const;

/** Protocols permitted in `href`. Everything else (javascript:, data:, vbscript:) is rejected. */
export const ALLOWED_URI_PROTOCOLS = ['http', 'https', 'mailto'] as const;

// DOMPurify URI regexp: allow only the protocols above, plus relative/anchor URIs.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

export interface SanitizeResult {
  /** The sanitized, safe-to-store HTML. */
  clean: string;
  /** True when sanitization removed or altered content (i.e. input was unsafe). */
  modified: boolean;
  /** Number of nodes/attributes DOMPurify removed. */
  removedCount: number;
}

// ── DOMPurify factory (lazy, memoised) ────────────────────────────────────────

interface DOMPurifyInstance {
  sanitize(dirty: string, config: Record<string, unknown>): string;
  addHook(entry: string, cb: (node: unknown) => void): void;
  removed: unknown[];
}

let _purify: DOMPurifyInstance | null = null;

async function getPurify(): Promise<DOMPurifyInstance> {
  if (_purify) return _purify;

  const { JSDOM } = (await import('jsdom')) as {
    JSDOM: new (html: string) => { window: unknown };
  };
  const createDOMPurify = (await import('dompurify')).default as (
    win: unknown,
  ) => DOMPurifyInstance;

  const { window } = new JSDOM('');
  const purify = createDOMPurify(window);

  // Force rel="noreferrer noopener" on every link and constrain target.
  purify.addHook('afterSanitizeAttributes', (node: unknown) => {
    const el = node as {
      tagName?: string;
      getAttribute(name: string): string | null;
      setAttribute(name: string, value: string): void;
    };
    if (el.tagName === 'A' && el.getAttribute('target')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  });

  _purify = purify;
  return purify;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class HTMLSanitizerService {
  /**
   * Sanitize a rich-text HTML string against the template allowlist.
   * Returns the clean HTML plus whether anything was stripped.
   */
  async sanitize(dirty: string): Promise<SanitizeResult> {
    if (dirty == null || dirty === '') {
      return { clean: '', modified: false, removedCount: 0 };
    }

    const purify = await getPurify();

    const clean = purify.sanitize(dirty, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
      ALLOWED_URI_REGEXP,
      // Strip SVG and MathML entirely — both are common XSS vectors.
      FORBID_TAGS: ['svg', 'math', 'script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'formaction'],
      USE_PROFILES: { html: true },
      // Keep text content of removed elements, but never their markup.
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false,
    });

    const removedCount = Array.isArray(purify.removed) ? purify.removed.length : 0;
    // Normalise whitespace differences so a no-op sanitize isn't flagged as modified.
    const modified = removedCount > 0 || normalize(clean) !== normalize(dirty);

    return { clean, modified, removedCount };
  }

  /**
   * Convenience: returns only the clean HTML.
   */
  async clean(dirty: string): Promise<string> {
    return (await this.sanitize(dirty)).clean;
  }

  /**
   * Returns true if the input contains content that would be stripped — useful
   * for the back-scan job's quarantine decision without mutating storage.
   */
  async isUnsafe(html: string): Promise<boolean> {
    return (await this.sanitize(html)).modified;
  }
}

function normalize(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

/** Shared singleton instance. */
export const htmlSanitizer = new HTMLSanitizerService();
