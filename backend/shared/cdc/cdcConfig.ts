export interface CdcConnectorConfig {
  name: string;
  slotName: string;
  publicationName: string;
  tableWhitelist: string[];
  plugin: 'pgoutput';
}

export interface ViewRefreshPolicy {
  viewName: string;
  refreshIntervalMs: number;
  category: 'realtime' | 'daily' | 'monthly';
}

const DEFAULT_REFRESH_POLICIES: ViewRefreshPolicy[] = [
  { viewName: 'active_subscriptions_summary', refreshIntervalMs: 300_000, category: 'realtime' },
  { viewName: 'subscriber_balance_mv', refreshIntervalMs: 300_000, category: 'realtime' },
  { viewName: 'monthly_revenue_mv', refreshIntervalMs: 300_000, category: 'realtime' },
  { viewName: 'churn_summary_mv', refreshIntervalMs: 300_000, category: 'realtime' },
  { viewName: 'mrr_mv', refreshIntervalMs: 300_000, category: 'realtime' },
  { viewName: 'cohort_retention_mv', refreshIntervalMs: 3_600_000, category: 'daily' },
  { viewName: 'ltv_mv', refreshIntervalMs: 86_400_000, category: 'monthly' },
];

export class CdcConnector {
  private config: CdcConnectorConfig;
  private policies: ViewRefreshPolicy[];

  constructor(config: CdcConnectorConfig, policies?: ViewRefreshPolicy[]) {
    this.config = config;
    this.policies = policies ?? DEFAULT_REFRESH_POLICIES;
  }

  getViewRefreshPolicies(): ViewRefreshPolicy[] {
    return this.policies;
  }

  getConfig(): CdcConnectorConfig {
    return this.config;
  }

  static createDefaultConnector(): CdcConnector {
    return new CdcConnector({
      name: 'subtrackr-cdc',
      slotName: 'subtrackr_replication_slot',
      publicationName: 'subtrackr_pub',
      tableWhitelist: ['subscriptions', 'transactions', 'plans'],
      plugin: 'pgoutput',
    });
  }
}
