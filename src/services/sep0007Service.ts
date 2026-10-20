/**
 * SEP-0007 deep-link signing for Stellar wallets.
 *
 * Builds `web+stellar:` URIs so an installed wallet (Lobstr, xBull, ...)
 * can sign a transaction directly instead of the user copy/pasting XDR.
 * When no wallet app can handle the scheme we fall back so the caller can
 * surface the raw XDR for manual signing.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1718
 */

import * as Linking from 'expo-linking';
import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';

import { getDefaultStellarNetwork } from '../config/evm';
import { logger } from './logging';

export const SEP0007_SCHEME = 'web+stellar:';
export const SEP0007_DEFAULT_CALLBACK = 'url:subtrackr://stellar/callback';
export const SEP0007_SIGN_TIMEOUT_MS = 5 * 60 * 1000;
export const SEP0007_MAX_MSG_LENGTH = 1000;

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type Sep0007Operation = 'tx' | 'pay';

export interface Sep0007TxOptions {
  /** Base64-encoded unsigned transaction envelope (XDR). */
  xdr: string;
  /** `url:`-prefixed callback the wallet redirects back to. */
  callback?: string;
  /** Human-readable message shown in the wallet approval dialog. */
  msg?: string;
  /** Optional public key the transaction is expected to be signed by. */
  pubkey?: string;
  /** Stellar network passphrase (mainnet/testnet). */
  networkPassphrase?: string;
}

export interface Sep0007PayOptions {
  destination: string;
  amount?: string;
  memo?: string;
  memoType?: 'text' | 'id' | 'hash';
  /** Asset code, or `CODE:ISSUER` for issued assets. */
  currency?: string;
  msg?: string;
  callback?: string;
  pubkey?: string;
}

export interface ParsedSep0007Uri {
  operation: Sep0007Operation;
  params: Record<string, string>;
}

export interface Sep0007CallbackResult {
  status: 'success' | 'error';
  /** Signed transaction XDR returned by the wallet (success only). */
  xdr?: string;
  error?: string;
}

export class Sep0007Error extends Error {
  readonly code: string;

  constructor(message: string, code = 'INVALID_SEP0007') {
    super(message);
    this.name = 'Sep0007Error';
    this.code = code;
  }
}

function assertXdr(xdr: unknown): asserts xdr is string {
  if (typeof xdr !== 'string' || xdr.length === 0) {
    throw new Sep0007Error('XDR is required');
  }
  if (!BASE64_RE.test(xdr) || xdr.length < 16) {
    throw new Sep0007Error('XDR must be a base64-encoded transaction envelope');
  }
}

function assertMessage(msg?: string): void {
  if (msg === undefined) return;
  if (typeof msg !== 'string' || msg.length > SEP0007_MAX_MSG_LENGTH) {
    throw new Sep0007Error(`msg must be a string of at most ${SEP0007_MAX_MSG_LENGTH} characters`);
  }
}

function assertCallback(callback?: string): void {
  if (callback === undefined) return;
  if (typeof callback !== 'string' || !callback.startsWith('url:')) {
    throw new Sep0007Error('callback must be a url:-prefixed URI');
  }
}

export function isStellarPublicKey(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_PUBLIC_KEY_RE.test(value);
}

/**
 * Build a SEP-0007 `web+stellar:tx` URI for wallet signing.
 *
 * @throws {Sep0007Error} when the XDR, message or callback are invalid.
 */
export function buildSep0007TxUri(options: Sep0007TxOptions): string {
  assertXdr(options.xdr);
  assertMessage(options.msg);
  assertCallback(options.callback);

  if (options.pubkey !== undefined && !isStellarPublicKey(options.pubkey)) {
    throw new Sep0007Error('pubkey must be a valid Stellar public key');
  }

  const params = new URLSearchParams();
  params.set('xdr', options.xdr);
  params.set('callback', options.callback ?? SEP0007_DEFAULT_CALLBACK);
  if (options.msg) params.set('msg', options.msg);
  if (options.pubkey) params.set('pubkey', options.pubkey);
  if (options.networkPassphrase) params.set('network_passphrase', options.networkPassphrase);

  return `${SEP0007_SCHEME}tx?${params.toString()}`;
}

/**
 * Build a SEP-0007 `web+stellar:pay` URI for simple payments.
 *
 * @throws {Sep0007Error} when the destination, amount or memo are invalid.
 */
export function buildSep0007PayUri(options: Sep0007PayOptions): string {
  if (!isStellarPublicKey(options.destination)) {
    throw new Sep0007Error('destination must be a valid Stellar public key');
  }
  assertMessage(options.msg);
  assertCallback(options.callback);

  if (options.amount !== undefined) {
    const amount = Number(options.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Sep0007Error('amount must be a positive number');
    }
  }

  if (options.memoType && !['text', 'id', 'hash'].includes(options.memoType)) {
    throw new Sep0007Error('memo_type must be one of text, id or hash');
  }

  const params = new URLSearchParams();
  params.set('destination', options.destination);
  params.set('callback', options.callback ?? SEP0007_DEFAULT_CALLBACK);
  if (options.amount) params.set('amount', options.amount);
  if (options.memo) params.set('memo', options.memo);
  if (options.memoType) params.set('memo_type', options.memoType);
  if (options.currency) params.set('currency', options.currency);
  if (options.msg) params.set('msg', options.msg);
  if (options.pubkey) params.set('pubkey', options.pubkey);

  return `${SEP0007_SCHEME}pay?${params.toString()}`;
}

/**
 * Parse a `web+stellar:` URI back into its operation and parameters.
 *
 * @throws {Sep0007Error} when the URI is not a well-formed SEP-0007 URI.
 */
export function parseSep0007Uri(uri: unknown): ParsedSep0007Uri {
  if (typeof uri !== 'string' || !uri.startsWith(SEP0007_SCHEME)) {
    throw new Sep0007Error('URI must start with web+stellar:');
  }

  const withoutScheme = uri.slice(SEP0007_SCHEME.length);
  const queryIndex = withoutScheme.indexOf('?');
  const operationPart = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);
  const queryPart = queryIndex === -1 ? '' : withoutScheme.slice(queryIndex + 1);

  if (operationPart !== 'tx' && operationPart !== 'pay') {
    throw new Sep0007Error(`Unsupported SEP-0007 operation: ${operationPart || '(empty)'}`);
  }

  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) {
    params[key] = value;
  }

  if (operationPart === 'tx') {
    assertXdr(params.xdr);
  } else if (!isStellarPublicKey(params.destination)) {
    throw new Sep0007Error('destination must be a valid Stellar public key');
  }

  return { operation: operationPart, params };
}

export function isSep0007Uri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith(SEP0007_SCHEME);
}

/**
 * Parse the `subtrackr://stellar/callback` redirect the wallet returns after
 * signing. Only `status=success` with a signed XDR, or `status=error`, are
 * accepted; anything else is rejected.
 */
export function parseSep0007Callback(url: unknown): Sep0007CallbackResult {
  if (typeof url !== 'string') {
    throw new Sep0007Error('Callback URL is required', 'INVALID_CALLBACK');
  }

  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) {
    throw new Sep0007Error('Callback URL must be an absolute URL', 'INVALID_CALLBACK');
  }

  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    throw new Sep0007Error('Callback URL is missing query parameters', 'INVALID_CALLBACK');
  }

  const params = new URLSearchParams(url.slice(queryIndex + 1));
  const status = params.get('status');

  if (status === 'success') {
    const xdr = params.get('xdr') ?? params.get('tx');
    if (!xdr || !BASE64_RE.test(xdr)) {
      throw new Sep0007Error('Callback is missing a valid signed XDR', 'INVALID_CALLBACK');
    }
    return { status: 'success', xdr };
  }

  if (status === 'error') {
    return { status: 'error', error: params.get('error') ?? 'Wallet returned an error' };
  }

  throw new Sep0007Error('Callback URL is missing a valid status', 'INVALID_CALLBACK');
}

/**
 * Open a `web+stellar:` URI with an installed wallet.
 *
 * Returns false when no app can handle the scheme so callers can fall back
 * to copy/paste of the raw XDR.
 */
export async function openInWallet(uri: string): Promise<boolean> {
  if (!isSep0007Uri(uri)) {
    throw new Sep0007Error('URI must be a web+stellar: deep link');
  }

  try {
    await Linking.openURL(uri);
    return true;
  } catch (error) {
    logger.warn('No wallet app could open the SEP-0007 URI', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface Sep0007SignResult {
  status: 'opened' | 'fallback';
  uri: string;
  signedXdr?: string;
  reason?: string;
}

/**
 * Request a signature through an external wallet via SEP-0007.
 *
 * 1. Builds and opens the deep link.
 * 2. Waits (bounded) for the wallet to redirect back with the signed XDR.
 *
 * When no wallet handles the scheme, resolves with `status: 'fallback'`
 * carrying the URI and reason so the UI can show the XDR for manual
 * signing.
 */
export async function requestWalletSignature(
  options: Sep0007TxOptions & { timeoutMs?: number }
): Promise<Sep0007SignResult> {
  const uri = buildSep0007TxUri(options);

  const opened = await openInWallet(uri);
  if (!opened) {
    return {
      status: 'fallback',
      uri,
      reason: 'No installed wallet supports web+stellar: deep links',
    };
  }

  const signedXdr = await waitForSep0007Callback(options.timeoutMs);
  if (!signedXdr) {
    return {
      status: 'fallback',
      uri,
      reason: 'The wallet did not return a signed transaction in time',
    };
  }

  return { status: 'opened', uri, signedXdr };
}

let pendingCallbackResolve: ((xdr: string | null) => void) | null = null;
let pendingCallbackTimer: ReturnType<typeof setTimeout> | null = null;
let callbackSubscription: { remove: () => void } | null = null;

/**
 * Wait for the wallet to redirect back to `subtrackr://stellar/callback`
 * with the signed transaction. Resolves with the signed XDR, or null on
 * timeout or error.
 */
export function waitForSep0007Callback(
  timeoutMs = SEP0007_SIGN_TIMEOUT_MS
): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (xdr: string | null) => {
      if (pendingCallbackTimer) {
        clearTimeout(pendingCallbackTimer);
        pendingCallbackTimer = null;
      }
      callbackSubscription?.remove();
      callbackSubscription = null;
      pendingCallbackResolve = null;
      resolve(xdr);
    };

    pendingCallbackResolve = finish;

    callbackSubscription = Linking.addEventListener('url', ({ url }) => {
      try {
        const result = parseSep0007Callback(url);
        if (result.status === 'success' && result.xdr) {
          finish(result.xdr);
        } else {
          finish(null);
        }
      } catch {
        finish(null);
      }
    });

    pendingCallbackTimer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Cancel any in-flight callback wait (e.g. when the user aborts). */
export function cancelSep0007Wait(): void {
  if (pendingCallbackResolve) {
    pendingCallbackResolve(null);
  }
}

/**
 * Submit a wallet-signed transaction envelope to the Stellar network.
 *
 * @returns the transaction hash.
 * @throws {Sep0007Error} when the envelope is invalid or submission fails.
 */
export async function submitSignedTransaction(signedXdr: string): Promise<string> {
  assertXdr(signedXdr);

  const network = getDefaultStellarNetwork();
  const server = new rpc.Server(network.sorobanRpcUrl, {
    allowHttp: false,
    timeout: 30_000,
  });

  let transaction: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    transaction = TransactionBuilder.fromXDR(signedXdr, network.networkPassphrase);
  } catch {
    throw new Sep0007Error(
      'Unable to parse the signed transaction envelope',
      'INVALID_SIGNED_XDR'
    );
  }

  try {
    const result = await server.submitTransaction(transaction);
    const hash = (result as { hash?: string } | null)?.hash;
    if (!hash) {
      throw new Sep0007Error(
        'The network did not return a transaction hash',
        'SUBMIT_FAILED'
      );
    }
    return hash;
  } catch (error) {
    if (error instanceof Sep0007Error) {
      throw error;
    }
    throw new Sep0007Error(
      `Transaction submission failed: ${error instanceof Error ? error.message : String(error)}`,
      'SUBMIT_FAILED'
    );
  }
}

/**
 * Full SEP-0007 signing flow: open the wallet, wait for the signed
 * envelope, and submit it to the network.
 *
 * @returns the transaction hash, or null when no wallet handled the deep
 * link or the wallet never called back (caller should fall back to the
 * injected-provider or copy/paste flow).
 */
export async function signViaDeepLink(
  options: Sep0007TxOptions & { timeoutMs?: number }
): Promise<string | null> {
  const result = await requestWalletSignature(options);
  if (result.status !== 'opened' || !result.signedXdr) {
    logger.warn('SEP-0007 deep-link signing fell back', {
      reason: result.reason,
    });
    return null;
  }
  return submitSignedTransaction(result.signedXdr);
}
