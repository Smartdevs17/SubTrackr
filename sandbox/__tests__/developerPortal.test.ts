import { DeveloperPortalService } from '../../developer-portal/services/portalService';
import { IntegrationGuidesService } from '../../developer-portal/services/integrationGuidesService';

describe('DeveloperPortalService', () => {
  let service: DeveloperPortalService;

  beforeEach(() => {
    service = new DeveloperPortalService();
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      const user = await service.createUser('test@example.com', 'Test User', 'Test Company');

      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.company).toBe('Test Company');
      expect(user.role).toBe('developer');
    });

    it('should not allow duplicate email', async () => {
      await service.createUser('test@example.com', 'User 1', 'Company 1');

      await expect(service.createUser('test@example.com', 'User 2', 'Company 2')).rejects.toThrow(
        'User already exists'
      );
    });

    it('should create user with custom role', async () => {
      const user = await service.createUser(
        'admin@example.com',
        'Admin User',
        'Admin Company',
        'admin'
      );

      expect(user.role).toBe('admin');
    });
  });

  describe('getUser', () => {
    it('should return null for non-existent user', async () => {
      const user = await service.getUser('non-existent');
      expect(user).toBeNull();
    });

    it('should return existing user', async () => {
      const created = await service.createUser('test@example.com', 'Test User', 'Test Company');

      const retrieved = await service.getUser(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.email).toBe('test@example.com');
    });
  });

  describe('updateUser', () => {
    it('should update user details', async () => {
      const user = await service.createUser('test@example.com', 'Test User', 'Test Company');

      const updated = await service.updateUser(user.id, {
        name: 'Updated Name',
        company: 'Updated Company',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.company).toBe('Updated Company');
    });

    it('should return null for non-existent user', async () => {
      const updated = await service.updateUser('non-existent', {
        name: 'Updated',
      });

      expect(updated).toBeNull();
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
      const user = await service.createUser('test@example.com', 'Test User', 'Test Company');

      const dashboard = await service.getDashboard(user.id);

      expect(dashboard).toBeDefined();
      expect(dashboard.environments).toBeDefined();
      expect(Array.isArray(dashboard.environments)).toBe(true);
      expect(dashboard.recentActivity).toBeDefined();
      expect(Array.isArray(dashboard.recentActivity)).toBe(true);
      expect(dashboard.quickLinks).toBeDefined();
      expect(Array.isArray(dashboard.quickLinks)).toBe(true);
      expect(dashboard.announcements).toBeDefined();
      expect(Array.isArray(dashboard.announcements)).toBe(true);
    });

    it('should throw for non-existent user', async () => {
      await expect(service.getDashboard('non-existent')).rejects.toThrow('User not found');
    });
  });

  describe('logActivity', () => {
    it('should log user activity', async () => {
      const user = await service.createUser('test@example.com', 'Test User', 'Test Company');

      await service.logActivity(user.id, 'api_key_created', 'New API key created');

      const dashboard = await service.getDashboard(user.id);
      expect(dashboard.recentActivity.length).toBeGreaterThan(0);
      expect(dashboard.recentActivity[0].type).toBe('api_key_created');
    });
  });
});

describe('IntegrationGuidesService', () => {
  let service: IntegrationGuidesService;

  beforeEach(() => {
    service = new IntegrationGuidesService();
  });

  describe('getGuides', () => {
    it('should return all guides', async () => {
      const guides = await service.getGuides();

      expect(guides).toBeDefined();
      expect(Array.isArray(guides)).toBe(true);
      expect(guides.length).toBeGreaterThan(0);
    });

    it('should return guides with required fields', async () => {
      const guides = await service.getGuides();

      guides.forEach((guide) => {
        expect(guide.id).toBeDefined();
        expect(guide.title).toBeDefined();
        expect(guide.description).toBeDefined();
        expect(guide.difficulty).toBeDefined();
        expect(guide.steps).toBeDefined();
        expect(Array.isArray(guide.steps)).toBe(true);
      });
    });
  });

  describe('getGuide', () => {
    it('should return specific guide', async () => {
      const guide = await service.getGuide('react-integration');

      expect(guide).toBeDefined();
      expect(guide?.title).toBe('React Integration');
    });

    it('should return null for non-existent guide', async () => {
      const guide = await service.getGuide('non-existent');
      expect(guide).toBeNull();
    });
  });

  describe('getGuidesByDifficulty', () => {
    it('should filter guides by difficulty', async () => {
      const beginnerGuides = await service.getGuidesByDifficulty('beginner');

      expect(beginnerGuides).toBeDefined();
      beginnerGuides.forEach((guide) => {
        expect(guide.difficulty).toBe('beginner');
      });
    });

    it('should return empty array for unused difficulty', async () => {
      const guides = await service.getGuidesByDifficulty('advanced');
      expect(guides).toBeDefined();
    });
  });

  describe('searchGuides', () => {
    it('should search guides by title', async () => {
      const guides = await service.searchGuides('React');

      expect(guides).toBeDefined();
      expect(guides.length).toBeGreaterThan(0);
      expect(guides[0].title).toContain('React');
    });

    it('should search guides by description', async () => {
      const guides = await service.searchGuides('blockchain');

      expect(guides).toBeDefined();
    });

    it('should return empty array for no matches', async () => {
      const guides = await service.searchGuides('nonexistentquery12345');

      expect(guides).toBeDefined();
      expect(guides.length).toBe(0);
    });
  });
});
