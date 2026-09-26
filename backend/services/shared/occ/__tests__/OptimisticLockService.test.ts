import { checkVersion, VersionedEntity } from '../OptimisticLockService';

describe('OptimisticLockService', () => {
  const actor = { id: 'user-123', type: 'user' as const };

  describe('checkVersion', () => {
    it('should succeed if versions match', () => {
      const clientEntity: VersionedEntity = { id: 'sub-1', version: 2 };
      const dbEntity: VersionedEntity = { id: 'sub-1', version: 2 };

      const result = checkVersion({ clientEntity, dbEntity, actor });

      expect(result.success).toBe(true);
    });

    it('should fail with 409 conflict if versions mismatch', () => {
      const clientEntity: VersionedEntity = { id: 'sub-1', version: 1 };
      const dbEntity: VersionedEntity = { id: 'sub-1', version: 2 };

      const result = checkVersion({ clientEntity, dbEntity, actor });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT_VERSION_MISMATCH');
        expect(result.error.message).toContain('The resource was updated by another process.');
        expect(result.error.version).toBe(2);
        expect(result.meta.apiVersion).toBe(1);
      }
    });

    it('should succeed if force=true is used, even with version mismatch', () => {
      const clientEntity: VersionedEntity = { id: 'sub-1', version: 1 };
      const dbEntity: VersionedEntity = { id: 'sub-1', version: 2 };

      const result = checkVersion({ clientEntity, dbEntity, actor, force: true });

      expect(result.success).toBe(true);
    });

    it('should include requestId in meta for both success and failure', () => {
      const requestId = 'test-request-id';

      // Success case
      const successResult = checkVersion({
        clientEntity: { id: 'sub-1', version: 1 },
        dbEntity: { id: 'sub-1', version: 1 },
        actor,
        requestId,
      });
      expect(successResult.meta.requestId).toBe(requestId);

      // Failure case
      const failureResult = checkVersion({
        clientEntity: { id: 'sub-1', version: 1 },
        dbEntity: { id: 'sub-1', version: 2 },
        actor,
        requestId,
      });
      expect(failureResult.meta.requestId).toBe(requestId);
    });

    it('should handle a complex entity type', () => {
      interface Subscription extends VersionedEntity {
        name: string;
        status: 'active' | 'paused';
      }

      const clientEntity: Subscription = {
        id: 'sub-1',
        version: 3,
        name: 'New Name',
        status: 'paused',
      };
      const dbEntity: Subscription = {
        id: 'sub-1',
        version: 4,
        name: 'Old Name',
        status: 'active',
      };

      const result = checkVersion({ clientEntity, dbEntity, actor });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.version).toBe(4);
      }
    });
  });
});