import { Request } from 'express';
import {
  JwtAuthStrategy,
  ApiKeyAuthStrategy,
  WalletAuthStrategy,
  OAuthSessionAuthStrategy,
  CompositeAuthStrategyManager,
  createRequireRoleMiddleware,
  createRequireStrategyMiddleware,
} from '../authStrategies';
import { UnauthorizedError, ForbiddenError } from '../errors';

describe('Auth Strategies', () => {
  it('validates JWT token strategy', async () => {
    const strategy = new JwtAuthStrategy();
    const mockReq = { headers: { authorization: 'Bearer valid.jwt.token' } } as Request;
    const user = await strategy.validate(mockReq);

    expect(user).not.toBeNull();
    expect(user?.strategy).toBe('jwt');
    expect(user?.roles).toContain('user');
  });

  it('rejects invalid JWT token', async () => {
    const strategy = new JwtAuthStrategy();
    const mockReq = { headers: { authorization: 'Bearer invalid-token' } } as Request;
    const user = await strategy.validate(mockReq);

    expect(user).toBeNull();
  });

  it('validates API key strategy', async () => {
    const strategy = new ApiKeyAuthStrategy();
    const mockReq = { headers: { 'x-api-key': 'valid-api-key-12345' } } as Request;
    const user = await strategy.validate(mockReq);

    expect(user).not.toBeNull();
    expect(user?.strategy).toBe('api-key');
    expect(user?.roles).toContain('api_client');
  });

  it('validates OAuth session strategy', async () => {
    const strategy = new OAuthSessionAuthStrategy();
    const mockReq = { headers: { 'x-session-id': 'sess_abc123' } } as Request;
    const user = await strategy.validate(mockReq);

    expect(user).not.toBeNull();
    expect(user?.strategy).toBe('oauth-session');
    expect(user?.roles).toContain('oauth_user');
  });

  it('runs composite authentication manager across multiple strategies', async () => {
    const manager = new CompositeAuthStrategyManager([
      new JwtAuthStrategy(),
      new ApiKeyAuthStrategy(),
      new WalletAuthStrategy(),
      new OAuthSessionAuthStrategy(),
    ]);

    const reqWithApiKey = { headers: { 'x-api-key': 'valid-api-key-123' }, query: {} } as Request;
    const user = await manager.authenticate(reqWithApiKey);

    expect(user.strategy).toBe('api-key');
  });

  it('throws UnauthorizedError when all strategies fail', async () => {
    const manager = new CompositeAuthStrategyManager([
      new JwtAuthStrategy(),
      new ApiKeyAuthStrategy(),
    ]);

    const emptyReq = { headers: {}, query: {} } as Request;
    await expect(manager.authenticate(emptyReq)).rejects.toThrow(UnauthorizedError);
  });

  it('enforces role authorization middleware', () => {
    const middleware = createRequireRoleMiddleware(['admin', 'api_client']);

    const reqWithRole = { user: { id: '123', roles: ['api_client'], strategy: 'api-key' } } as any;
    const reqWithoutRole = { user: { id: '456', roles: ['user'], strategy: 'jwt' } } as any;
    const next = jest.fn();

    middleware(reqWithRole, {} as any, next);
    expect(next).toHaveBeenCalledWith();

    next.mockClear();
    middleware(reqWithoutRole, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('enforces strategy requirement middleware', () => {
    const middleware = createRequireStrategyMiddleware(['api-key', 'jwt']);

    const validReq = { user: { id: '123', roles: [], strategy: 'api-key' } } as any;
    const invalidReq = { user: { id: '456', roles: [], strategy: 'wallet' } } as any;
    const next = jest.fn();

    middleware(validReq, {} as any, next);
    expect(next).toHaveBeenCalledWith();

    next.mockClear();
    middleware(invalidReq, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});
