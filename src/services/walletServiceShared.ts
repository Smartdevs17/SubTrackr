import { ethers } from 'ethers';

import { NetworkError, NetworkErrorCode, ContractError, ContractErrorCode } from '../errors';
import { TIME_CONSTANTS, CRYPTO_CONSTANTS, CHAIN_IDS } from '../utils/constants/values';
import { GasEstimate } from '../types/wallet';

export { GasEstimate };
export { NetworkError, NetworkErrorCode, ContractError, ContractErrorCode };

export enum WalletErrorCode {
  NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  USER_REJECTED = 'USER_REJECTED',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  BALANCE_FETCH_FAILED = 'BALANCE_FETCH_FAILED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  STREAM_CREATION_FAILED = 'STREAM_CREATION_FAILED',
  APPROVAL_FAILED = 'APPROVAL_FAILED',
  INVALID_PARAMS = 'INVALID_PARAMS',
  UNKNOWN = 'UNKNOWN',
}

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly userMessage: string;
  readonly recovery?: string;

  constructor(code: WalletErrorCode, userMessage: string, recovery?: string, cause?: unknown) {
    super(userMessage);
    this.name = 'WalletError';
    this.code = code;
    this.userMessage = userMessage;
    this.recovery = recovery;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

interface ErrorRecord {
  count: number;
  lastSeen: number;
}

class ErrorRateTracker {
  private readonly counts = new Map<WalletErrorCode, ErrorRecord>();

  record(code: WalletErrorCode): void {
    const existing = this.counts.get(code);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      this.counts.set(code, { count: 1, lastSeen: Date.now() });
    }
  }

  getStats(): Record<string, ErrorRecord> {
    return Object.fromEntries(this.counts.entries());
  }

  reset(): void {
    this.counts.clear();
  }
}

export const errorTracker = new ErrorRateTracker();

export interface WalletConnection {
  address: string;
  chainId: number;
  isConnected: boolean;
  provider?: ethers.providers.Web3Provider;
  eip1193Provider?: ethers.providers.ExternalProvider;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  decimals: number;
  logoURI?: string;
}

export interface StreamSetup {
  token: string;
  amount: number;
  flowRate: string;
  startDate: Date;
  endDate?: Date;
  protocol: 'superfluid' | 'sablier';
}

export interface SuperfluidStreamResult {
  txHash: string;
  streamId: string;
}

export const SECONDS_PER_MONTH = TIME_CONSTANTS.SECONDS_PER_MONTH;

export interface WalletServiceContext {
  getConnection?(): WalletConnection | null;
  getWalletSigner?(): ethers.Signer;
  getProvider?(chainId: number): ethers.providers.JsonRpcProvider;
}

export function isUserRejectedError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { code?: number | string; message?: string };
  if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('user rejected') || msg.includes('user denied');
}

export function superTokenResolverSymbol(chainId: number, tokenSymbol: string): string {
  const s = tokenSymbol.toUpperCase();
  if (s === 'USDC' || s === 'USDC.E') return 'USDCx';
  if (s === 'MATIC') return 'MATICx';
  if (s === 'ETH') {
    if (chainId === CHAIN_IDS.POLYGON) return 'MATICx';
    return 'ETHx';
  }
  if (s === 'ARB') {
    throw new Error(
      'ARB is not supported as a Superfluid super token on this flow. Use ETH for native streaming on Arbitrum.'
    );
  }
  if (s.endsWith('X')) return s;
  return `${s}x`;
}

export function toWalletError(
  error: unknown,
  code: WalletErrorCode,
  userMessage: string,
  recovery?: string
): WalletError {
  errorTracker.record(code);
  console.error(`[WalletError] ${code}:`, error);
  return new WalletError(code, userMessage, recovery, error);
}

export function getNativeSymbol(chainId: number): string {
  const symbols: Record<number, string> = {
    [CHAIN_IDS.ETHEREUM]: 'ETH',
    [CHAIN_IDS.POLYGON]: 'MATIC',
    [CHAIN_IDS.ARBITRUM]: 'ETH',
  };
  return symbols[chainId] || 'ETH';
}

export function getNativeName(chainId: number): string {
  const names: Record<number, string> = {
    [CHAIN_IDS.ETHEREUM]: 'Ethereum',
    [CHAIN_IDS.POLYGON]: 'Polygon',
    [CHAIN_IDS.ARBITRUM]: 'Arbitrum',
  };
  return names[chainId] || 'Ethereum';
}

export function getGasBufferMultiplier(chainId: number): number {
  return chainId === CHAIN_IDS.POLYGON
    ? CRYPTO_CONSTANTS.POLYGON_GAS_BUFFER_MULTIPLIER
    : CRYPTO_CONSTANTS.DEFAULT_GAS_BUFFER_MULTIPLIER;
}
