/**
 * QuickBooks OAuth 2.0 Service
 *
 * Manages the OAuth 2.0 authorization code flow for QuickBooks Online (QBO).
 *
 * Flow:
 *   1. User initiates connection → getAuthorizationUrl() → redirect to Intuit
 *   2. Intuit redirects back → handleCallback() → exchange code for tokens
 *   3. Tokens stored per merchant; refresh automatically on expiry
 *
 * Scopes used:
 *   com.intuit.quickbooks.accounting — full accounting read/write
 *
 * Reference: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 */

import crypto from 'crypto';

export interface QuickBooksCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'production';
}

export interface QuickBooksTokenSet {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number; // Unix ms
  refreshTokenExpiresAt: number; // Unix ms
  realmId: string; // QBO company ID
  merchantId: string;
  obtainedAt: number;
}

export interface QuickBooksOAuthState {
  merchantId: string;
  nonce: string;
  createdAt: number;
}

const QBO_BASE_URLS = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
} as const;

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const INTUIT_USER_INFO_URL = 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo';

const OAUTH_SCOPES = [
  'com.intuit.quickbooks.accounting',
  'openid',
  'profile',
  'email',
].join(' ');

// Access tokens live 1 hour; we refresh 5 minutes early
const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000;
// State nonces expire after 10 minutes
const STATE_NONCE_TTL_MS = 10 * 60 * 1000;

export class QuickBooksOAuthService {
  private readonly credentials: QuickBooksCredentials;
  private readonly tokens = new Map<string, QuickBooksTokenSet>(); // merchantId → tokens
  private readonly pendingStates = new Map<string, QuickBooksOAuthState>(); // nonce → state
  private readonly fetchImpl: typeof fetch;

  constructor(credentials: QuickBooksCredentials, fetchImpl: typeof fetch = fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
  }

  // ── Authorization URL ─────────────────────────────────────────────────────

  /**
   * Generate an authorization URL. Redirect the user's browser here to start
   * the QuickBooks OAuth flow.
   *
   * @returns URL to redirect to and the state parameter for CSRF protection.
   */
  getAuthorizationUrl(merchantId: string): { url: string; state: string } {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state: QuickBooksOAuthState = {
      merchantId,
      nonce,
      createdAt: Date.now(),
    };
    this.pendingStates.set(nonce, state);

    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      response_type: 'code',
      scope: OAUTH_SCOPES,
      redirect_uri: this.credentials.redirectUri,
      state: nonce,
    });

    return {
      url: `${INTUIT_AUTH_URL}?${params.toString()}`,
      state: nonce,
    };
  }

  // ── Callback Handler ──────────────────────────────────────────────────────

  /**
   * Handle the OAuth callback from Intuit.
   * Validates the state parameter, exchanges the code for tokens, and stores them.
   */
  async handleCallback(
    code: string,
    state: string,
    realmId: string,
  ): Promise<QuickBooksTokenSet> {
    // Validate state (CSRF protection)
    const pendingState = this.pendingStates.get(state);
    if (!pendingState) {
      throw new Error('Invalid or unknown OAuth state parameter');
    }

    if (Date.now() - pendingState.createdAt > STATE_NONCE_TTL_MS) {
      this.pendingStates.delete(state);
      throw new Error('OAuth state has expired. Please restart the authorization flow.');
    }

    this.pendingStates.delete(state);

    const tokenSet = await this.exchangeCodeForTokens(
      code,
      realmId,
      pendingState.merchantId,
    );

    this.tokens.set(pendingState.merchantId, tokenSet);
    return tokenSet;
  }

  // ── Token Refresh ─────────────────────────────────────────────────────────

  /**
   * Get a valid access token for the merchant, refreshing if near expiry.
   */
  async getValidAccessToken(merchantId: string): Promise<string> {
    const tokenSet = this.tokens.get(merchantId);
    if (!tokenSet) {
      throw new Error(`No QuickBooks connection found for merchant ${merchantId}. Please connect first.`);
    }

    const needsRefresh = Date.now() >= tokenSet.accessTokenExpiresAt - ACCESS_TOKEN_BUFFER_MS;
    if (needsRefresh) {
      const refreshed = await this.refreshTokens(tokenSet);
      this.tokens.set(merchantId, refreshed);
      return refreshed.accessToken;
    }

    return tokenSet.accessToken;
  }

  /**
   * Retrieve the stored token set for a merchant (for persistence/export).
   */
  getTokenSet(merchantId: string): QuickBooksTokenSet | undefined {
    return this.tokens.get(merchantId);
  }

  /**
   * Store a token set (e.g. loaded from DB on startup).
   */
  storeTokenSet(tokenSet: QuickBooksTokenSet): void {
    this.tokens.set(tokenSet.merchantId, tokenSet);
  }

  /**
   * Check whether a merchant has an active (non-expired refresh token) connection.
   */
  isConnected(merchantId: string): boolean {
    const tokenSet = this.tokens.get(merchantId);
    if (!tokenSet) return false;
    return Date.now() < tokenSet.refreshTokenExpiresAt;
  }

  /**
   * Revoke tokens and disconnect a merchant from QuickBooks.
   */
  async disconnect(merchantId: string): Promise<void> {
    const tokenSet = this.tokens.get(merchantId);
    if (!tokenSet) return;

    try {
      await this.revokeToken(tokenSet.refreshToken);
    } finally {
      this.tokens.delete(merchantId);
    }
  }

  getBaseUrl(): string {
    return QBO_BASE_URLS[this.credentials.environment];
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async exchangeCodeForTokens(
    code: string,
    realmId: string,
    merchantId: string,
  ): Promise<QuickBooksTokenSet> {
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.credentials.redirectUri,
    });

    const response = await this.fetchImpl(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QuickBooks token exchange failed: ${response.status} ${text}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
      token_type: string;
    };

    const now = Date.now();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: now + data.expires_in * 1000,
      refreshTokenExpiresAt: now + data.x_refresh_token_expires_in * 1000,
      realmId,
      merchantId,
      obtainedAt: now,
    };
  }

  private async refreshTokens(current: QuickBooksTokenSet): Promise<QuickBooksTokenSet> {
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    });

    const response = await this.fetchImpl(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QuickBooks token refresh failed: ${response.status} ${text}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
    };

    const now = Date.now();
    return {
      ...current,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: now + data.expires_in * 1000,
      refreshTokenExpiresAt: now + data.x_refresh_token_expires_in * 1000,
      obtainedAt: now,
    };
  }

  private async revokeToken(token: string): Promise<void> {
    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');

    await this.fetchImpl(INTUIT_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token }),
    });
  }
}

export { INTUIT_USER_INFO_URL, QBO_BASE_URLS };
