import { SDKOptions, AuthContext } from './types';
import { AuthenticationError } from './errors';

export class AuthManager {
  private context: AuthContext = { token: null, expiresAt: null };

  constructor(private options: SDKOptions) {
    if (!options.apiKey) {
      throw new AuthenticationError('API Key is required to initialize the SDK');
    }
    // In a real implementation this might exchange API key for short-lived token
    this.context.token = options.apiKey;
    // Set a mock expiration date far into the future since it's just an API key hook
    this.context.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  }

  async getToken(): Promise<string> {
    if (!this.context.token) {
      throw new AuthenticationError('Not authenticated');
    }
    return this.context.token;
  }
}
