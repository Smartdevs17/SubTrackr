/**
 * BlockchainMockService - Simulates blockchain interactions with zero on-chain costs.
 * Provides realistic mock responses for subscription contracts, payment transactions,
 * gas estimation, and event simulation for sandbox testing.
 */
// ─── Mock transaction & contract types ────────────────────────────────────────

export interface MockTransaction {
  id: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: number;
  gasPrice: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber: number;
  timestamp: Date;
  data?: string;
  method: string;
  logs: MockEventLog[];
}

export interface MockEventLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  eventName: string;
  args: Record<string, unknown>;
}

export interface MockContractCall {
  contractAddress: string;
  method: string;
  params: Record<string, unknown>;
  result: unknown;
  gasEstimate: number;
  simulated: true;
}

export interface MockSubscriptionContract {
  id: string;
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  interval: 'weekly' | 'monthly' | 'yearly';
  nextPaymentDue: Date;
  status: 'active' | 'paused' | 'cancelled';
  createdAt: Date;
  lastChargedAt: Date | null;
  paymentsMade: number;
  totalPayments: number;
}

export interface BlockchainScenario {
  name: string;
  description: string;
  contractAddress: string;
  method: string;
  params: Record<string, unknown>;
  expectedResult: unknown;
  shouldFail: boolean;
  delayMs: number;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class BlockchainMockService {
  private subscriptions: Map<string, MockSubscriptionContract> = new Map();
  private transactions: MockTransaction[] = [];
  private scenarios: BlockchainScenario[] = [];
  private blockNumber = 18_500_000;
  private gasPrice = '25'; // gwei

  // ── Environment-specific configuration ──────────────────────────────────────

  private readonly ENV_WALLETS: Record<string, string[]> = {
    development: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ],
    staging: [
      '0x3333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444',
    ],
    testing: ['0x5555555555555555555555555555555555555555'],
  };

  private readonly SUPPORTED_TOKENS = [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  ];

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Simulate creating a subscription smart contract */
  async createMockSubscription(
    subscriber: string,
    merchant: string,
    amount: string,
    token: string = 'USDC',
    interval: 'weekly' | 'monthly' | 'yearly' = 'monthly'
  ): Promise<MockSubscriptionContract> {
    const id = `mc_sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const contract: MockSubscriptionContract = {
      id,
      subscriber,
      merchant,
      amount,
      token,
      interval,
      nextPaymentDue: this.computeNextPaymentDate(now, interval),
      status: 'active',
      createdAt: now,
      lastChargedAt: null,
      paymentsMade: 0,
      totalPayments: interval === 'yearly' ? 1 : interval === 'monthly' ? 12 : 52,
    };

    this.subscriptions.set(id, contract);

    // Record a mock creation transaction
    await this.recordTransaction(
      subscriber,
      this.getTokenAddress(token),
      '0',
      'createSubscription',
      { subscriber, merchant, amount, token, interval }
    );

    return contract;
  }

  /** Simulate an on-chain payment/charge */
  async mockProcessPayment(
    subscriptionId: string,
    fromWallet: string
  ): Promise<MockTransaction & { success: boolean }> {
    const contract = this.subscriptions.get(subscriptionId);
    if (!contract) {
      return this.createFailedTx(fromWallet, 'Subscription not found');
    }

    if (contract.status !== 'active') {
      return this.createFailedTx(fromWallet, `Subscription is ${contract.status}`);
    }

    const tx = await this.recordTransaction(
      fromWallet,
      this.getTokenAddress(contract.token),
      contract.amount,
      'processPayment',
      { subscriptionId, amount: contract.amount, token: contract.token }
    );

    // Update contract state
    contract.paymentsMade++;
    contract.lastChargedAt = new Date();
    contract.nextPaymentDue = this.computeNextPaymentDate(new Date(), contract.interval);

    if (contract.paymentsMade >= contract.totalPayments) {
      contract.status = 'cancelled';
    }

    this.subscriptions.set(subscriptionId, contract);

    return { ...tx, success: tx.status === 'confirmed' };
  }

  /** Simulate cancelling a subscription on-chain */
  async mockCancelSubscription(
    subscriptionId: string,
    fromWallet: string
  ): Promise<MockTransaction & { success: boolean }> {
    const contract = this.subscriptions.get(subscriptionId);
    if (!contract) {
      return this.createFailedTx(fromWallet, 'Subscription not found');
    }

    contract.status = 'cancelled';
    this.subscriptions.set(subscriptionId, contract);

    const tx = await this.recordTransaction(
      fromWallet,
      contract.subscriber,
      '0',
      'cancelSubscription',
      { subscriptionId }
    );

    return { ...tx, success: true };
  }

  /** Simulate estimating gas for a transaction */
  async mockEstimateGas(
    method: string,
    _params: Record<string, unknown>
  ): Promise<{ gasUnits: number; gasPriceGwei: string; estimatedCostUsd: string }> {
    const baseGas: Record<string, number> = {
      createSubscription: 180_000,
      processPayment: 95_000,
      cancelSubscription: 65_000,
      updateSubscription: 55_000,
      transferTokens: 45_000,
    };

    const gasUnits = (baseGas[method] || 75_000) * (0.8 + Math.random() * 0.4);
    const ethPrice = 2000; // mock ETH/USD
    const gasCostEth = (gasUnits * parseFloat(this.gasPrice)) / 1e9;
    const estimatedCostUsd = (gasCostEth * ethPrice).toFixed(2);

    return {
      gasUnits: Math.round(gasUnits),
      gasPriceGwei: this.gasPrice,
      estimatedCostUsd,
    };
  }

  /** Simulate querying a contract's state */
  async mockContractCall(
    _contractAddress: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<MockContractCall> {
    // Simulate slight network latency
    await this.delay(50 + Math.random() * 150);

    let result: unknown;

    switch (method) {
      case 'getSubscription':
        result =
          Array.from(this.subscriptions.values()).find(
            (s) => s.subscriber === params.subscriber || s.merchant === params.merchant
          ) || null;
        break;
      case 'getBalance':
        result = {
          wallet: params.wallet,
          balance: (Math.random() * 10000).toFixed(4),
          token: params.token || 'USDC',
        };
        break;
      case 'getTransaction':
        result = this.transactions.find((t) => t.hash === params.hash) || null;
        break;
      default:
        result = { simulated: true, method, params };
    }

    return {
      contractAddress: _contractAddress,
      method,
      params,
      result,
      gasEstimate: 0, // view calls don't consume gas
      simulated: true,
    };
  }

  /** Simulate listening for blockchain events */
  async mockListenForEvents(
    eventName: string,
    _filterParams: Record<string, unknown> = {}
  ): Promise<MockEventLog[]> {
    await this.delay(100);

    return this.transactions
      .flatMap((tx) => tx.logs)
      .filter((log) => log.eventName === eventName)
      .slice(-10);
  }

  /** Get all mock transactions for an environment */
  getTransactionHistory(wallet?: string, limit: number = 50): MockTransaction[] {
    let filtered = this.transactions;
    if (wallet) {
      filtered = filtered.filter((tx) => tx.from === wallet);
    }
    return filtered.slice(-limit).reverse();
  }

  /** Get a specific mock subscription */
  getMockSubscription(subscriptionId: string): MockSubscriptionContract | null {
    return this.subscriptions.get(subscriptionId) || null;
  }

  /** List all mock subscriptions for a wallet */
  getMockSubscriptionsByWallet(wallet: string): MockSubscriptionContract[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) => s.subscriber === wallet || s.merchant === wallet
    );
  }

  // ── Scenario-based testing ──────────────────────────────────────────────────

  /** Register a test scenario for deterministic mock responses */
  registerScenario(scenario: BlockchainScenario): void {
    this.scenarios.push(scenario);
  }

  /** Execute a named test scenario */
  async executeScenario(name: string): Promise<unknown> {
    const scenario = this.scenarios.find((s) => s.name === name);
    if (!scenario) {
      throw new Error(`Scenario "${name}" not found`);
    }

    await this.delay(scenario.delayMs);

    if (scenario.shouldFail) {
      throw new Error(`Scenario "${name}" failed intentionally`);
    }

    // Record a mock transaction for the scenario
    await this.recordTransaction(
      '0xScenarioCaller',
      scenario.contractAddress,
      '0',
      scenario.method,
      scenario.params
    );

    return scenario.expectedResult;
  }

  /** Clear all scenarios */
  clearScenarios(): void {
    this.scenarios = [];
  }

  // ── Virtual balance management ──────────────────────────────────────────────

  /** Set up a virtual balance for a sandbox wallet */
  async setVirtualBalance(
    wallet: string,
    token: string,
    amount: string
  ): Promise<{ wallet: string; token: string; balance: string }> {
    await this.delay(30);
    return { wallet, token, balance: amount };
  }

  /** Simulate a token transfer between wallets */
  async mockTransferTokens(
    from: string,
    to: string,
    amount: string,
    token: string = 'USDC'
  ): Promise<MockTransaction> {
    return this.recordTransaction(from, to, amount, 'transferTokens', { token });
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  /** Reset all mock blockchain state */
  reset(): void {
    this.subscriptions.clear();
    this.transactions = [];
    this.scenarios = [];
    this.blockNumber = 18_500_000;
  }

  /** Get supported tokens list for UI display */
  getSupportedTokens() {
    return this.SUPPORTED_TOKENS.map(({ symbol, address, decimals }) => ({
      symbol,
      address,
      decimals,
    }));
  }

  /** Get current mock block number */
  getBlockNumber(): number {
    return this.blockNumber;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async recordTransaction(
    from: string,
    to: string,
    value: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<MockTransaction> {
    await this.delay(20 + Math.random() * 80);

    this.blockNumber++;
    const hash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;

    const tx: MockTransaction = {
      id: `mtx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      hash,
      from,
      to,
      value,
      gasUsed: Math.floor(60_000 + Math.random() * 140_000),
      gasPrice: this.gasPrice,
      status: 'confirmed',
      blockNumber: this.blockNumber,
      timestamp: new Date(),
      data: JSON.stringify(params),
      method,
      logs: [
        {
          address: to,
          topics: [hash, from, method],
          data: JSON.stringify(params),
          blockNumber: this.blockNumber,
          transactionHash: hash,
          eventName: method,
          args: params,
        },
      ],
    };

    this.transactions.push(tx);
    return tx;
  }

  private createFailedTx(from: string, _reason: string): MockTransaction & { success: false } {
    return {
      id: `mtx_fail_${Date.now()}`,
      hash: `0x${'f'.repeat(64)}`,
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0',
      gasUsed: 45_000,
      gasPrice: this.gasPrice,
      status: 'failed',
      blockNumber: this.blockNumber,
      timestamp: new Date(),
      method: 'processPayment',
      logs: [],
      success: false,
    };
  }

  private computeNextPaymentDate(from: Date, interval: 'weekly' | 'monthly' | 'yearly'): Date {
    const next = new Date(from);
    switch (interval) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    return next;
  }

  private getTokenAddress(symbol: string): string {
    const token = this.SUPPORTED_TOKENS.find((t) => t.symbol === symbol);
    return token?.address || this.SUPPORTED_TOKENS[0].address;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blockchainMockService = new BlockchainMockService();
