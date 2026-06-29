/**
 * Webhook Management REST API
 *
 * Thin request/response wrapper around WebhookDeliveryService, following the
 * ApiResponse<T> convention used elsewhere in the backend (see sandbox/api/sandboxApi.ts).
 * There is no live HTTP server in this codebase yet — these methods are the
 * handlers an Express/Fastify route would call directly.
 */

import {
  WebhookDeliveryService,
  webhookDeliveryService,
  RegisterWebhookInput,
} from './webhook';
import type { WebhookConfig, WebhookDelivery, WebhookEventInput } from '../../../src/types/webhook';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

const ok = <T>(data: T, message?: string): ApiResponse<T> => ({ success: true, data, message });
const fail = (error: unknown, fallback: string): ApiResponse<never> => ({
  success: false,
  error: error instanceof Error ? error.message : fallback,
});

export class WebhookManagementApi {
  constructor(private readonly service: WebhookDeliveryService = webhookDeliveryService) {}

  registerWebhook(input: RegisterWebhookInput): ApiResponse<WebhookConfig> {
    try {
      return ok(this.service.registerWebhook(input), 'Webhook registered');
    } catch (error) {
      return fail(error, 'Failed to register webhook');
    }
  }

  updateWebhook(
    id: string,
    input: Partial<Omit<RegisterWebhookInput, 'merchantId'>>
  ): ApiResponse<WebhookConfig> {
    try {
      return ok(this.service.updateWebhook(id, input), 'Webhook updated');
    } catch (error) {
      return fail(error, 'Failed to update webhook');
    }
  }

  deleteWebhook(id: string): ApiResponse<null> {
    try {
      this.service.deleteWebhook(id);
      return ok(null, 'Webhook deleted');
    } catch (error) {
      return fail(error, 'Failed to delete webhook');
    }
  }

  pauseWebhook(id: string): ApiResponse<WebhookConfig> {
    try {
      return ok(this.service.pauseWebhook(id), 'Webhook paused');
    } catch (error) {
      return fail(error, 'Failed to pause webhook');
    }
  }

  resumeWebhook(id: string): ApiResponse<WebhookConfig> {
    try {
      return ok(this.service.resumeWebhook(id), 'Webhook resumed');
    } catch (error) {
      return fail(error, 'Failed to resume webhook');
    }
  }

  /** Rotates the signing secret. `overlapMs` controls how long the old secret stays valid. */
  rotateSecret(id: string, newSecret: string, overlapMs?: number): ApiResponse<WebhookConfig> {
    try {
      return ok(this.service.rotateSecret(id, newSecret, overlapMs), 'Secret rotated');
    } catch (error) {
      return fail(error, 'Failed to rotate webhook secret');
    }
  }

  listWebhooks(merchantId: string): ApiResponse<WebhookConfig[]> {
    return ok(this.service.listWebhooks(merchantId));
  }

  getWebhook(id: string): ApiResponse<WebhookConfig> {
    const webhook = this.service.getWebhook(id);
    if (!webhook) return fail(null, `Webhook ${id} not found`);
    return ok(webhook);
  }

  /** Emits a lifecycle event. Pass the client's `Idempotency-Key` header via `input.idempotencyKey`. */
  async emitEvent(input: WebhookEventInput): Promise<ApiResponse<WebhookDelivery>> {
    try {
      const result = await this.service.deliverEvent(input);
      if (!result) return fail(null, 'Webhook not found, not subscribed to this event, or merchant mismatch');
      return ok(result.delivery, `Delivery ${result.delivery.status}`);
    } catch (error) {
      return fail(error, 'Failed to emit webhook event');
    }
  }

  getDeliveryLogs(webhookId: string, limit = 50): ApiResponse<WebhookDelivery[]> {
    return ok(this.service.getWebhookDeliveries(webhookId, limit));
  }

  getDelivery(deliveryId: string): ApiResponse<WebhookDelivery> {
    const delivery = this.service.getDelivery(deliveryId);
    if (!delivery) return fail(null, `Delivery ${deliveryId} not found`);
    return ok(delivery);
  }

  async retryDelivery(deliveryId: string): Promise<ApiResponse<WebhookDelivery>> {
    try {
      const result = await this.service.retryWebhookDelivery(deliveryId);
      return ok(result.delivery, `Delivery ${result.delivery.status}`);
    } catch (error) {
      return fail(error, 'Failed to retry delivery');
    }
  }

  listDeadLetters(webhookId?: string): ApiResponse<WebhookDelivery[]> {
    return ok(this.service.listDeadLetters(webhookId));
  }

  async replayDeadLetter(deliveryId: string): Promise<ApiResponse<WebhookDelivery>> {
    try {
      const result = await this.service.replayDeadLetter(deliveryId);
      return ok(result.delivery, `Delivery ${result.delivery.status}`);
    } catch (error) {
      return fail(error, 'Failed to replay dead-lettered delivery');
    }
  }

  getAnalytics(webhookId: string) {
    return ok(this.service.getAnalytics(webhookId));
  }
}

export const webhookManagementApi = new WebhookManagementApi();
