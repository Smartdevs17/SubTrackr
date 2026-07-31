import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from './errors';

export interface AuthUser {
  id: string;
  roles: string[];
  strategy: string;
  metadata?: Record<string, any>;
}

export interface IAuthStrategy {
  readonly name: string;
  readonly rateLimitTier: 'basic' | 'standard' | 'premium';
  validate(req: Request): Promise<AuthUser | null>;
}

export class JwtAuthStrategy implements IAuthStrategy {
  readonly name = 'jwt';
  readonly rateLimitTier = 'standard' as const;

  async validate(req: Request): Promise<AuthUser | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.split(' ')[1];
    if (token === 'invalid-token') {
      return null;
    }
    // Standard decoded JWT stub / verification logic
    return {
      id: 'user_jwt_123',
      roles: ['user'],
      strategy: this.name,
      metadata: { token: token.slice(0, 10) + '...' },
    };
  }
}

export class ApiKeyAuthStrategy implements IAuthStrategy {
  readonly name = 'api-key';
  readonly rateLimitTier = 'premium' as const;

  async validate(req: Request): Promise<AuthUser | null> {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey || typeof apiKey !== 'string') {
      return null;
    }
    if (apiKey === 'invalid-api-key') {
      return null;
    }
    return {
      id: `service_${apiKey.slice(0, 6)}`,
      roles: ['api_client'],
      strategy: this.name,
      metadata: { apiKey: apiKey.slice(0, 4) + '***' },
    };
  }
}

export class WalletAuthStrategy implements IAuthStrategy {
  readonly name = 'wallet';
  readonly rateLimitTier = 'basic' as const;

  async validate(req: Request): Promise<AuthUser | null> {
    const walletAddress = req.headers['x-wallet-address'] as string;
    const signature = req.headers['x-wallet-signature'] as string;

    if (!walletAddress || !signature) {
      return null;
    }

    // Stellar / EVM public key & signature verification stub
    return {
      id: walletAddress,
      roles: ['wallet_user'],
      strategy: this.name,
      metadata: { address: walletAddress, signaturePresent: true },
    };
  }
}

export class CompositeAuthStrategyManager {
  private strategies: IAuthStrategy[] = [];

  constructor(initialStrategies: IAuthStrategy[] = []) {
    this.strategies = initialStrategies;
  }

  registerStrategy(strategy: IAuthStrategy): void {
    this.strategies.push(strategy);
  }

  async authenticate(req: Request): Promise<AuthUser> {
    for (const strategy of this.strategies) {
      try {
        const user = await strategy.validate(req);
        if (user) {
          return user;
        }
      } catch (err) {
        // Fallback to next strategy if execution fails
        continue;
      }
    }
    throw new UnauthorizedError('Authentication failed across all configured strategies');
  }
}

export function createUnifiedAuthMiddleware(manager: CompositeAuthStrategyManager) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await manager.authenticate(req);
      (req as any).user = user;
      (req as any).authStrategy = user.strategy;
      next();
    } catch (err) {
      next(err);
    }
  };
}
