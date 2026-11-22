import { DunningStage } from './dunning';

export interface DunningEmailVariant {
  id: string;
  name: string;
  subject: string;
  body: string;
  stage: DunningStage;
  weight: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DunningABTest {
  id: string;
  name: string;
  stage: DunningStage;
  variants: DunningEmailVariant[];
  status: 'draft' | 'running' | 'completed' | 'paused';
  startedAt?: number;
  completedAt?: number;
  winningVariantId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DunningABTestAssignment {
  id: string;
  testId: string;
  subscriberId: string;
  variantId: string;
  assignedAt: number;
}

export interface DunningABTestResult {
  testId: string;
  variantId: string;
  variantName: string;
  sends: number;
  opens: number;
  clicks: number;
  recoveries: number;
  openRate: number;
  clickRate: number;
  recoveryRate: number;
}

export interface DunningEmailSequence {
  id: string;
  name: string;
  stages: DunningSequenceStage[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DunningSequenceStage {
  stage: DunningStage;
  delayHours: number;
  variantId?: string;
  abTestId?: string;
  fallbackVariantId: string;
  maxAttempts: number;
}

export interface DunningEmailDeliveryLog {
  id: string;
  subscriberId: string;
  subscriptionId: string;
  stage: DunningStage;
  variantId: string;
  testId?: string;
  subject: string;
  channel: 'email' | 'push' | 'in_app';
  status: 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  sentAt: number;
  deliveredAt?: number;
  openedAt?: number;
  clickedAt?: number;
  errorMessage?: string;
}

export interface DunningDeliverabilityMetrics {
  totalSent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  deliveryRate: number;
  bounceRate: number;
  openRate: number;
  clickRate: number;
  byStage: Record<
    DunningStage,
    {
      sent: number;
      delivered: number;
      bounced: number;
      opened: number;
      clicked: number;
    }
  >;
  byVariant: Record<
    string,
    {
      sent: number;
      delivered: number;
      opened: number;
      clicked: number;
      recoveryRate: number;
    }
  >;
}
