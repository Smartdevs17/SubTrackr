import { NotificationPreferences } from './preferenceService';
import { AlertChannelConfig, Alert } from '../shared/types';
import {
  RegisterWebhookInput,
  WebhookDeliveryResult,
  WebhookEventInput,
} from './webhook';
import {
  WebhookConfig,
  WebhookDelivery,
  WebhookAnalytics,
} from '../../../src/types/webhook';
import {
  SubscriptionEvent as WSEvent,
  EventFilter as WSEventFilter,
  ClientInfo as WSClientInfo,
} from './websocket';

export interface INotificationPreferenceService {
  getPreferences(userId: string): Promise<NotificationPreferences | null>;
  updatePreferences(userId: string, prefs: Partial<NotificationPreferences>): Promise<boolean>;
  shouldDeliverNow(prefs: NotificationPreferences): boolean;
}

export interface IAlertingService {
  addChannel(config: AlertChannelConfig): void;
  dispatch(alert: Alert): Promise<void>;
  dispatchAll(alerts: Alert[]): Promise<void>;
}

export interface IWebhookDeliveryService {
  registerWebhook(input: RegisterWebhookInput): WebhookConfig;
  updateWebhook(id: string, input: Partial<Omit<RegisterWebhookInput, 'merchantId'>>): WebhookConfig;
  deleteWebhook(id: string): void;
  pauseWebhook(id: string): WebhookConfig;
  resumeWebhook(id: string): WebhookConfig;
  listWebhooks(merchantId: string): WebhookConfig[];
  getWebhook(id: string): WebhookConfig | undefined;
  getWebhookDeliveries(webhookId: string, limit: number): WebhookDelivery[];
  getDelivery(deliveryId: string): WebhookDelivery | undefined;
  getAnalytics(webhookId: string): WebhookAnalytics;
  checkWebhookHealth(id: string): Promise<WebhookConfig>;
  deliverEvent(input: WebhookEventInput): Promise<WebhookDeliveryResult | null>;
  retryWebhookDelivery(deliveryId: string): Promise<WebhookDeliveryResult>;
}

export interface IWebsocketService {
  connect(
    clientId: string,
    userId: string,
    send: (event: WSEvent) => void,
    filter?: WSEventFilter
  ): WSClientInfo;
  disconnect(clientId: string): void;
  getPresence(): WSClientInfo[];
  isConnected(clientId: string): boolean;
  broadcast(event: WSEvent): number;
  setFilter(clientId: string, filter: WSEventFilter): void;
  readonly clientCount: number;
}
