import {
  PortalUser,
  PortalDashboard,
  EnvironmentSummary,
  ActivityEntry,
  QuickLink,
  Announcement,
} from '../types/portal';

export class DeveloperPortalService {
  private users: Map<string, PortalUser> = new Map();
  private activities: Map<string, ActivityEntry[]> = new Map();

  async getDashboard(userId: string): Promise<PortalDashboard> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      environments: await this.getEnvironmentSummaries(userId),
      recentActivity: this.getRecentActivity(userId),
      quickLinks: this.getQuickLinks(),
      announcements: this.getAnnouncements(),
    };
  }

  async createUser(
    email: string,
    name: string,
    company: string,
    role: PortalUser['role'] = 'developer'
  ): Promise<PortalUser> {
    const existingUser = Array.from(this.users.values()).find(
      u => u.email === email
    );

    if (existingUser) {
      throw new Error('User already exists');
    }

    const user: PortalUser = {
      id: crypto.randomUUID(),
      email,
      name,
      company,
      role,
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    this.activities.set(user.id, []);

    return user;
  }

  async getUser(userId: string): Promise<PortalUser | null> {
    return this.users.get(userId) || null;
  }

  async updateUser(
    userId: string,
    updates: Partial<Pick<PortalUser, 'name' | 'company' | 'avatar'>>
  ): Promise<PortalUser | null> {
    const user = this.users.get(userId);
    if (!user) return null;

    Object.assign(user, updates);
    this.users.set(userId, user);

    return user;
  }

  async logActivity(
    userId: string,
    type: ActivityEntry['type'],
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const activities = this.activities.get(userId) || [];

    activities.unshift({
      id: crypto.randomUUID(),
      type,
      description,
      timestamp: new Date(),
      metadata,
    });

    this.activities.set(userId, activities.slice(0, 100));
  }

  private async getEnvironmentSummaries(
    userId: string
  ): Promise<EnvironmentSummary[]> {
    return [
      {
        id: '1',
        name: 'Development Sandbox',
        status: 'active',
        requestCount: 1250,
        errorRate: 2.3,
        lastActivity: new Date(),
      },
      {
        id: '2',
        name: 'Staging Environment',
        status: 'active',
        requestCount: 5430,
        errorRate: 0.8,
        lastActivity: new Date(Date.now() - 3600000),
      },
    ];
  }

  private getRecentActivity(userId: string): ActivityEntry[] {
    const activities = this.activities.get(userId) || [];
    return activities.slice(0, 10);
  }

  private getQuickLinks(): QuickLink[] {
    return [
      {
        id: '1',
        title: 'API Documentation',
        description: 'Explore the complete API reference',
        url: '/docs/api',
        icon: 'book',
      },
      {
        id: '2',
        title: 'Create API Key',
        description: 'Generate a new API key for your application',
        url: '/api-keys/create',
        icon: 'key',
      },
      {
        id: '3',
        title: 'Integration Guides',
        description: 'Step-by-step guides for common integrations',
        url: '/guides',
        icon: 'puzzle',
      },
      {
        id: '4',
        title: 'API Playground',
        description: 'Test API endpoints in real-time',
        url: '/playground',
        icon: 'terminal',
      },
    ];
  }

  private getAnnouncements(): Announcement[] {
    return [
      {
        id: '1',
        title: 'New Sandbox Features Available',
        message:
          'We have added support for webhooks and real-time notifications in sandbox environments.',
        type: 'info',
        publishedAt: new Date(Date.now() - 86400000),
      },
      {
        id: '2',
        title: 'Scheduled Maintenance',
        message:
          'Planned maintenance on Sunday, 2:00 AM - 4:00 AM UTC. Sandbox environments may be briefly unavailable.',
        type: 'warning',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 604800000),
      },
    ];
  }
}
