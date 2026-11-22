import {
  EVMPaymentStrategy,
  PaymentStrategyErrorCode,
  PaymentStrategyFactory,
  StellarPaymentStrategy,
  UnifiedPaymentTracker,
  type PaymentParams,
} from '../paymentStrategies';
import { ChainType } from '../../../types/wallet';

const EVM_RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
const STELLAR_RECIPIENT = 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O';
const EVM_TX_HASH = '0x' + 'a'.repeat(64);
const STELLAR_TX_HASH = 'stellar-tx-' + 'b'.repeat(56);

/** Amounts a strategy must refuse before it ever calls the submitter. */
const INVALID_AMOUNTS = ['', '   ', 'abc', '0', '-1', '1.2.3', 'NaN', 'Infinity'];

const evmParams: PaymentParams = {
  recipient: EVM_RECIPIENT,
  amount: '10.0',
  tokenSymbol: 'USDT',
};

const stellarParams: PaymentParams = {
  recipient: STELLAR_RECIPIENT,
  amount: '10.0',
  tokenSymbol: 'XLM',
};

describe('Payment Strategies & StrategyFactory', () => {
  beforeEach(() => {
    UnifiedPaymentTracker.clearHistory();
  });

  it('selects EVM strategy for EVM chain and tokens', () => {
    const strategy = PaymentStrategyFactory.getStrategy(ChainType.EVM);
    expect(strategy).toBeInstanceOf(EVMPaymentStrategy);
    expect(strategy.chainType).toBe(ChainType.EVM);

    const tokenStrategy = PaymentStrategyFactory.getStrategyForToken('USDC');
    expect(tokenStrategy).toBeInstanceOf(EVMPaymentStrategy);
  });

  it('selects Stellar strategy for Stellar chain and XLM tokens', () => {
    const strategy = PaymentStrategyFactory.getStrategy(ChainType.STELLAR);
    expect(strategy).toBeInstanceOf(StellarPaymentStrategy);
    expect(strategy.chainType).toBe(ChainType.STELLAR);

    const tokenStrategy = PaymentStrategyFactory.getStrategyForToken('XLM');
    expect(tokenStrategy).toBeInstanceOf(StellarPaymentStrategy);
  });

  it('selects the Stellar strategy for XLM-SOROBAN regardless of case', () => {
    expect(PaymentStrategyFactory.getStrategyForToken('xlm-soroban')).toBeInstanceOf(
      StellarPaymentStrategy
    );
  });

  it('throws for an unregistered chain type', () => {
    expect(() => PaymentStrategyFactory.getStrategy('solana' as unknown as ChainType)).toThrow(
      'No payment strategy registered'
    );
  });

  it('allows a strategy to be registered for a chain type', () => {
    const custom = new EVMPaymentStrategy(async () => EVM_TX_HASH);
    PaymentStrategyFactory.registerStrategy(ChainType.EVM, custom);
    expect(PaymentStrategyFactory.getStrategy(ChainType.EVM)).toBe(custom);
    // Restore the default for any later assertions in this file.
    PaymentStrategyFactory.registerStrategy(ChainType.EVM, new EVMPaymentStrategy());
  });

  describe('validateRecipient', () => {
    it('accepts a well-formed EVM address', () => {
      expect(new EVMPaymentStrategy().validateRecipient(EVM_RECIPIENT)).toBe(true);
    });

    it('rejects malformed EVM addresses', () => {
      const evm = new EVMPaymentStrategy();
      expect(evm.validateRecipient('invalid-address')).toBe(false);
      expect(evm.validateRecipient('0x12345')).toBe(false);
      expect(evm.validateRecipient(`${EVM_RECIPIENT}00`)).toBe(false);
      expect(evm.validateRecipient(undefined as unknown as string)).toBe(false);
    });

    it('accepts a Stellar address with a valid ed25519 version byte', () => {
      expect(new StellarPaymentStrategy().validateRecipient(STELLAR_RECIPIENT)).toBe(true);
    });

    it('rejects Stellar addresses that are the wrong length or prefix', () => {
      const stellar = new StellarPaymentStrategy();
      expect(stellar.validateRecipient('0x12345')).toBe(false);
      expect(stellar.validateRecipient(STELLAR_RECIPIENT.slice(0, 55))).toBe(false);
      expect(stellar.validateRecipient(`${STELLAR_RECIPIENT}1`)).toBe(false);
      expect(stellar.validateRecipient(`A${STELLAR_RECIPIENT.slice(1)}`)).toBe(false);
      expect(stellar.validateRecipient(undefined as unknown as string)).toBe(false);
    });

    it('rejects a Stellar-shaped string with the wrong version byte', () => {
      // 56 valid base32 characters, but the leading bits do not decode to the
      // ed25519 version byte (6 << 3), so this is not a usable account id.
      const stellar = new StellarPaymentStrategy();
      expect(stellar.validateRecipient(`G${'I'}${'A'.repeat(54)}`)).toBe(false);
      expect(stellar.validateRecipient(`G${'A'.repeat(55)}`)).toBe(true);
    });

    it('rejects characters outside the StrKey base32 alphabet', () => {
      const stellar = new StellarPaymentStrategy();
      // '0', '1', '8' and '9' are not in the StrKey alphabet.
      expect(stellar.validateRecipient(`G${'A'.repeat(54)}0`)).toBe(false);
      expect(stellar.validateRecipient(`G${'A'.repeat(54)}9`)).toBe(false);
    });
  });

  describe('executePayment validation', () => {
    it('rejects an invalid EVM recipient before submitting', async () => {
      const submitter = jest.fn();
      const strategy = new EVMPaymentStrategy(submitter);

      const result = await strategy.executePayment({ ...evmParams, recipient: 'nope' });
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.INVALID_RECIPIENT);
      expect(submitter).not.toHaveBeenCalled();
    });

    it('rejects an invalid Stellar recipient before submitting', async () => {
      const submitter = jest.fn();
      const strategy = new StellarPaymentStrategy(submitter);

      const result = await strategy.executePayment({ ...stellarParams, recipient: 'nope' });
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.INVALID_RECIPIENT);
      expect(submitter).not.toHaveBeenCalled();
    });

    INVALID_AMOUNTS.forEach((amount) => {
      it(`rejects the invalid amount ${JSON.stringify(amount)}`, async () => {
        const submitter = jest.fn();
        const strategy = new EVMPaymentStrategy(submitter);

        const result = await strategy.executePayment({ ...evmParams, amount });
        expect(result.success).toBe(false);
        expect(result.failure!.code).toBe(PaymentStrategyErrorCode.INVALID_AMOUNT);
        expect(submitter).not.toHaveBeenCalled();
      });
    });

    it('rejects the same invalid amounts on the Stellar strategy', async () => {
      const submitter = jest.fn();
      const strategy = new StellarPaymentStrategy(submitter);

      const result = await strategy.executePayment({ ...stellarParams, amount: '0' });
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.INVALID_AMOUNT);
      expect(submitter).not.toHaveBeenCalled();
    });

    it('rejects a non-string amount', async () => {
      const submitter = jest.fn();
      const strategy = new EVMPaymentStrategy(submitter);
      const params = { ...evmParams, amount: 10 } as unknown as PaymentParams;

      const result = await strategy.executePayment(params);
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.INVALID_AMOUNT);
      expect(submitter).not.toHaveBeenCalled();
    });

    it('accepts a fractional amount', async () => {
      const strategy = new EVMPaymentStrategy(async () => EVM_TX_HASH);
      const result = await strategy.executePayment({ ...evmParams, amount: '0.0001' });
      expect(result.success).toBe(true);
    });
  });

  describe('executePayment submission', () => {
    it('returns the real transaction hash from the submitter', async () => {
      const strategy = new EVMPaymentStrategy(async () => EVM_TX_HASH);
      const result = await strategy.executePayment(evmParams);

      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe(EVM_TX_HASH);
      expect(result.chainType).toBe(ChainType.EVM);
      expect(result.failure).toBeUndefined();
    });

    it('fails closed when no submitter is configured', async () => {
      // The previous behaviour fabricated a hash and reported success, which
      // made an unwired strategy indistinguishable from a settled payment.
      const result = await new EVMPaymentStrategy().executePayment(evmParams);

      expect(result.success).toBe(false);
      expect(result.transactionHash).toBeUndefined();
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.NO_SUBMITTER);
    });

    it('fails closed for Stellar when no submitter is configured', async () => {
      const result = await new StellarPaymentStrategy().executePayment(stellarParams);

      expect(result.success).toBe(false);
      expect(result.transactionHash).toBeUndefined();
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.NO_SUBMITTER);
    });

    it('surfaces a submitter rejection as a failure', async () => {
      const strategy = new EVMPaymentStrategy(async () => {
        throw new Error('user rejected');
      });

      const result = await strategy.executePayment(evmParams);
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.SUBMISSION_FAILED);
      expect(result.error).toBe('user rejected');
      expect(result.failure!.cause).toBeInstanceOf(Error);
    });

    it('surfaces a non-Error submitter rejection as a failure', async () => {
      const strategy = new EVMPaymentStrategy(async () => {
        throw 'rpc down';
      });

      const result = await strategy.executePayment(evmParams);
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.SUBMISSION_FAILED);
      expect(result.error).toBe('EVM payment submission failed');
    });

    it('rejects an empty transaction hash from the submitter', async () => {
      const strategy = new EVMPaymentStrategy(async () => '');
      const result = await strategy.executePayment(evmParams);

      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.NO_TX_HASH);
    });

    it('resolves a Stellar payment through the injected submitter', async () => {
      const strategy = new StellarPaymentStrategy(async () => STELLAR_TX_HASH);
      const result = await strategy.executePayment(stellarParams);

      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe(STELLAR_TX_HASH);
      expect(result.chainType).toBe(ChainType.STELLAR);
    });

    it('surfaces a Stellar submitter rejection as a failure', async () => {
      const strategy = new StellarPaymentStrategy(async () => {
        throw new Error('account not found');
      });

      const result = await strategy.executePayment(stellarParams);
      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.SUBMISSION_FAILED);
      expect(result.error).toBe('account not found');
    });

    it('rejects an empty Stellar transaction hash from the submitter', async () => {
      const strategy = new StellarPaymentStrategy(async () => '');
      const result = await strategy.executePayment(stellarParams);

      expect(result.success).toBe(false);
      expect(result.failure!.code).toBe(PaymentStrategyErrorCode.NO_TX_HASH);
    });

    it('forwards the payment params to the submitter unchanged', async () => {
      const submitter = jest.fn(async () => EVM_TX_HASH);
      const strategy = new EVMPaymentStrategy(submitter);
      const params: PaymentParams = { ...evmParams, memo: 'sub-1', tokenAddress: '0xtoken' };

      await strategy.executePayment(params);
      expect(submitter).toHaveBeenCalledWith(params);
    });
  });

  describe('estimateGasFee', () => {
    it('returns a formatted estimate per chain', async () => {
      const evm = new EVMPaymentStrategy();
      const stellar = new StellarPaymentStrategy();

      expect(await evm.estimateGasFee(evmParams)).toBe('0.0025 ETH');
      expect(await stellar.estimateGasFee(stellarParams)).toBe('0.00001 XLM');
    });
  });

  describe('UnifiedPaymentTracker', () => {
    it('records a successful payment', async () => {
      const strategy = PaymentStrategyFactory.getStrategy(ChainType.EVM);
      UnifiedPaymentTracker.trackPayment({
        success: true,
        transactionHash: EVM_TX_HASH,
        chainType: ChainType.EVM,
        timestamp: Date.now(),
      });

      expect(UnifiedPaymentTracker.getHistory()).toHaveLength(1);
      expect(UnifiedPaymentTracker.getHistory()[0].chainType).toBe(ChainType.EVM);
      expect(strategy.chainType).toBe(ChainType.EVM);
    });

    it('separates successful and failed payments', () => {
      UnifiedPaymentTracker.trackPayment({
        success: true,
        chainType: ChainType.EVM,
        timestamp: 1,
      });
      UnifiedPaymentTracker.trackPayment({
        success: false,
        chainType: ChainType.STELLAR,
        error: 'nope',
        timestamp: 2,
      });

      expect(UnifiedPaymentTracker.getSucceeded()).toHaveLength(1);
      expect(UnifiedPaymentTracker.getFailed()).toHaveLength(1);
      expect(UnifiedPaymentTracker.getFailed()[0].chainType).toBe(ChainType.STELLAR);
    });

    it('bounds retained history so a long session cannot grow unbounded', () => {
      for (let i = 0; i < 150; i++) {
        UnifiedPaymentTracker.trackPayment({
          success: true,
          chainType: ChainType.EVM,
          timestamp: i,
        });
      }

      const history = UnifiedPaymentTracker.getHistory();
      expect(history).toHaveLength(100);
      // The oldest entries are evicted, the newest retained.
      expect(history[0].timestamp).toBe(50);
      expect(history[99].timestamp).toBe(149);
    });

    it('returns a defensive copy of the history', () => {
      UnifiedPaymentTracker.trackPayment({ success: true, chainType: ChainType.EVM, timestamp: 1 });

      const history = UnifiedPaymentTracker.getHistory();
      history.push({ success: true, chainType: ChainType.EVM, timestamp: 2 });

      expect(UnifiedPaymentTracker.getHistory()).toHaveLength(1);
    });
  });
});
