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
  type:
    | 'api_key_created'
    | 'environment_created'
    | 'request_made'
    | 'error_occurred'
    | 'webhook_triggered';
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
  type: 'info' | 'warning' | 'success' | 'error';
  publishedAt: Date;
  expiresAt?: Date;
}

export interface IntegrationGuide {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  prerequisites: string[];
  steps: IntegrationStep[];
}

export interface IntegrationStep {
  id: string;
  title: string;
  description: string;
  code?: string;
  language?: string;
  notes?: string[];
}
