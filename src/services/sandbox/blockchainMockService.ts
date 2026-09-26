/**
 * Frontend BlockchainMockService - Client-side mock blockchain integration.
 * Simulates wallet connections, transaction signing, and contract interactions
 * for sandbox testing without any on-chain costs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const BLOCKCHAIN_STORAGE_KEY = '@subtrackr_mock_blockchain';

export interface MockWallet {
  address: string;
  label: string;
  balances: MockTokenBalance[];
  totalUsdValue: number;
  createdAt: Date;
}

export interface MockTokenBalance {
  token: string;
  amount: string;
  usdValue: number;
  icon: string;
}

export interface MockTransaction {
  id: string;
  hash: string;
  from: string;
  to: string;
  method: string;
  status: 'pending' | 'confirmed' | 'failed';
  value: string;
  token: string;
  gasUsed: number;
  blockNumber: number;
  timestamp: Date;
  confirmationTime?: number; // ms
}

export interface MockContractCall {
  method: string;
  params: Record<string, unknown>;
  result: unknown;
  simulated: true;
}

class BlockchainMockService {
  private static instance: BlockchainMockService;
  private wallets: MockWallet[] = [];
  private transactions: MockTransaction[] = [];
  private blockNumber = 18_500_000;
  private initialized = false;

  private readonly SUPPORTED_TOKENS = [
    { symbol: 'USDC', price: 1.0, icon: '💵' },
    { symbol: 'ETH', price: 2500, icon: '🔷' },
    { symbol: 'DAI', price: 1.0, icon: '🟡' },
    { symbol: 'WBTC', price: 45000, icon: '₿' },
    { symbol: 'USDT', price: 1.0, icon: '💲' },
    { symbol: 'MATIC', price: 0.85, icon: '🟣' },
  ];

  private constructor() {
    this.init();
  }

  static getInstance(): BlockchainMockService {
    if (!BlockchainMockService.instance) {
      BlockchainMockService.instance = new BlockchainMockService();
    }
    return BlockchainMockService.instance;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem(BLOCKCHAIN_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.wallets = parsed.wallets.map((w: Record<string, unknown>) => ({
          ...w,
          createdAt: new Date(w.createdAt as string),
        }));
        this.transactions = parsed.transactions.map((t: Record<string, unknown>) => ({
          ...t,
          timestamp: new Date(t.timestamp as string),
        }));
      } else {
        // Seed with a default virtual wallet
        await this.createWallet('Developer Wallet', {
          USDC: '10000.00',
          ETH: '2.5',
          DAI: '5000.00',
        });
      }
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        BLOCKCHAIN_STORAGE_KEY,
        JSON.stringify({ wallets: this.wallets, transactions: this.transactions })
      );
    } catch (error) {
      console.warn('Failed to persist blockchain mock data:', error);
    }
  }

  /** Create a virtual wallet with initial balances */
  async createWallet(
    label: string,
    initialBalances: Record<string, string> = {}
  ): Promise<MockWallet> {
    const address = `0x${Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;

    const balances: MockTokenBalance[] = this.SUPPORTED_TOKENS.map((token) => {
      const amount = initialBalances[token.symbol] || '0';
      return {
        token: token.symbol,
        amount,
        usdValue: parseFloat(amount) * token.price,
        icon: token.icon,
      };
    });

    const wallet: MockWallet = {
      address,
      label,
      balances,
      totalUsdValue: balances.reduce((sum, b) => sum + b.usdValue, 0),
      createdAt: new Date(),
    };

    this.wallets.push(wallet);
    await this.persist();
    return wallet;
  }

  /** Get all virtual wallets */
  getWallets(): MockWallet[] {
    return this.wallets;
  }

  /** Get a specific wallet */
  getWallet(address: string): MockWallet | null {
    return this.wallets.find((w) => w.address === address) || null;
  }

  /** Simulate connecting a wallet (always succeeds in sandbox) */
  async connectWallet(address: string): Promise<MockWallet | null> {
    await this.delay(200 + Math.random() * 300);
    return this.getWallet(address);
  }

  /** Simulate a token transfer */
  async transferTokens(
    fromAddress: string,
    toAddress: string,
    amount: string,
    token: string
  ): Promise<MockTransaction> {
    await this.delay(500 + Math.random() * 1000);

    const fromWallet = this.getWallet(fromAddress);
    if (!fromWallet) {
      throw new Error('Source wallet not found');
    }

    const balance = fromWallet.balances.find((b) => b.token === token);
    if (!balance || parseFloat(balance.amount) < parseFloat(amount)) {
      throw new Error('Insufficient virtual balance');
    }

    // Update balances
    balance.amount = (parseFloat(balance.amount) - parseFloat(amount)).toString();
    const tokenPrice = this.SUPPORTED_TOKENS.find((t) => t.symbol === token)?.price || 1;
    balance.usdValue = parseFloat(balance.amount) * tokenPrice;
    fromWallet.totalUsdValue = fromWallet.balances.reduce((s, b) => s + b.usdValue, 0);

    const toWallet = this.getWallet(toAddress);
    if (toWallet) {
      const toBalance = toWallet.balances.find((b) => b.token === token);
      if (toBalance) {
        toBalance.amount = (parseFloat(toBalance.amount) + parseFloat(amount)).toString();
        toBalance.usdValue = parseFloat(toBalance.amount) * tokenPrice;
        toWallet.totalUsdValue = toWallet.balances.reduce((s, b) => s + b.usdValue, 0);
      }
    }

    this.blockNumber++;
    const tx = this.generateTransaction(fromAddress, toAddress, amount, token, 'transferTokens');
    tx.status = 'confirmed';
    this.transactions.push(tx);
    await this.persist();

    return tx;
  }

  /** Simulate signing a transaction (always succeeds in sandbox) */
  async signTransaction(
    fromAddress: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<MockTransaction> {
    await this.delay(300 + Math.random() * 500);

    this.blockNumber++;
    const tx = this.generateTransaction(
      fromAddress,
      (params.to as string) || '0xContract',
      (params.amount as string) || '0',
      (params.token as string) || 'USDC',
      method
    );
    tx.status = 'confirmed';
    this.transactions.push(tx);
    await this.persist();

    return tx;
  }

  /** Simulate a contract call (view-only, no gas) */
  async contractCall(
    _contractAddress: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<MockContractCall> {
    await this.delay(50 + Math.random() * 150);

    return {
      method,
      params,
      result: { simulated: true, ...params },
      simulated: true,
    };
  }

  /** Get transaction history */
  getTransactions(walletAddress?: string, limit: number = 20): MockTransaction[] {
    let filtered = this.transactions;
    if (walletAddress) {
      filtered = filtered.filter((t) => t.from === walletAddress);
    }
    return filtered.slice(-limit).reverse();
  }

  /** Top up virtual balance */
  async topUpBalance(
    walletAddress: string,
    token: string,
    amount: string
  ): Promise<MockTokenBalance | null> {
    const wallet = this.getWallet(walletAddress);
    if (!wallet) return null;

    const balance = wallet.balances.find((b) => b.token === token);
    if (!balance) return null;

    balance.amount = (parseFloat(balance.amount) + parseFloat(amount)).toString();
    const tokenPrice = this.SUPPORTED_TOKENS.find((t) => t.symbol === token)?.price || 1;
    balance.usdValue = parseFloat(balance.amount) * tokenPrice;
    wallet.totalUsdValue = wallet.balances.reduce((s, b) => s + b.usdValue, 0);

    await this.persist();
    return balance;
  }

  /** Get current mock block number */
  getBlockNumber(): number {
    return this.blockNumber;
  }

  /** Get supported tokens */
  getSupportedTokens() {
    return this.SUPPORTED_TOKENS;
  }

  /** Reset all mock blockchain state */
  async reset(): Promise<void> {
    this.wallets = [];
    this.transactions = [];
    this.blockNumber = 18_500_000;
    await AsyncStorage.removeItem(BLOCKCHAIN_STORAGE_KEY);
  }

  /** Estimate gas for a transaction (always returns mock values) */
  estimateGas(method: string): { gasUnits: number; estimatedCostUsd: string } {
    const baseGas: Record<string, number> = {
      createSubscription: 180_000,
      processPayment: 95_000,
      cancelSubscription: 65_000,
      transferTokens: 45_000,
      default: 75_000,
    };

    const gasUnits = Math.round((baseGas[method] || baseGas.default) * (0.8 + Math.random() * 0.4));
    const ethPrice = 2500;
    const gasCostEth = (gasUnits * 25) / 1e9; // 25 gwei
    const estimatedCostUsd = (gasCostEth * ethPrice).toFixed(2);

    return { gasUnits, estimatedCostUsd };
  }

  private generateTransaction(
    from: string,
    to: string,
    value: string,
    token: string,
    method: string
  ): MockTransaction {
    const hash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;

    return {
      id: `mtx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      hash,
      from,
      to,
      method,
      status: 'pending',
      value,
      token,
      gasUsed: Math.floor(45_000 + Math.random() * 155_000),
      blockNumber: this.blockNumber,
      timestamp: new Date(),
      confirmationTime: 3000 + Math.random() * 12000,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blockchainMockService = BlockchainMockService.getInstance();
