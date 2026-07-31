/**
 * Unified Webhook System — Issue #727
 *
 * This barrel file is the single entry point for the SubTrackr subscription
 * webhook system as specified in the Technical Scope of issue #727.
 *
 * It re-exports:
 *  - WebhookDeliveryService       — core delivery, retry, rate limiting, DLQ
 *  - WebhookManagementApi         — REST-style handler wrappers
 *  - Helper utilities             — sign, verify, build payload
 *  - EventCatalogRegistry         — event type catalog with wildcard matching
 *  - EventSchemaValidator         — payload validation + example generation
 */

// ── Core Delivery Service ─────────────────────────────────────────────────────
export {
  WebhookDeliveryService,
  webhookDeliveryService,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSignatureAny,
  isWebhookEventAllowed,
  WEBHOOK_IDEMPOTENCY_HEADER,
} from './webhook';

export type {
  RegisterWebhookInput,
  WebhookDeliveryResult,
} from './webhook';

// Re-export shared webhook types used by both layers
export type {
  WebhookEventInput,
} from './webhook';

// ── Management API ────────────────────────────────────────────────────────────
export { WebhookManagementApi, webhookManagementApi } from './webhookManagementApi';
export type { ApiResponse as WebhookApiResponse } from './webhookManagementApi';

// ── Event Catalog ─────────────────────────────────────────────────────────────
export {
  EventCatalogRegistry,
  eventCatalog,
  EVENT_CATALOG,
} from '../webhook/eventCatalog';
export type {
  EventDefinition,
  EventCategory,
  SchemaField,
} from '../webhook/eventCatalog';

// ── Event Schema Validator ────────────────────────────────────────────────────
export { EventSchemaValidator, eventSchemaValidator } from '../webhook/eventSchemaValidator';
export type { ValidationResult } from '../webhook/eventSchemaValidator';
