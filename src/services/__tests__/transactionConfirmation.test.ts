/**
 * Tests for transactionConfirmation — defensive receipt waiting.
 *
 * @see src/services/transactionConfirmation.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1683
 */

import type { ethers } from 'ethers';

import {
  DEFAULT_CONFIRMATIONS,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  TransactionInsufficientConfirmationsError,
  TransactionRevertedError,
  TransactionTimeoutError,
  bestEffortTransactionHash,
  confirmTransaction,
  isDefinitiveFailure,
  requiredConfirmations,
} from '../transactionConfirmation';

type Receipt = ethers.providers.TransactionReceipt;

const L2_CHAIN_ID = 8453;
const L1_CHAIN_ID = 1;

const makeReceipt = (overrides: Partial<Receipt> = {}): Receipt =>
  ({
    transactionHash: '0xabc',
    status: 1,
    confirmations: 2,
    ...overrides,
  }) as Receipt;

const makeTx = (wait: (confirmations?: number) => Promise<Receipt | null>) => ({
  hash: '0xabc',
  wait,
});

describe('requiredConfirmations', () => {
  it('requires a single confirmation on fast L2 chains', () => {
    expect(requiredConfirmations(L2_CHAIN_ID)).toBe(1);
    expect(requiredConfirmations(10)).toBe(1);
    expect(requiredConfirmations(137)).toBe(1);
  });

  it('requires deeper confirmation on L1', () => {
    expect(requiredConfirmations(L1_CHAIN_ID)).toBe(DEFAULT_CONFIRMATIONS);
    expect(DEFAULT_CONFIRMATIONS).toBe(2);
  });

  it('honours an explicit override', () => {
    expect(requiredConfirmations(L2_CHAIN_ID, 5)).toBe(5);
  });

  it('never returns less than one confirmation', () => {
    expect(requiredConfirmations(L1_CHAIN_ID, 0)).toBe(1);
    expect(requiredConfirmations(L1_CHAIN_ID, -3)).toBe(1);
  });
});

describe('confirmTransaction', () => {
  it('returns the receipt when the transaction succeeded', async () => {
    const receipt = makeReceipt();
    const tx = makeTx(async () => receipt);

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).resolves.toBe(receipt);
  });

  it('passes the required confirmations to ethers', async () => {
    const wait = jest.fn().mockResolvedValue(makeReceipt({ confirmations: 1 }));
    const tx = makeTx(wait);

    await confirmTransaction(tx, { chainId: L2_CHAIN_ID });

    expect(wait).toHaveBeenCalledWith(1);
  });

  it('asks for the L1 confirmation depth on mainnet', async () => {
    const wait = jest.fn().mockResolvedValue(makeReceipt({ confirmations: 2 }));
    const tx = makeTx(wait);

    await confirmTransaction(tx, { chainId: L1_CHAIN_ID });

    expect(wait).toHaveBeenCalledWith(DEFAULT_CONFIRMATIONS);
  });

  it('enforces its own timeout even when the transaction never settles', async () => {
    // ethers v5 `ContractTransaction.wait()` ignores a timeout argument, so the
    // bound has to be enforced here or a contract payment can hang forever.
    jest.useFakeTimers();

    try {
      const tx = makeTx(() => new Promise<Receipt>(() => undefined));

      const pending = confirmTransaction(tx, { chainId: L2_CHAIN_ID, timeoutMs: 5000 });
      const assertion = expect(pending).rejects.toBeInstanceOf(TransactionTimeoutError);

      jest.advanceTimersByTime(5000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not fire the timeout when the receipt arrives in time', async () => {
    jest.useFakeTimers();

    try {
      const tx = makeTx(async () => makeReceipt());

      await expect(
        confirmTransaction(tx, { chainId: L2_CHAIN_ID, timeoutMs: 5000 })
      ).resolves.toBeDefined();

      // Any surviving timer must have been cleared, otherwise this leaks.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('defaults to a bounded timeout when none is supplied', async () => {
    jest.useFakeTimers();

    try {
      expect(DEFAULT_CONFIRMATION_TIMEOUT_MS).toBeGreaterThan(0);

      const tx = makeTx(() => new Promise<Receipt>(() => undefined));
      const pending = confirmTransaction(tx, { chainId: L2_CHAIN_ID });
      const assertion = expect(pending).rejects.toBeInstanceOf(TransactionTimeoutError);

      jest.advanceTimersByTime(DEFAULT_CONFIRMATION_TIMEOUT_MS);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws when the receipt reports a reverted transaction', async () => {
    // The core regression: `status === 0` means mined-but-failed, and this
    // used to be reported to the user as a successful payment.
    const tx = makeTx(async () => makeReceipt({ status: 0 }));

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toBeInstanceOf(
      TransactionRevertedError
    );
  });

  it('includes the revert reason when the node provides one', async () => {
    // Nodes expose the reason in vendor-specific shapes that ethers v5 does
    // not model on TransactionReceipt.
    const receiptWithReason = {
      ...makeReceipt({ status: 0 }),
      revertReason: 'ERC20: transfer amount exceeds balance',
    } as unknown as Receipt;
    const tx = makeTx(async () => receiptWithReason);

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toThrow(
      /ERC20: transfer amount exceeds balance/
    );
  });

  it('still throws for a revert when no reason is available', async () => {
    const tx = makeTx(async () => makeReceipt({ status: 0 }));

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toThrow(
      /reverted on-chain/
    );
  });

  it('maps an ethers wait timeout to a typed timeout error', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    const tx = makeTx(async () => {
      throw timeoutError;
    });

    await expect(
      confirmTransaction(tx, { chainId: L2_CHAIN_ID, timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
  });

  it('recognises timeout phrased as "timed out"', async () => {
    const tx = makeTx(async () => {
      throw new Error('transaction timed out waiting for receipt');
    });

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toBeInstanceOf(
      TransactionTimeoutError
    );
  });

  it('treats a null receipt as an unknown outcome', async () => {
    // ethers resolves null when a transaction was replaced or dropped.
    const tx = makeTx(async () => null);

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toBeInstanceOf(
      TransactionTimeoutError
    );
  });

  it('throws when fewer confirmations than required were reached', async () => {
    const tx = makeTx(async () => makeReceipt({ confirmations: 1 }));

    await expect(confirmTransaction(tx, { chainId: L1_CHAIN_ID })).rejects.toBeInstanceOf(
      TransactionInsufficientConfirmationsError
    );
  });

  it('rethrows unexpected errors untouched', async () => {
    const tx = makeTx(async () => {
      throw new Error('user rejected transaction');
    });

    await expect(confirmTransaction(tx, { chainId: L2_CHAIN_ID })).rejects.toThrow(
      'user rejected transaction'
    );
  });
});

describe('isDefinitiveFailure', () => {
  it('treats a revert as definitive', () => {
    expect(isDefinitiveFailure(new TransactionRevertedError('0x1'))).toBe(true);
  });

  it('treats insufficient confirmations as definitive', () => {
    expect(isDefinitiveFailure(new TransactionInsufficientConfirmationsError('0x1', 1, 2))).toBe(
      true
    );
  });

  it('does not treat a timeout as definitive', () => {
    expect(isDefinitiveFailure(new TransactionTimeoutError('0x1', 100))).toBe(false);
  });
});

describe('bestEffortTransactionHash', () => {
  it('returns the hash when the transaction confirms', async () => {
    const tx = makeTx(async () => makeReceipt());
    await expect(bestEffortTransactionHash(tx, { chainId: L2_CHAIN_ID })).resolves.toBe('0xabc');
  });

  it('still returns the hash when the receipt cannot be observed', async () => {
    // A crash or dropped connection after broadcast leaves the outcome
    // unknown; the hash is the durable handle the user needs.
    const tx = makeTx(async () => null);
    await expect(bestEffortTransactionHash(tx, { chainId: L2_CHAIN_ID })).resolves.toBe('0xabc');
  });

  it('propagates a revert rather than swallowing it', async () => {
    const tx = makeTx(async () => makeReceipt({ status: 0 }));
    await expect(bestEffortTransactionHash(tx, { chainId: L2_CHAIN_ID })).rejects.toBeInstanceOf(
      TransactionRevertedError
    );
  });

  it('returns undefined for a missing response', async () => {
    await expect(bestEffortTransactionHash(null)).resolves.toBeUndefined();
    await expect(bestEffortTransactionHash(undefined)).resolves.toBeUndefined();
  });
});
