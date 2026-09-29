/**
 * FreshBooks OAuth 2.0 Service
 *
 * Manages the OAuth 2.0 authorization-code flow (with PKCE) for FreshBooks.
 *
 * Flow:
 *   1. Merchant initiates connection → getAuthorizationUrl() → redirect to FreshBooks
 *   2. FreshBooks redirects back → handleCallback() → exchange code for tokens
 *   3. Tokens stored per merchant; refreshed automatically on expiry
 *
 * FreshBooks issues a *single* access token with no refresh token: the access
 * token is valid for 30 minutes and, once expired, the merchant must complete
 * the authorization flow again. `FreshBooksTokenSet` therefore has no
 * `refreshToken` and `isConnected()` reports `false` once the access token has
 * expired, which is what the router surfaces as "reconnect required".
 *
 * PKCE is used because FreshBooks supports public clients; the verifier is
 * stored alongside the state nonce and replayed on the token exchange.
 *
 * Reference: https://developers.freshbooks.com/api/#oauth_2
 */

import crypto from 'crypto';

export interface FreshBooksCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Optional dialog mode forwarded to FreshBooks. Defaults to `consent`. */
  dialogMode?: 'consent' | 'select_account';
}

export interface FreshBooksTokenSet {
  accessToken: string;
  accessTokenExpiresAt: number; // Unix ms
  accountId: string; // FreshBooks account the token is scoped to
  merchantId: string;
  obtainedAt: number;
}

export interface FreshBooksOAuthState {
  merchantId: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export interface FreshBooksAuthorization {
  url: string;
  state: string;
}

const FRESHBOOKS_AUTH_URL = 'https://www.freshbooks.com/oauth/authorize';
const FRESHBOOKS_TOKEN_URL = 'https://api.freshbooks.com/auth/oauth/token';

// FreshBooks access tokens live 30 minutes. Refresh/reconnect 2 minutes early so
// an in-flight request never races the expiry boundary.
const ACCESS_TOKEN_BUFFER_MS = 2 * 60 * 1000;
const STATE_NONCE_TTL_MS = 10 * 60 * 1000;

export class FreshBooksOAuthService {
  private readonly credentials: FreshBooksCredentials;
  private readonly tokens = new Map<string, FreshBooksTokenSet>();
  private readonly pendingStates = new Map<string, FreshBooksOAuthState>();
  private readonly fetchImpl: typeof fetch;

  constructor(credentials: FreshBooksCredentials, fetchImpl: typeof fetch = fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
  }

  // ── Authorization URL ─────────────────────────────────────────────────────

  /**
   * Build the FreshBooks authorization URL, remembering the CSRF state and the
   * PKCE code verifier needed to redeem the returned authorization code.
   */
  getAuthorizationUrl(merchantId: string): FreshBooksAuthorization {
    const nonce = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const state: FreshBooksOAuthState = {
      merchantId,
      nonce,
      codeVerifier,
      createdAt: Date.now(),
    };
    this.pendingStates.set(nonce, state);

    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      response_type: 'code',
      redirect_uri: this.credentials.redirectUri,
      state: nonce,
      code_challenge: this.codeChallengeFor(codeVerifier),
      code_challenge_method: 'S256',
      dialog: this.credentials.dialogMode ?? 'consent',
    });

    return { url: `${FRESHBOOKS_AUTH_URL}?${params.toString()}`, state: nonce };
  }

  // ── Callback Handler ──────────────────────────────────────────────────────

  /**
   * Exchange an authorization code for an access token, validating the state
   * parameter and replaying the PKCE verifier captured in `getAuthorizationUrl`.
   */
  async handleCallback(code: string, state: string, accountId: string): Promise<FreshBooksTokenSet> {
    const pendingState = this.pendingStates.get(state);
    if (!pendingState) {
      throw new Error('Invalid or unknown OAuth state parameter');
    }
    if (Date.now() - pendingState.createdAt > STATE_NONCE_TTL_MS) {
      this.pendingStates.delete(state);
      throw new Error('OAuth state has expired. Please restart the authorization flow.');
    }
    // Single use: a replayed callback must not mint a second token.
    this.pendingStates.delete(state);

    if (!accountId) {
      throw new Error('Missing FreshBooks account id in callback');
    }

    const tokenSet = await this.exchangeCodeForTokens(code, accountId, pendingState);
    this.tokens.set(pendingState.merchantId, tokenSet);
    return tokenSet;
  }

  // ── Token Access ──────────────────────────────────────────────────────────

  /**
   * Get a valid access token for the merchant, failing fast with a
   * reconnect-required error once the token has lapsed.
   */
  async getValidAccessToken(merchantId: string): Promise<string> {
    const tokenSet = this.tokens.get(merchantId);
    if (!tokenSet) {
      throw new Error(
        `No FreshBooks connection found for merchant ${merchantId}. Please connect first.`,
      );
    }
    if (!this.isUsable(tokenSet)) {
      throw new Error(
        `The FreshBooks connection for merchant ${merchantId} has expired. Please reconnect.`,
      );
    }
    return tokenSet.accessToken;
  }

  getTokenSet(merchantId: string): FreshBooksTokenSet | undefined {
    return this.tokens.get(merchantId);
  }

  /** Store a token set (e.g. loaded from the database on startup). */
  storeTokenSet(tokenSet: FreshBooksTokenSet): void {
    this.tokens.set(tokenSet.merchantId, tokenSet);
  }

  /**
   * A merchant is connected while the stored access token is still valid.
   * FreshBooks has no refresh token, so expiry means "must re-authorize".
   */
  isConnected(merchantId: string): boolean {
    const tokenSet = this.tokens.get(merchantId);
    return tokenSet ? this.isUsable(tokenSet) : false;
  }

  /** True once the token is inside the safety buffer and a sync would fail. */
  needsReconnect(merchantId: string): boolean {
    const tokenSet = this.tokens.get(merchantId);
    return tokenSet ? !this.isUsable(tokenSet) : true;
  }

  /** Forget the connection. FreshBooks has no public revoke endpoint. */
  disconnect(merchantId: string): void {
    this.tokens.delete(merchantId);
  }

  /** How long the stored token remains valid for, in ms. 0 when disconnected. */
  getExpiresInMs(merchantId: string): number {
    const tokenSet = this.tokens.get(merchantId);
    if (!tokenSet) return 0;
    return Math.max(0, tokenSet.accessTokenExpiresAt - Date.now());
  }

  getBaseUrl(): string {
    return 'https://api.freshbooks.com';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private isUsable(tokenSet: FreshBooksTokenSet): boolean {
    return Date.now() < tokenSet.accessTokenExpiresAt - ACCESS_TOKEN_BUFFER_MS;
  }

  private codeChallengeFor(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private async exchangeCodeForTokens(
    code: string,
    accountId: string,
    state: FreshBooksOAuthState,
  ): Promise<FreshBooksTokenSet> {
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      response_type: 'token',
      code,
      redirect_uri: this.credentials.redirectUri,
      code_verifier: state.codeVerifier,
    });

    const response = await this.fetchImpl(FRESHBOOKS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const payload = await this.readJson(response);
    if (!payload.ok) {
      throw new Error(`FreshBooks token exchange failed: ${response.status} ${payload.error}`);
    }

    const data = payload.data as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!data.access_token) {
      throw new Error('FreshBooks token exchange returned no access token');
    }

    const now = Date.now();
    return {
      accessToken: data.access_token,
      accessTokenExpiresAt: now + (data.expires_in ?? 1800) * 1000,
      accountId,
      merchantId: state.merchantId,
      obtainedAt: now,
    };
  }

  private async readJson(response: Response): Promise<
    | { ok: true; data: unknown }
    | { ok: false; error: string }
  > {
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: text.slice(0, 300) || `HTTP ${response.status}` };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: 'FreshBooks returned a body that is not JSON' };
    }
  }
}

export { FRESHBOOKS_AUTH_URL, FRESHBOOKS_TOKEN_URL, ACCESS_TOKEN_BUFFER_MS, STATE_NONCE_TTL_MS };
