import { AdvisoryLockService } from '../AdvisoryLockService';
import { LockingError } from '../errors';

describe('AdvisoryLockService', () => {
  let lockService: AdvisoryLockService;

  beforeEach(() => {
    lockService = new AdvisoryLockService({ timeoutMs: 1000, retryAttempts: 2, retryBaseDelayMs: 10 });
  });

  describe('acquire', () => {
    it('acquires a lock for a subscription', async () => {
      const lockId = await lockService.acquire('sub-1');
      expect(lockId).toBeDefined();
      expect(typeof lockId).toBe('string');
    });

    it('throws LockingError when lock times out', async () => {
      await lockService.acquire('sub-1');
      await expect(lockService.acquire('sub-1')).rejects.toThrow(LockingError);
    });
  });

  describe('release', () => {
    it('releases an acquired lock', async () => {
      const lockId = await lockService.acquire('sub-2');
      await expect(lockService.release(lockId)).resolves.not.toThrow();
      const lockId2 = await lockService.acquire('sub-2');
      expect(lockId2).toBeDefined();
    });
  });

  describe('withLock', () => {
    it('executes function within lock', async () => {
      const result = await lockService.withLock('sub-3', async () => 'done');
      expect(result).toBe('done');
    });

    it('releases lock after function throws', async () => {
      await expect(
        lockService.withLock('sub-4', async () => { throw new Error('fail'); })
      ).rejects.toThrow('fail');
      const lockId = await lockService.acquire('sub-4');
      expect(lockId).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('returns lock metrics', async () => {
      const metrics = lockService.getMetrics();
      expect(metrics).toHaveProperty('lockAcquisitionTime');
      expect(metrics).toHaveProperty('contentionCount');
      expect(metrics).toHaveProperty('timeoutCount');
    });
  });
});
