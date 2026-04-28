export enum CampaignType {
  WELCOME = 'welcome',
  RETENTION = 'retention',
  RE_ENGAGEMENT = 're_engagement',
  PROMOTIONAL = 'promotional',
  WINBACK = 'winback',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export enum DeliveryChannel {
  EMAIL = 'email',
  PUSH = 'push',
  IN_APP = 'in_app',
}

export enum AutomationTrigger {
  SUBSCRIPTION_CREATED = 'subscription_created',
  SUBSCRIPTION_RENEWED = 'subscription_renewed',
  SUBSCRIPTION_CANCELLED = 'subscription_cancelled',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_SUCCESS = 'payment_success',
  INACTIVE_DAYS = 'inactive_days',
  BIRTHDAY = 'birthday',
}

export interface CampaignContent {
  subject?: string;
  title: string;
  body: string;
  imageUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
}

export interface CampaignSchedule {
  startDate: Date;
  endDate?: Date;
  sendTime?: string;
  timezone?: string;
}

export interface CampaignTarget {
  segmentIds: string[];
  subscriberFilters?: {
    minTenureDays?: number;
    maxTenureDays?: number;
    minSpend?: number;
    maxSpend?: number;
    hasFailedPayment?: boolean;
  };
}

export interface CampaignAutomation {
  trigger: AutomationTrigger;
  delayDays?: number;
  conditions?: Record<string, unknown>;
}

export interface CampaignAnalytics {
  campaignId: string;
  totalRecipients: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  convertedCount: number;
  revenue: number;
  startDate: Date;
  endDate?: Date;
}

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  content: CampaignContent;
  target: CampaignTarget;
  schedule?: CampaignSchedule;
  automations?: CampaignAutomation[];
  channels: DeliveryChannel[];
  budget?: number;
  analytics?: CampaignAnalytics;
  createdAt: Date;
  updatedAt: Date;
}