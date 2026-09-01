import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { developerPortalService } from '../developerPortalService';
import type { DeveloperProfile, OnboardingStep, DocumentationSection, IntegrationGuide } from '../../types/developerPortal';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

describe('DeveloperPortalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerDeveloper', () => {
    it('registers a new developer', async () => {
      const developer = await developerPortalService.registerDeveloper(
        'test@example.com',
        'Test User',
        'Acme',
        'https://example.com'
      );

      expect(developer.email).toBe('test@example.com');
      expect(developer.name).toBe('Test User');
      expect(developer.company).toBe('Acme');
      expect(developer.website).toBe('https://example.com');
      expect(developer.status).toBe('active');
      expect(developer.tier).toBe('free');
    });

    it('generates a unique id', async () => {
      const dev1 = await developerPortalService.registerDeveloper('a@b.com', 'A');
      const dev2 = await developerPortalService.registerDeveloper('c@d.com', 'C');
      expect(dev1.id).not.toBe(dev2.id);
    });
  });

  describe('getDeveloper', () => {
    it('returns null for unknown id', async () => {
      const dev = await developerPortalService.getDeveloper('dev_unknown');
      expect(dev).toBeNull();
    });
  });

  describe('updateDeveloper', () => {
    it('updates fields on an existing developer', async () => {
      const dev = await developerPortalService.registerDeveloper('upd@example.com', 'Updater');
      const updated = await developerPortalService.updateDeveloper(dev.id, { name: 'Updated Name' });
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.email).toBe('upd@example.com');
    });
  });

  describe('onboarding', () => {
    it('returns default onboarding steps after registration', async () => {
      const dev = await developerPortalService.registerDeveloper('onboard@example.com', 'Onboard');
      const steps = await developerPortalService.getOnboardingSteps(dev.id);
      expect(steps.length).toBeGreaterThan(0);
    });

    it('marks a step as completed', async () => {
      const dev = await developerPortalService.registerDeveloper('step@example.com', 'Step');
      const stepsBefore = await developerPortalService.getOnboardingSteps(dev.id);
      const targetStep = stepsBefore[0];
      const updated = await developerPortalService.completeOnboardingStep(dev.id, targetStep.id);
      expect(updated?.some((s) => s.id === targetStep.id && s.isCompleted)).toBe(true);
    });

    it('returns null for unknown developer', async () => {
      const steps = await developerPortalService.getOnboardingSteps('unknown');
      expect(steps).toEqual([]);
    });
  });

  describe('documentation', () => {
    it('returns all documentation sections', () => {
      const docs = developerPortalService.getDocumentationSections();
      expect(docs.length).toBeGreaterThan(0);
    });

    it('filters documentation by category', () => {
      const docs = developerPortalService.getDocumentationByCategory('API Reference');
      expect(docs.every((d) => d.category === 'API Reference')).toBe(true);
    });

    it('finds documentation by slug', () => {
      const doc = developerPortalService.getDocumentationBySlug('getting-started');
      expect(doc?.title).toBe('Getting Started');
    });

    it('searches documentation by title', () => {
      const docs = developerPortalService.searchDocumentation('Webhooks');
      expect(docs.some((d) => d.title === 'Webhooks')).toBe(true);
    });

    it('searches documentation by tag', () => {
      const docs = developerPortalService.searchDocumentation('nodejs');
      expect(docs.some((d) => d.tags.includes('nodejs'))).toBe(true);
    });
  });

  describe('integration guides', () => {
    it('returns all integration guides', () => {
      const guides = developerPortalService.getIntegrationGuides();
      expect(guides.length).toBeGreaterThan(0);
    });

    it('filters guides by difficulty', () => {
      const guides = developerPortalService.getIntegrationGuidesByDifficulty('beginner');
      expect(guides.every((g) => g.difficulty === 'beginner')).toBe(true);
    });

    it('searches guides by title', () => {
      const guides = developerPortalService.searchIntegrationGuides('Python');
      expect(guides.some((g) => g.title === 'Python Quickstart')).toBe(true);
    });

    it('searches guides by tag', () => {
      const guides = developerPortalService.searchIntegrationGuides('webhooks');
      expect(guides.some((g) => g.tags.includes('webhooks'))).toBe(true);
    });
  });
});
