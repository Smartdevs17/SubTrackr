import {
  PaymentTimeoutService,
  type ChainStatusProvider,
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

    it('resolves a transaction the chain already confirmed', async () => {
      const provider: ChainStatusProvider = {
        getTxStatus: jest.fn().mockResolvedValue('confirmed'),
        detectReorg: jest.fn().mockResolvedValue(false),
        getBlockNumber: jest.fn().mockResolvedValue(1_000),
      };
      const svc = new PaymentTimeoutService(undefined, provider);
      svc.setChainConfig({
        chainId: CHAIN_ID,
        timeoutSecs: 0,
        gasBumpBps: 1500,
        maxRecoveryAttempts: 3,
        reorgSafetyLedgers: 2,
      });
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).submittedAt = Date.now() - 400_000;

      const timedOut = await svc.detectTimeouts();
      expect(timedOut).toHaveLength(0);
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('resolved');
    });

    it('still times out when the status probe fails', async () => {
      const provider: ChainStatusProvider = {
        getTxStatus: jest.fn().mockRejectedValue(new Error('rpc down')),
        detectReorg: jest.fn().mockResolvedValue(false),
      };
      const svc = new PaymentTimeoutService(undefined, provider);
      svc.setChainConfig({
        chainId: CHAIN_ID,
        timeoutSecs: 0,
        gasBumpBps: 1500,
        maxRecoveryAttempts: 3,
        reorgSafetyLedgers: 2,
      });
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).submittedAt = Date.now() - 400_000;

      const timedOut = await svc.detectTimeouts();
      expect(timedOut).toHaveLength(1);
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('timed_out');
    });
  });

  describe('autoRecoverAll', () => {
    it('retries every stuck charge and skips the rest', async () => {
      const svc = makeSvc(0);
      svc.registerPending('c1', SUB_ID, CHAIN_ID, GAS);
      svc.registerPending('c2', SUB_ID, CHAIN_ID, GAS);
      svc.registerPending('c3', SUB_ID, CHAIN_ID, GAS);
      (svc.getRecord('c1') as any).status = 'timed_out';
      (svc.getRecord('c2') as any).status = 'recovering';
      svc.markResolved('c3');

      const results = await svc.autoRecoverAll();
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.record.chargeId).sort()).toEqual(['c1', 'c2']);
      expect(svc.getRecord('c1')!.recoveryAttempts).toBe(1);
      expect(svc.getRecord('c2')!.recoveryAttempts).toBe(1);
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

    it('returns null for an unknown charge', async () => {
      const svc = makeSvc(0);
      expect(await svc.attemptRecovery('charge_missing')).toBeNull();
    });

    it('returns null when the record is still pending', async () => {
      const svc = makeSvc(300);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      expect(await svc.attemptRecovery(CHARGE_ID)).toBeNull();
    });

    it('bumps gas by the configured basis points', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      const result = await svc.attemptRecovery(CHARGE_ID);
      // +1500 bps on 1_000_000 is 1_150_000.
      expect(result!.newGasPrice).toBe(BigInt(1_150_000));
      expect(result!.attemptNumber).toBe(1);
      expect(svc.getRecord(CHARGE_ID)!.lastGasPrice).toBe(BigInt(1_150_000));
    });
  });

  describe('concurrent recovery guard', () => {
    it('lets only the first of two concurrent attempts bump gas', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      const [first, second] = await Promise.all([
        svc.attemptRecovery(CHARGE_ID),
        svc.attemptRecovery(CHARGE_ID),
      ]);

      const successes = [first, second].filter((r) => r !== null);
      expect(successes).toHaveLength(1);
      expect(svc.getRecord(CHARGE_ID)!.recoveryAttempts).toBe(1);
      expect(svc.getRecord(CHARGE_ID)!.lastGasPrice).toBe(BigInt(1_150_000));
    });

    it('does not let a manual retry race an in-flight recovery', async () => {
      const provider: ChainStatusProvider = {
        getTxStatus: jest.fn().mockResolvedValue('pending'),
        detectReorg: jest.fn().mockResolvedValue(false),
        getBlockNumber: jest.fn().mockResolvedValue(1_000),
      };
      const svc = new PaymentTimeoutService(undefined, provider);
      svc.setChainConfig({
        chainId: CHAIN_ID,
        timeoutSecs: 0,
        gasBumpBps: 1500,
        maxRecoveryAttempts: 3,
        reorgSafetyLedgers: 2,
      });
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      const auto = svc.attemptRecovery(CHARGE_ID);
      // The manual retry must decline without touching the record that the
      // automatic recovery is in the middle of updating.
      await expect(svc.manualRetry(CHARGE_ID, BigInt(9_000_000))).resolves.toBeNull();
      await expect(auto).resolves.not.toBeNull();

      // The automatic recovery's own bump survives untouched.
      expect(svc.getRecord(CHARGE_ID)!.lastGasPrice).toBe(BigInt(1_150_000));
      expect(svc.getRecord(CHARGE_ID)!.recoveryAttempts).toBe(1);
    });
  });

  describe('manualRetry', () => {
    it('honours a user gas price above the configured bump floor', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';

      // 5_000_000 is above the 1_150_000 bump floor, so it becomes the base
      // price; the configured +1500 bps is then applied on top of it.
      const result = await svc.manualRetry(CHARGE_ID, BigInt(5_000_000));
      expect(result).not.toBeNull();
      expect(result!.newGasPrice).toBe(BigInt(5_750_000));
    });

    it('never prices a retry below the configured bump floor', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      // Asking for less than the floor must not lower the retry price.
      const result = await svc.manualRetry(CHARGE_ID, BigInt(1));
      expect(result).not.toBeNull();
      expect(result!.newGasPrice).toBe(BigInt(1_322_500));
    });

    it('throws for already-resolved transactions', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      svc.markResolved(CHARGE_ID);
      await expect(svc.manualRetry(CHARGE_ID, GAS)).rejects.toThrow(
        'not in a recoverable state'
      );
    });

    it('throws for already-abandoned transactions', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';
      (rec as any).recoveryAttempts = 3;

      await svc.attemptRecovery(CHARGE_ID);
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('abandoned');
      await expect(svc.manualRetry(CHARGE_ID, GAS)).rejects.toThrow(
        'not in a recoverable state'
      );
    });

    it('throws for an unknown charge', async () => {
      const svc = makeSvc(0);
      await expect(svc.manualRetry('charge_missing', GAS)).rejects.toThrow('Charge not found');
    });

    it('restores the previous gas price when the attempt cannot proceed', async () => {
      const svc = makeSvc(0);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      const rec = svc.getRecord(CHARGE_ID)!;
      (rec as any).status = 'timed_out';
      (rec as any).recoveryAttempts = 3; // cap already reached

      // The manual retry cannot proceed, so the requested price must not
      // become the floor for later attempts.
      const result = await svc.manualRetry(CHARGE_ID, BigInt(9_000_000));
      expect(result).toBeNull();
      expect(svc.getRecord(CHARGE_ID)!.lastGasPrice).toBe(GAS);
      expect(svc.getRecord(CHARGE_ID)!.status).toBe('abandoned');
    });
  });

  describe('reorg guard', () => {
    const makeProvider = (overrides: Partial<ChainStatusProvider> = {}): ChainStatusProvider => ({
      getTxStatus: jest.fn().mockResolvedValue('pending'),
      detectReorg: jest.fn().mockResolvedValue(false),
      getBlockNumber: jest.fn().mockResolvedValue(1_000),
      ...overrides,
    });

    const svcWith = (provider: ChainStatusProvider): PaymentTimeoutService => {
      const svc = new PaymentTimeoutService(undefined, provider);
      svc.setChainConfig({
        chainId: CHAIN_ID,
        timeoutSecs: 0,
        gasBumpBps: 1500,
        maxRecoveryAttempts: 3,
        reorgSafetyLedgers: 2,
      });
      return svc;
    };

    it('passes the chain head less the safety window as the reorg baseline', async () => {
      const provider = makeProvider();
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      const result = await svc.attemptRecovery(CHARGE_ID);
      expect(result).not.toBeNull();
      expect(provider.detectReorg).toHaveBeenCalledWith(CHAIN_ID, 998);
    });

    it('defers recovery when a reorg is detected', async () => {
      const provider = makeProvider({ detectReorg: jest.fn().mockResolvedValue(true) });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      const result = await svc.attemptRecovery(CHARGE_ID);
      expect(result).toBeNull();
      expect(svc.getRecord(CHARGE_ID)!.note).toBe('reorg_detected_recovery_deferred');
      expect(svc.getRecord(CHARGE_ID)!.lastGasPrice).toBe(GAS);
    });

    it('proceeds when the reorg probe fails', async () => {
      const provider = makeProvider({
        detectReorg: jest.fn().mockRejectedValue(new Error('rpc down')),
      });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      expect(await svc.attemptRecovery(CHARGE_ID)).not.toBeNull();
    });

    it('skips the reorg guard when no block height is available', async () => {
      // A provider without getBlockNumber must not be handed a bogus block
      // number, which would report a reorg on every attempt.
      const provider = makeProvider({ getBlockNumber: undefined });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      expect(await svc.attemptRecovery(CHARGE_ID)).not.toBeNull();
      expect(provider.detectReorg).not.toHaveBeenCalled();
    });

    it('skips the reorg guard when the block height probe fails', async () => {
      const provider = makeProvider({
        getBlockNumber: jest.fn().mockRejectedValue(new Error('rpc down')),
      });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      expect(await svc.attemptRecovery(CHARGE_ID)).not.toBeNull();
      expect(provider.detectReorg).not.toHaveBeenCalled();
    });

    it('skips the reorg guard for a non-finite block height', async () => {
      const provider = makeProvider({ getBlockNumber: jest.fn().mockResolvedValue(null) });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      expect(await svc.attemptRecovery(CHARGE_ID)).not.toBeNull();
      expect(provider.detectReorg).not.toHaveBeenCalled();
    });

    it('never clamps the baseline below block zero', async () => {
      const provider = makeProvider({ getBlockNumber: jest.fn().mockResolvedValue(1) });
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS, '0xabc');
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      await svc.attemptRecovery(CHARGE_ID);
      expect(provider.detectReorg).toHaveBeenCalledWith(CHAIN_ID, 0);
    });

    it('skips the reorg guard for records without a tx hash', async () => {
      const provider = makeProvider();
      const svc = svcWith(provider);
      svc.registerPending(CHARGE_ID, SUB_ID, CHAIN_ID, GAS);
      (svc.getRecord(CHARGE_ID) as any).status = 'timed_out';

      expect(await svc.attemptRecovery(CHARGE_ID)).not.toBeNull();
      expect(provider.detectReorg).not.toHaveBeenCalled();
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
