export interface ThresholdConfig {
  level: 50 | 75 | 90 | 100;
  enabled: boolean;
}

export interface UsageAlertConfig {
  meter_id: string;
  subscription_id: string;
  user_id: string;
  plan_limit: number;
  thresholds: ThresholdConfig[];
  channels: ('in_app' | 'email' | 'push' | 'sms')[];
}

export interface UsageAlert {
  id: string;
  subscription_id: string;
  user_id: string;
  meter_id: string;
  threshold_level: 50 | 75 | 90 | 100;
  current_usage: number;
  limit: number;
  burned_rate: number; // units/minute
  projected_completion: number; // unix timestamp
  created_at: number;
  cooldown_until: number | null;
}

export interface MeterUsageSnapshot {
  meter_id: string;
  subscription_id: string;
  user_id: string;
  current_usage: number;
  plan_limit: number;
  billing_period_start: number;
  billing_period_end: number;
  usage_percentage: number;
}
