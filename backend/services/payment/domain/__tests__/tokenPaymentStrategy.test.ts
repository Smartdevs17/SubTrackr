/**
 * Tests for the multi-chain token payment strategy (Issue #2213).
 *
 * Covers ERC20 (EVM) and Soroban (Stellar) strategies, the router with
 * fallback, balance queries, refunds, and error paths.
 */

import {
  ERC20TokenPaymentStrategy,
  SorobanTokenPaymentStrategy,
  TokenPaymentRouter,
  TokenPaymentError,
  type EvmRpcClient,
  type SorobanClient,
  type TokenPaymentRequest,
  type TokenRefundRequest,
  type TokenBalanceQuery,
} from '../tokenPaymentStrategy';

// ── Stubs ────────────────────────────────────────────────────────────────────

function makeEvmClient(overrides: Partial<EvmRpcClient> = {}): EvmRpcClient {
  return {
    getChainId: async () => 1,
    getBalance: async () => '1000000000000000000',
    getTokenBalance: async () => '100000000000000000000',
    transferToken: async () => ({ txHash: '0xabc123', gasUsed: '21000' }),
    estimateTransferGas: async () => '21000',
    isHealthy: async () => true,
    ...overrides,
  };
}

function makeSorobanClient(overrides: Partial<SorobanClient> = {}): SorobanClient {
  return {
    transferToken: async () => ({ txHash: 'stellar_tx_hash', feeUsed: '100' }),
    getTokenBalance: async () => '1000000000',
    isHealthy: async () => true,
    getNetworkPassphrase: () => 'Public Global Stellar Network ; September 2015',
    ...overrides,
  };
}

function makePaymentRequest(overrides: Partial<TokenPaymentRequest> = {}): TokenPaymentRequest {
  return {
    paymentId: 'tp_test_1',
    subscriptionId: 'sub_test_1',
    from: '0xPayer',
    to: '0xMerchant',
    amount: '1000000',
    tokenAddress: '0xTokenContract',
    tokenSymbol: 'USDC',
    chainId: '1',
    chainType: 'evm',
    ...overrides,
  };
}

function makeRefundRequest(overrides: Partial<TokenRefundRequest> = {}): TokenRefundRequest {
  return {
    paymentId: 'tp_test_1',
    subscriptionId: 'sub_test_1',
    originalTxHash: '0xabc123',
    amount: '500000',
    from: '0xMerchant',
    to: '0xPayer',
    tokenAddress: '0xTokenContract',
    tokenSymbol: 'USDC',
    chainId: '1',
    chainType: 'evm',
    ...overrides,
  };
}

function makeBalanceQuery(overrides: Partial<TokenBalanceQuery> = {}): TokenBalanceQuery {
  return {
    address: '0xPayer',
    tokenAddress: '0xTokenContract',
    tokenSymbol: 'USDC',
    chainId: '1',
    chainType: 'evm',
    ...overrides,
  };
}

// ── ERC20 strategy ──────────────────────────────────────────────────────────

describe('ERC20TokenPaymentStrategy', () => {
  it('charges successfully when balance is sufficient', async () => {
    const client = makeEvmClient({
      getTokenBalance: async () => '2000000',
      transferToken: async () => ({ txHash: '0xsuccess', gasUsed: '21000' }),
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.charge(makePaymentRequest());

    expect(result.status).toBe('succeeded');
    expect(result.txHash).toBe('0xsuccess');
    expect(result.chainType).toBe('evm');
    expect(result.gasUsed).toBe('21000');
  });

  it('fails when balance is insufficient', async () => {
    const client = makeEvmClient({
      getTokenBalance: async () => '500000',
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.charge(makePaymentRequest({ amount: '1000000' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('Insufficient');
    expect(result.errorMessage).toContain('500000');
  });

  it('fails when chain type is not EVM', async () => {
    const strategy = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });

    const result = await strategy.charge(makePaymentRequest({ chainType: 'stellar' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('only handles EVM');
  });

  it('fails when no RPC client is registered for the chain', async () => {
    const strategy = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });

    const result = await strategy.charge(makePaymentRequest({ chainId: '137' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('No RPC client');
  });

  it('returns failed result when transfer throws', async () => {
    const client = makeEvmClient({
      transferToken: async () => {
        throw new Error('RPC timeout');
      },
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.charge(makePaymentRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('RPC timeout');
  });

  it('refunds by transferring from merchant back to payer', async () => {
    const client = makeEvmClient({
      transferToken: async () => ({ txHash: '0xrefund', gasUsed: '21000' }),
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.refund(makeRefundRequest());

    expect(result.status).toBe('succeeded');
    expect(result.txHash).toBe('0xrefund');
  });

  it('fails refund when no client for chain', async () => {
    const strategy = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });

    const result = await strategy.refund(makeRefundRequest({ chainId: '137' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('No RPC client');
  });

  it('returns token balance on query', async () => {
    const client = makeEvmClient({
      getTokenBalance: async () => '9999999999',
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.getBalance(makeBalanceQuery());

    expect(result.ok).toBe(true);
    expect(result.balance).toBe('9999999999');
  });

  it('returns error on balance query for unknown chain', async () => {
    const strategy = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });

    const result = await strategy.getBalance(makeBalanceQuery({ chainId: '999' }));

    expect(result.ok).toBe(false);
    expect(result.balance).toBe('0');
    expect(result.errorMessage).toContain('No RPC client');
  });

  it('supports only registered chain ids', () => {
    const strategy = new ERC20TokenPaymentStrategy({ '1': makeEvmClient(), '137': makeEvmClient() });

    expect(strategy.supports('1')).toBe(true);
    expect(strategy.supports('137')).toBe(true);
    expect(strategy.supports('42161')).toBe(false);
  });
});

// ── Soroban strategy ─────────────────────────────────────────────────────────

describe('SorobanTokenPaymentStrategy', () => {
  const STELLAR_MAINNET = 'Public Global Stellar Network ; September 2015';

  it('charges successfully when balance is sufficient', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => '2000000000',
      transferToken: async () => ({ txHash: 'stellar_hash', feeUsed: '100' }),
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.charge(
      makePaymentRequest({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
        tokenSymbol: 'XLM',
      }),
    );

    expect(result.status).toBe('succeeded');
    expect(result.txHash).toBe('stellar_hash');
    expect(result.chainType).toBe('stellar');
    expect(result.gasUsed).toBe('100');
  });

  it('fails when balance is insufficient', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => '100000',
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.charge(
      makePaymentRequest({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
        amount: '1000000',
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('Insufficient');
  });

  it('fails when chain type is not stellar', async () => {
    const strategy = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);

    const result = await strategy.charge(makePaymentRequest({ chainType: 'evm' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('only handles Stellar');
  });

  it('fails when network passphrase is not supported', async () => {
    const strategy = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);

    const result = await strategy.charge(
      makePaymentRequest({
        chainType: 'stellar',
        chainId: 'Test SDF Network ; September 2015',
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('Unsupported Stellar network');
  });

  it('handles transfer errors gracefully', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => '9999999999',
      transferToken: async () => {
        throw new Error('Soroban contract reverted');
      },
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.charge(
      makePaymentRequest({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Soroban contract reverted');
  });

  it('refunds with a memo containing the payment id', async () => {
    let capturedMemo: string | undefined;
    const client = makeSorobanClient({
      transferToken: async (_contract, _from, _to, _amount, memo) => {
        capturedMemo = memo;
        return { txHash: 'refund_hash', feeUsed: '100' };
      },
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.refund(
      makeRefundRequest({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
      }),
    );

    expect(result.status).toBe('succeeded');
    expect(capturedMemo).toBe('refund:tp_test_1');
  });

  it('fails refund on unsupported network', async () => {
    const strategy = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);

    const result = await strategy.refund(
      makeRefundRequest({
        chainType: 'stellar',
        chainId: 'Unknown Network',
      }),
    );

    expect(result.status).toBe('failed');
  });

  it('returns balance on query', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => '5000000000',
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.getBalance(
      makeBalanceQuery({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.balance).toBe('5000000000');
  });

  it('returns error on balance query for unsupported network', async () => {
    const strategy = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);

    const result = await strategy.getBalance(
      makeBalanceQuery({
        chainType: 'stellar',
        chainId: 'Unknown',
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('Unsupported');
  });

  it('supports only configured network passphrases', () => {
    const strategy = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);

    expect(strategy.supports(STELLAR_MAINNET)).toBe(true);
    expect(strategy.supports('Unknown')).toBe(false);
  });
});

// ── TokenPaymentRouter ───────────────────────────────────────────────────────

describe('TokenPaymentRouter', () => {
  const STELLAR_MAINNET = 'Public Global Stellar Network ; September 2015';

  it('routes EVM charges to the ERC20 strategy', async () => {
    const evmClient = makeEvmClient();
    const erc20 = new ERC20TokenPaymentStrategy({ '1': evmClient });
    const router = new TokenPaymentRouter([erc20]);

    const result = await router.charge(makePaymentRequest());

    expect(result.status).toBe('succeeded');
    expect(result.chainType).toBe('evm');
  });

  it('routes Stellar charges to the Soroban strategy', async () => {
    const soroban = new SorobanTokenPaymentStrategy(makeSorobanClient(), [STELLAR_MAINNET]);
    const router = new TokenPaymentRouter([soroban]);

    const result = await router.charge(
      makePaymentRequest({
        chainType: 'stellar',
        chainId: STELLAR_MAINNET,
        tokenSymbol: 'XLM',
      }),
    );

    expect(result.status).toBe('succeeded');
    expect(result.chainType).toBe('stellar');
  });

  it('returns failed when no strategy for chain type', async () => {
    const router = new TokenPaymentRouter([]);

    const result = await router.charge(makePaymentRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('No strategy registered');
  });

  it('falls back to alternative chain when primary fails', async () => {
    const failingClient = makeEvmClient({
      getTokenBalance: async () => '0', // insufficient balance on primary
    });
    const okClient = makeEvmClient({
      getTokenBalance: async () => '9999999999',
      transferToken: async () => ({ txHash: '0xfallback', gasUsed: '21000' }),
    });

    const erc20 = new ERC20TokenPaymentStrategy({
      '1': failingClient,
      '137': okClient,
    });
    const router = new TokenPaymentRouter([erc20], {
      fallbackChains: { '1': ['137'] },
    });

    const result = await router.charge(makePaymentRequest());

    expect(result.status).toBe('succeeded');
    expect(result.chainId).toBe('137');
    expect(result.txHash).toBe('0xfallback');
  });

  it('returns primary failure when no fallback succeeds', async () => {
    const failingClient = makeEvmClient({
      getTokenBalance: async () => '0',
    });
    const altClient = makeEvmClient({
      getTokenBalance: async () => '0',
    });

    const erc20 = new ERC20TokenPaymentStrategy({
      '1': failingClient,
      '137': altClient,
    });
    const router = new TokenPaymentRouter([erc20], {
      fallbackChains: { '1': ['137'] },
    });

    const result = await router.charge(makePaymentRequest());

    expect(result.status).toBe('failed');
    expect(result.chainId).toBe('1');
  });

  it('falls back across different chain types (EVM → Stellar)', async () => {
    const failingEvmClient = makeEvmClient({
      getTokenBalance: async () => '0',
    });
    const erc20 = new ERC20TokenPaymentStrategy({ '1': failingEvmClient });
    const soroban = new SorobanTokenPaymentStrategy(
      makeSorobanClient({
        getTokenBalance: async () => '9999999999',
        transferToken: async () => ({ txHash: 'stellar_fallback', feeUsed: '100' }),
      }),
      [STELLAR_MAINNET],
    );
    const router = new TokenPaymentRouter([erc20, soroban], {
      fallbackChains: { '1': [STELLAR_MAINNET] },
    });

    const result = await router.charge(makePaymentRequest());

    expect(result.status).toBe('succeeded');
    expect(result.chainType).toBe('stellar');
  });

  it('routes refunds to the correct strategy', async () => {
    const erc20 = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });
    const router = new TokenPaymentRouter([erc20]);

    const result = await router.refund(makeRefundRequest());

    expect(result.status).toBe('succeeded');
  });

  it('fails refund when no strategy for chain type', async () => {
    const router = new TokenPaymentRouter([]);

    const result = await router.refund(makeRefundRequest({ chainType: 'stellar' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('No strategy');
  });

  it('routes balance queries to the correct strategy', async () => {
    const erc20 = new ERC20TokenPaymentStrategy({
      '1': makeEvmClient({ getTokenBalance: async () => '42' }),
    });
    const router = new TokenPaymentRouter([erc20]);

    const result = await router.getBalance(makeBalanceQuery());

    expect(result.ok).toBe(true);
    expect(result.balance).toBe('42');
  });

  it('returns error on balance query when no strategy', async () => {
    const router = new TokenPaymentRouter([]);

    const result = await router.getBalance(makeBalanceQuery());

    expect(result.ok).toBe(false);
  });

  it('allows registering strategies after construction', async () => {
    const router = new TokenPaymentRouter([]);

    expect(router.getStrategy('evm')).toBeUndefined();

    const erc20 = new ERC20TokenPaymentStrategy({ '1': makeEvmClient() });
    router.registerStrategy(erc20);

    expect(router.getStrategy('evm')).toBeDefined();

    const result = await router.charge(makePaymentRequest());
    expect(result.status).toBe('succeeded');
  });
});

// ── Non-Error throw branches and TokenPaymentError ───────────────────────────

describe('Error handling edge cases', () => {
  const STELLAR_MAINNET = 'Public Global Stellar Network ; September 2015';

  it('ERC20 refund handles non-Error throw', async () => {
    const client = makeEvmClient({
      transferToken: async () => {
        throw 'some string error';
      },
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.refund(makeRefundRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('some string error');
  });

  it('ERC20 balance query handles non-Error throw', async () => {
    const client = makeEvmClient({
      getTokenBalance: async () => {
        throw { code: 500, msg: 'rpc down' };
      },
    });
    const strategy = new ERC20TokenPaymentStrategy({ '1': client });

    const result = await strategy.getBalance(makeBalanceQuery());

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('[object Object]');
  });

  it('Soroban charge handles non-Error throw', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => '9999999999',
      transferToken: async () => {
        throw 'soroban reverted';
      },
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.charge(
      makePaymentRequest({ chainType: 'stellar', chainId: STELLAR_MAINNET }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('soroban reverted');
  });

  it('Soroban refund handles non-Error throw', async () => {
    const client = makeSorobanClient({
      transferToken: async () => {
        throw 42;
      },
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.refund(
      makeRefundRequest({ chainType: 'stellar', chainId: STELLAR_MAINNET }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('42');
  });

  it('Soroban balance query handles non-Error throw', async () => {
    const client = makeSorobanClient({
      getTokenBalance: async () => {
        throw 'balance check failed';
      },
    });
    const strategy = new SorobanTokenPaymentStrategy(client, [STELLAR_MAINNET]);

    const result = await strategy.getBalance(
      makeBalanceQuery({ chainType: 'stellar', chainId: STELLAR_MAINNET }),
    );

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('balance check failed');
  });

  it('TokenPaymentError carries a code', () => {
    const err = new TokenPaymentError('test', 'TRANSFER_FAILED');
    expect(err.message).toBe('test');
    expect(err.code).toBe('TRANSFER_FAILED');
    expect(err.name).toBe('TokenPaymentError');
  });
});
