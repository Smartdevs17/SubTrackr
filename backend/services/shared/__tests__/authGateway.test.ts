import { Request, Response, NextFunction } from 'express';
import {
  Web3AuthStrategy,
  createAuthGateway,
  createAuthGatewayMiddleware,
  createWeb3AuthVerifier,
  Web3AuthClaims,
  Web3AuthVerifier,
} from '../authGateway';
import { UnauthorizedError } from '../errors';

function tokenFor(claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

const validClaims: Web3AuthClaims = {
  sub: 'web3auth-user-1',
  iss: 'https://issuer.example.com',
  aud: 'subtrackr',
  exp: future,
  wallets: [{ address: 'GABC123' }],
};

describe('Web3Auth auth gateway', () => {
  it('verifies a well-formed ID token', async () => {
    const verifier = createWeb3AuthVerifier({
      issuer: validClaims.iss,
      audience: 'subtrackr',
    });
    await expect(verifier.verify(tokenFor(validClaims))).resolves.toMatchObject(validClaims);
  });

  it.each([
    ['malformed token', 'not-a-jwt'],
    ['expired token', tokenFor({ ...validClaims, exp: past })],
    ['wrong issuer', tokenFor({ ...validClaims, iss: 'https://other.example.com' })],
    ['wrong audience', tokenFor({ ...validClaims, aud: 'other-app' })],
    ['missing subject', tokenFor({ exp: future })],
  ])('rejects %s', async (_label, token) => {
    const verifier = createWeb3AuthVerifier({
      issuer: validClaims.iss,
      audience: 'subtrackr',
    });
    await expect(verifier.verify(token)).resolves.toBeNull();
  });

  it('extracts a Web3Auth user and linked wallet', async () => {
    const strategy = new Web3AuthStrategy(createWeb3AuthVerifier());
    const req = { headers: { 'x-web3auth-token': tokenFor(validClaims) } } as unknown as Request;

    const user = await strategy.validate(req);

    expect(user).toMatchObject({
      id: 'web3auth-user-1',
      strategy: 'web3auth',
      roles: ['web3auth_user', 'wallet_user'],
      metadata: { address: 'GABC123' },
    });
  });

  it('skips requests without a Web3Auth token', async () => {
    const verifier: Web3AuthVerifier = { verify: jest.fn() };
    const strategy = new Web3AuthStrategy(verifier);

    await expect(strategy.validate({ headers: {} } as unknown as Request)).resolves.toBeNull();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('routes each strategy through the gateway by priority', async () => {
    const gateway = createAuthGateway();

    expect(gateway.getStrategies().map((s) => s.name)).toEqual([
      'jwt',
      'api-key',
      'web3auth',
    ]);

    await expect(
      gateway.authenticate({ headers: { 'x-web3auth-token': tokenFor(validClaims) }, query: {} } as unknown as Request),
    ).resolves.toMatchObject({ strategy: 'web3auth' });

    await expect(
      gateway.authenticate({ headers: { authorization: 'Bearer a.jwt.token' }, query: {} } as unknown as Request),
    ).resolves.toMatchObject({ strategy: 'jwt' });

    await expect(
      gateway.authenticate({ headers: { 'x-api-key': 'sk_test_123' }, query: {} } as unknown as Request),
    ).resolves.toMatchObject({ strategy: 'api-key' });
  });

  it('supports custom strategies and an injected verifier', async () => {
    const custom = {
      name: 'custom',
      rateLimitTier: 'basic' as const,
      priority: 1,
      validate: jest.fn().mockResolvedValue(null),
    };
    const verifier: Web3AuthVerifier = {
      verify: jest.fn().mockResolvedValue(validClaims),
    };
    const gateway = createAuthGateway({
      includeDefaults: false,
      strategies: [custom],
      web3authVerifier: verifier,
    });

    await expect(
      gateway.authenticate({ headers: { 'x-web3auth-token': 'opaque' }, query: {} } as unknown as Request),
    ).resolves.toMatchObject({ strategy: 'web3auth' });
    expect(verifier.verify).toHaveBeenCalledWith('opaque');
  });

  it('attaches the authenticated user in middleware', async () => {
    const middleware = createAuthGatewayMiddleware();
    const req = {
      headers: { 'x-web3auth-token': tokenFor(validClaims) },
      query: {},
    } as unknown as Request;
    const next = jest.fn() as NextFunction;

    await middleware(req, {} as Response, next);

    expect((req as any).user.strategy).toBe('web3auth');
    expect((req as any).authStrategy).toBe('web3auth');
    expect(next).toHaveBeenCalledWith();
  });

  it('passes authentication failures to the error handler', async () => {
    const middleware = createAuthGatewayMiddleware();
    const next = jest.fn() as NextFunction;

    await middleware({ headers: {}, query: {} } as unknown as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
