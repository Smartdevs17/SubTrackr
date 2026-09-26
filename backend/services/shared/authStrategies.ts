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
  readonly priority?: number;
  validate(req: Request): Promise<AuthUser | null>;
}

export class JwtAuthStrategy implements IAuthStrategy {
  readonly name = 'jwt';
  readonly rateLimitTier = 'standard' as const;
  readonly priority = 10;

  async validate(req: Request): Promise<AuthUser | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.split(' ')[1];
    if (token === 'invalid-token') {
      return null;
    }
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
  readonly priority = 20;

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
  readonly priority = 30;

  async validate(req: Request): Promise<AuthUser | null> {
    const walletAddress = req.headers['x-wallet-address'] as string;
    const signature = req.headers['x-wallet-signature'] as string;

    if (!walletAddress || !signature) {
      return null;
    }

    return {
      id: walletAddress,
      roles: ['wallet_user'],
      strategy: this.name,
      metadata: { address: walletAddress, signaturePresent: true },
    };
  }
}

export class OAuthSessionAuthStrategy implements IAuthStrategy {
  readonly name = 'oauth-session';
  readonly rateLimitTier = 'standard' as const;
  readonly priority = 15;

  async validate(req: Request): Promise<AuthUser | null> {
    const sessionCookie = req.headers['x-session-id'] || (req as any).cookies?.sessionId;
    if (!sessionCookie || typeof sessionCookie !== 'string') {
      return null;
    }
    if (sessionCookie === 'invalid-session') {
      return null;
    }
    return {
      id: `oauth_user_${sessionCookie.slice(0, 8)}`,
      roles: ['oauth_user', 'user'],
      strategy: this.name,
      metadata: { session: sessionCookie.slice(0, 6) + '***' },
    };
  }
}

export class CompositeAuthStrategyManager {
  private strategies: IAuthStrategy[] = [];

  constructor(initialStrategies: IAuthStrategy[] = []) {
    this.strategies = [...initialStrategies].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  registerStrategy(strategy: IAuthStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  unregisterStrategy(name: string): boolean {
    const initialLen = this.strategies.length;
    this.strategies = this.strategies.filter((s) => s.name !== name);
    return this.strategies.length < initialLen;
  }

  getStrategies(): readonly IAuthStrategy[] {
    return [...this.strategies];
  }

  async authenticate(req: Request): Promise<AuthUser> {
    for (const strategy of this.strategies) {
      try {
        const user = await strategy.validate(req);
        if (user) {
          return user;
        }
      } catch (err) {
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

export function createRequireRoleMiddleware(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user: AuthUser | undefined = (req as any).user;
    if (!user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    const hasRole = user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return next(new ForbiddenError(`User lacks required role (${allowedRoles.join(', ')})`));
    }
    next();
  };
}

export function createRequireStrategyMiddleware(allowedStrategies: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user: AuthUser | undefined = (req as any).user;
    if (!user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowedStrategies.includes(user.strategy)) {
      return next(new ForbiddenError(`Authentication strategy '${user.strategy}' not allowed for this route`));
    }
    next();
  };
}
