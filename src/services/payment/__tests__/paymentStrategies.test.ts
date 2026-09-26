import {
  PaymentStrategyFactory,
  EVMPaymentStrategy,
  StellarPaymentStrategy,
  UnifiedPaymentTracker,
} from '../paymentStrategies';
import { ChainType } from '../../../types/wallet';

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

  it('validates recipient addresses correctly per chain', () => {
    const evm = new EVMPaymentStrategy();
    expect(evm.validateRecipient('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
    expect(evm.validateRecipient('invalid-address')).toBe(false);

    const stellar = new StellarPaymentStrategy();
    expect(
      stellar.validateRecipient('GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O')
    ).toBe(true);
    expect(stellar.validateRecipient('0x12345')).toBe(false);
  });

  it('executes payments and tracks them in UnifiedPaymentTracker', async () => {
    const strategy = PaymentStrategyFactory.getStrategy(ChainType.EVM);
    const result = await strategy.executePayment({
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
      amount: '10.0',
      tokenSymbol: 'USDT',
    });

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBeDefined();

    UnifiedPaymentTracker.trackPayment(result);
    expect(UnifiedPaymentTracker.getHistory()).toHaveLength(1);
    expect(UnifiedPaymentTracker.getHistory()[0].chainType).toBe(ChainType.EVM);
  });
});
