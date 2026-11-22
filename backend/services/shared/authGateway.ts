import { Request, Response, NextFunction } from 'express';
import {
  ApiKeyAuthStrategy,
  AuthUser,
  CompositeAuthStrategyManager,
  IAuthStrategy,
  JwtAuthStrategy,
  createUnifiedAuthMiddleware,
} from './authStrategies';

export interface Web3AuthClaims {
  sub: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  wallets?: Array<{ address?: string }>;
}

export interface Web3AuthVerifier {
  verify(token: string): Promise<Web3AuthClaims | null>;
}

export interface Web3AuthVerifierOptions {
  issuer?: string;
  audience?: string;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function claimAudiences(aud: string | string[] | undefined): string[] {
  if (Array.isArray(aud)) return aud;
  return aud ? [aud] : [];
}

/**
 * Structural verifier for Web3Auth ID tokens. Signature verification is the
 * responsibility of the injected Web3AuthVerifier in production; this default
 * checks the registered claims that can be validated without a JWKS client.
 */
export function createWeb3AuthVerifier(
  options: Web3AuthVerifierOptions = {},
): Web3AuthVerifier {
  return {
    async verify(token: string): Promise<Web3AuthClaims | null> {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      let claims: Web3AuthClaims;
      try {
        claims = decodeSegment(parts[1]!) as Web3AuthClaims;
      } catch {
        return null;
      }

      if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
        return null;
      }
      if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
        return null;
      }
      if (options.issuer && claims.iss !== options.issuer) {
        return null;
      }
      if (options.audience && !claimAudiences(claims.aud).includes(options.audience)) {
        return null;
      }
      return claims;
    },
  };
}

export class Web3AuthStrategy implements IAuthStrategy {
  readonly name = 'web3auth';
  readonly rateLimitTier = 'premium' as const;
  readonly priority = 25;

  constructor(private readonly verifier: Web3AuthVerifier = createWeb3AuthVerifier()) {}

  async validate(req: Request): Promise<AuthUser | null> {
    const tokenHeader =
      req.headers['x-web3auth-token'] ?? req.headers['x-web3auth-id-token'];
    if (typeof tokenHeader !== 'string' || tokenHeader.length === 0) {
      return null;
    }

    const claims = await this.verifier.verify(tokenHeader);
    if (!claims) return null;

    const address = claims.wallets?.find((wallet) => typeof wallet.address === 'string')?.address;

    return {
      id: claims.sub,
      roles: address ? ['web3auth_user', 'wallet_user'] : ['web3auth_user'],
      strategy: this.name,
      metadata: { address, issuer: claims.iss },
    };
  }
}

export interface AuthGatewayOptions {
  strategies?: IAuthStrategy[];
  web3authVerifier?: Web3AuthVerifier;
  web3auth?: Web3AuthVerifierOptions;
  includeDefaults?: boolean;
}

/** Build a gateway with JWT, API key and Web3Auth strategies in priority order. */
export function createAuthGateway(options: AuthGatewayOptions = {}): CompositeAuthStrategyManager {
  const defaults: IAuthStrategy[] =
    options.includeDefaults === false
      ? []
      : [new JwtAuthStrategy(), new ApiKeyAuthStrategy()];

  const verifier =
    options.web3authVerifier ?? createWeb3AuthVerifier(options.web3auth ?? {});

  return new CompositeAuthStrategyManager([
    ...defaults,
    new Web3AuthStrategy(verifier),
    ...(options.strategies ?? []),
  ]);
}

export function createAuthGatewayMiddleware(
  options: AuthGatewayOptions = {},
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createUnifiedAuthMiddleware(createAuthGateway(options));
}
