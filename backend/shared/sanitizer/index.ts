/**
 * Issue #611: HTML sanitization for rich-text template fields.
 */
export {
  HTMLSanitizerService,
  htmlSanitizer,
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_PROTOCOLS,
  type SanitizeResult,
} from './htmlSanitizer';
