import { AccountRecoveryService } from '../domain/AccountRecoveryService';

describe('AccountRecoveryService', () => {
  let service: AccountRecoveryService;

  beforeEach(() => {
    service = new AccountRecoveryService({
      maxInitiationsPerIdentifier: 3,
      maxInitiationsPerIp: 5,
      maxVerificationAttempts: 2,
    });
  });

  describe('Full Recovery Flow', () => {
    it('successfully initiates, verifies identity, and completes recovery', async () => {
      // Step 1: Initiate
      const { recoveryId, rawToken } = await service.initiateRecovery({
        identifier: 'user@example.com',
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
        challengeAnswer: 'my_pet_dog',
      });

      expect(recoveryId).toMatch(/^rec_/);
      expect(rawToken).toBeDefined();

      // Step 2: Verify Identity
      const verifyResult = await service.verifyIdentity({
        recoveryId,
        token: rawToken,
        challengeAnswer: 'my_pet_dog',
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
      });

      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.grantToken).toBeDefined();

      // Step 3: Complete Recovery
      const completeResult = await service.completeRecovery({
        recoveryId,
        grantToken: verifyResult.grantToken,
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
      });

      expect(completeResult.success).toBe(true);
      expect(completeResult.identifier).toBe('user@example.com');
      expect(completeResult.completedAt).toBeDefined();
    });

    it('prevents replay attack using consumed grant token', async () => {
      const { recoveryId, rawToken } = await service.initiateRecovery({
        identifier: 'user2@example.com',
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
      });

      const { grantToken } = await service.verifyIdentity({
        recoveryId,
        token: rawToken,
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
      });

      // First completion succeeds
      await service.completeRecovery({
        recoveryId,
        grantToken,
        ip: '192.0.2.1',
        userAgent: 'JestTestRunner',
      });

      // Second completion fails
      await expect(
        service.completeRecovery({
          recoveryId,
          grantToken,
          ip: '192.0.2.1',
          userAgent: 'JestTestRunner',
        })
      ).rejects.toThrow(/not in verified status/);
    });
  });

  describe('Identity Verification Security', () => {
    it('rejects incorrect recovery token and tracks failed attempts', async () => {
      const { recoveryId } = await service.initiateRecovery({
        identifier: 'security@example.com',
        ip: '192.0.2.2',
        userAgent: 'Browser',
      });

      await expect(
        service.verifyIdentity({
          recoveryId,
          token: 'wrong_token',
          ip: '192.0.2.2',
          userAgent: 'Browser',
        })
      ).rejects.toThrow(/Identity verification failed/);
    });

    it('locks recovery session when max attempts are exceeded', async () => {
      const { recoveryId, rawToken } = await service.initiateRecovery({
        identifier: 'lockout@example.com',
        ip: '192.0.2.3',
        userAgent: 'Browser',
      });

      // Attempt 1 fails
      await expect(
        service.verifyIdentity({ recoveryId, token: 'bad1', ip: '192.0.2.3', userAgent: 'Browser' })
      ).rejects.toThrow();

      // Attempt 2 fails and locks session (maxVerificationAttempts = 2)
      await expect(
        service.verifyIdentity({ recoveryId, token: 'bad2', ip: '192.0.2.3', userAgent: 'Browser' })
      ).rejects.toThrow();

      // Attempt 3 with correct token now rejected because session is locked
      await expect(
        service.verifyIdentity({ recoveryId, token: rawToken, ip: '192.0.2.3', userAgent: 'Browser' })
      ).rejects.toThrow(/locked/);
    });
  });

  describe('Rate Limiting', () => {
    it('enforces rate limits per identifier', async () => {
      const identifier = 'ratelimit@example.com';
      // 3 attempts are allowed
      await service.initiateRecovery({ identifier, ip: '1.1.1.1', userAgent: 'Test' });
      await service.initiateRecovery({ identifier, ip: '1.1.1.2', userAgent: 'Test' });
      await service.initiateRecovery({ identifier, ip: '1.1.1.3', userAgent: 'Test' });

      // 4th attempt exceeds limit
      await expect(
        service.initiateRecovery({ identifier, ip: '1.1.1.4', userAgent: 'Test' })
      ).rejects.toThrow(/Too many recovery requests/);
    });

    it('enforces rate limits per IP address', async () => {
      const ip = '10.20.30.40';
      for (let i = 0; i < 5; i++) {
        await service.initiateRecovery({ identifier: `user_${i}@example.com`, ip, userAgent: 'Test' });
      }

      // 6th attempt from same IP exceeds limit
      await expect(
        service.initiateRecovery({ identifier: 'user_overflow@example.com', ip, userAgent: 'Test' })
      ).rejects.toThrow(/Too many recovery requests/);
    });
  });

  describe('Audit Logging', () => {
    it('records audit trail for every action across recovery lifecycle', async () => {
      const identifier = 'audit@example.com';
      const { recoveryId, rawToken } = await service.initiateRecovery({
        identifier,
        ip: '10.0.0.1',
        userAgent: 'Agent',
      });

      const { grantToken } = await service.verifyIdentity({
        recoveryId,
        token: rawToken,
        ip: '10.0.0.1',
        userAgent: 'Agent',
      });

      await service.completeRecovery({
        recoveryId,
        grantToken,
        ip: '10.0.0.1',
        userAgent: 'Agent',
      });

      const auditTrail = service.getAuditTrail(identifier);
      const actions = auditTrail.map((a) => a.action);

      expect(actions).toContain('recovery_initiated');
      expect(actions).toContain('identity_verified');
      expect(actions).toContain('recovery_completed');

      expect(auditTrail[0].ip).toBe('10.0.0.1');
      expect(auditTrail[0].timestamp).toBeDefined();
    });
  });
});
