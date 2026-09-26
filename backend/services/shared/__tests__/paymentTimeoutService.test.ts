import {
  PaymentTimeoutService,
  type ChainTimeoutConfig,
} from '../paymentTimeoutService';

const CHAIN_ID = 1;
const CHARGE_ID = 'charge_abc';
const SUB_ID = 'sub_xyz';
const GAS = BigInt(1_000_000);

function makeSvc(timeoutSecs = 300): PaymentTimeoutService {
  const svc = new PaymentTimeoutService();
  svc.setChainConfig({
    chainId: CHAIN_ID,
    timeoutSecs,
    gasBumpBps: 1500,
    maxRecoveryAttempts: 3,
    reorgSafetyLedgers: 2,
  });
  return svc;
}

describe('PaymentTimeoutService', () => {
  describe('registerPending', () => {
    it('creates a pending record', () => {
      const svc = makeSvc();
      const rec = svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      expect(rec.status).toBe('pending');
      expect(rec.chargeId).toBe(CHARGE_ID);
      expect(rec.chainId).toBe(CHAIN_ID);
    });

    it('is retrievable by chargeId', () => {
      const svc = makeSvc();
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID);
      expect(rec).toBeDefined();
      expect(rec!.status).toBe('pending');
    });
  });

  describe('detectTimeouts', () => {
    it('does not mark timed-out when window has not elapsed', async () => {
      const svc = makeSvc(300);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const timedOut = await svc.detectTimeouts();
      expect(timedOut).toHaveLength(0);
    });

    it('marks timed-out when window has elapsed', async () => {
      const svc = makeSvc(0); // instant timeout
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      // Backdate submittedAt by 400 s
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).submittedAt = Date.now() - 400_000;
      const timedOut = await svc.detectTimeouts();
      expect(timedOut.length).toBeGreaterThan(0);
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('timed_out');
    });
  });

  describe('attemptRecovery', () => {
    it('bumps gas and transitions to recovering', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      // Force timed_out
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';

      const result = await svc.attemptRecovery(CHARGE_ID);
      expect(result).not.toBeNull();
      expect(result!.record.status).toBe('recovering');
      expect(result!.newGasPrice).toBeGreaterThan(GAS);
    });

    it('abandons after max attempts', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';
      (rec as any).recoveryAttempts = 3; // equals max

      const result = await svc.attemptRecovery(CHARGE_ID);
      expect(result).toBeNull();
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('abandoned');
    });
  });

  describe('manualRetry', () => {
    it('allows user to override gas price', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';

      const highGas = BigInt(5_000_000);
      const result = await svc.manualRetry(CHARGE_ID, highGas);
      expect(result).not.toBeNull();
      expect(result!.newGasPrice).toBe(highGas);
    });

    it('throws for already-resolved transactions', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      svc.markResolved(CHARGE_ID);
      await expect(svc.manualRetry(CHARGE_ID, GAS)).rejects.toThrow(
        'not in a recoverable state'
      );
    });
  });

  describe('markResolved', () => {
    it('transitions to resolved', () => {
      const svc = makeSvc();
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.markResolved(CHARGE_ID);
      expect(rec!.status).toBe('resolved');
    });
  });

  describe('getStuckTransactions', () => {
    it('returns only stuck records', async () => {
      const svc = makeSvc(0);
      svc.registerPending('c1', SUB_ID, CHAIN_ID, GAS);
      svc.registerPending('c2', SUB_ID, CHAIN_ID, GAS);
      // Force c1 to timed_out, leave c2 pending
      (svc.getRecord('c1') as any).status = 'timed_out';

      const stuck = svc.getStuckTransactions(SUB_ID);
      expect(stuck).toHaveLength(1);
      expect(stuck[0].chargeId).toBe('c1');
    });
  });

  describe('getHealthSummary', () => {
    it('aggregates counts correctly', () => {
      const svc = makeSvc();
      svc.registerPending('c1', SUB_ID, CHAIN_ID, GAS);
      svc.registerPending('c2', SUB_ID, CHAIN_ID, GAS);
      svc.markResolved('c2');

      const summary = svc.getHealthSummary(SUB_ID);
      expect(summary.total).toBe(2);
      expect(summary.pending).toBe(1);
      expect(summary.resolved).toBe(1);
      expect(summary.recoveryRate).toBe(1); // 1 resolved / 1 terminal
    });
  });

  describe('setChainConfig validation', () => {
    it('rejects zero timeout', () => {
      const svc = new PaymentTimeoutService();
      expect(() =>
        svc.setChainConfig({
          chainId: 99,
          timeoutSecs: 0,
          gasBumpBps: 1000,
          maxRecoveryAttempts: 3,
          reorgSafetyLedgers: 1,
        })
      ).toThrow('timeoutSecs must be between 1 and 3600');
    });

    it('rejects excessive maxRecoveryAttempts', () => {
      const svc = new PaymentTimeoutService();
      expect(() =>
        svc.setChainConfig({
          chainId: 99,
          timeoutSecs: 60,
          gasBumpBps: 1000,
          maxRecoveryAttempts: 11,
          reorgSafetyLedgers: 1,
        })
      ).toThrow('maxRecoveryAttempts exceeds cap');
    });
  });
});
