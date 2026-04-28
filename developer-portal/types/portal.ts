export interface DeveloperPortalConfig {
  appName: string;
  version: string;
  baseUrl: string;
  supportEmail: string;
  documentationUrl: string;
  statusPageUrl: string;
}

export interface PortalUser {
  id: string;
  email: string;
  name: string;
  company: string;
  avatar?: string;
  role: 'developer' | 'admin' | 'viewer';
  createdAt: Date;
}

export interface PortalDashboard {
  environments: EnvironmentSummary[];
  recentActivity: ActivityEntry[];
  quickLinks: QuickLink[];
  announcements: Announcement[];
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  requestCount: number;
  errorRate: number;
  lastActivity: Date;
}

export interface ActivityEntry {
  id: string;
  type: 'api_key_created' | 'environment_created' | 'request_made' | 'error_occurred';
  description: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface QuickLink {
  id: string;
  title: string;
  description: string;
  url: string;
  icon: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success';
  publishedAt: Date;
  expiresAt?: Date;
}

export interface DocumentationSection {
  id: string;
  title: string;
  description: string;
  articles: DocumentationArticle[];
}

export interface DocumentationArticle {
  id: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string[];
  readTime: number;
  lastUpdated: Date;
}

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  steps: IntegrationStep[];
  prerequisites: string[];
}

export interface IntegrationStep {
  id: string;
  title: string;
  description: string;
  code?: string;
  language?: string;
  notes?: string[];
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

export type WebhookEvent =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'payment.completed'
  | 'payment.failed'
  | 'api_key.rotated'
  | 'environment.suspended';
