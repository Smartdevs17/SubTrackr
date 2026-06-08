import { subscriptionEventStore } from './subscription/subscriptionEventStore';
import { elasticsearchService } from './subscription/ElasticsearchService';
import { MeteringService } from './billing/meteringService';
import { PricingService } from './billing/pricingService';
import { TaxService } from './billing/taxService';
import { dunningService } from './billing/dunningService';
import { NotificationPreferenceService } from './notification/preferenceService';
import { AlertingService } from './notification/alerting';
import { webhookDeliveryService } from './notification/webhook';
import { webSocketServer } from './notification/websocket';
import { CampaignService } from './analytics/campaignService';
import { DataPipelineService } from './analytics/dataPipeline';
import { DataWarehouseService } from './analytics/dataWarehouse';
import { PredictionService } from './analytics/predictionService';
import { RecommendationService } from './analytics/recommendationService';
import { RetentionService } from './analytics/retentionService';
import { oracleMonitorService } from './analytics/oracleMonitorService';

export class Container {
  private services = new Map<string | symbol, any>();
  private factories = new Map<string | symbol, (c: Container) => any>();

  /** Register a singleton instance of a service. */
  register<T>(token: string | symbol | { new (...args: any[]): T }, instance: T): void {
    const key = typeof token === 'function' ? token.name : token;
    this.services.set(key, instance);
  }

  /** Register a factory function for lazy resolution. */
  registerFactory<T>(token: string | symbol | { new (...args: any[]): T }, factory: (c: Container) => T): void {
    const key = typeof token === 'function' ? token.name : token;
    this.factories.set(key, factory);
  }

  /** Resolve a dependency by its token or constructor. */
  resolve<T>(token: string | symbol | { new (...args: any[]): T }): T {
    const key = typeof token === 'function' ? token.name : token;
    if (this.services.has(key)) {
      return this.services.get(key);
    }
    if (this.factories.has(key)) {
      const factory = this.factories.get(key);
      const instance = factory(this);
      this.services.set(key, instance); // Cache as singleton
      return instance;
    }
    throw new Error(`Service not registered for token: ${String(key)}`);
  }

  /** Reset all registered services and factories (useful for test isolation). */
  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}

export const container = new Container();

// ── Default Bindings ──────────────────────────────────────────────────────────
container.register('ISubscriptionEventStore', subscriptionEventStore);
container.register('IElasticsearchService', elasticsearchService);

container.register('IMeteringService', new MeteringService());
container.register('IPricingService', new PricingService());
container.register('ITaxService', new TaxService());
container.register('IDunningService', dunningService);

container.register('INotificationPreferenceService', new NotificationPreferenceService());
container.register('IAlertingService', new AlertingService());
container.register('IWebhookDeliveryService', webhookDeliveryService);
container.register('IWebsocketService', webSocketServer);

container.register('ICampaignService', new CampaignService());
container.register('IDataPipelineService', new DataPipelineService());
container.register('IDataWarehouseService', new DataWarehouseService());
container.register('IPredictionService', new PredictionService());
container.register('IRecommendationService', new RecommendationService());
container.register('IRetentionService', new RetentionService());
container.register('IOracleMonitorService', oracleMonitorService);
