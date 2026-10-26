import {
  SEP0007_DEFAULT_CALLBACK,
  Sep0007Error,
  buildSep0007PayUri,
  buildSep0007TxUri,
  cancelSep0007Wait,
  isSep0007Uri,
  isStellarPublicKey,
  openInWallet,
  parseSep0007Callback,
  parseSep0007Uri,
  requestWalletSignature,
  signViaDeepLink,
  submitSignedTransaction,
  waitForSep0007Callback,
} from '../sep0007Service';

const mockListeners: Array<(event: { url: string }) => void> = [];

jest.mock('expo-linking', () => ({
  openURL: jest.fn(() => Promise.resolve()),
  addEventListener: jest.fn(
    (_type: string, handler: (event: { url: string }) => void) => {
      mockListeners.push(handler);
      return {
        remove: jest.fn(() => {
          const index = mockListeners.indexOf(handler);
          if (index >= 0) mockListeners.splice(index, 1);
        }),
      };
    }
  ),
}));

const mockSubmitTransaction = jest.fn();
const mockFromXDR = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      submitTransaction: (...args: unknown[]) => mockSubmitTransaction(...args),
    })),
  },
  TransactionBuilder: {
    fromXDR: (...args: unknown[]) => mockFromXDR(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Linking = require('expo-linking');

const VALID_PUBKEY = 'G'.padEnd(56, 'A');
const VALID_XDR = 'AAAA'.padEnd(64, 'Q');
const CALLBACK_PREFIX = 'subtrackr://stellar/callback?';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const emitCallback = (url: string) => {
  for (const listener of [...mockListeners]) {
    listener({ url });
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.length = 0;
  Linking.openURL.mockImplementation(() => Promise.resolve());
  mockFromXDR.mockReturnValue({ envelope: 'parsed' });
  mockSubmitTransaction.mockResolvedValue({ hash: 'submitted-hash' });
});

describe('isStellarPublicKey', () => {
  it('accepts a G-prefixed 56 character key', () => {
    expect(isStellarPublicKey(VALID_PUBKEY)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isStellarPublicKey('GBADKEY')).toBe(false);
    expect(isStellarPublicKey('')).toBe(false);
    expect(isStellarPublicKey(undefined)).toBe(false);
    expect(isStellarPublicKey(123)).toBe(false);
  });
});

describe('isSep0007Uri', () => {
  it('detects web+stellar URIs', () => {
    expect(isSep0007Uri('web+stellar:tx?xdr=AAAA')).toBe(true);
    expect(isSep0007Uri('https://example.com')).toBe(false);
    expect(isSep0007Uri(null)).toBe(false);
  });
});

describe('buildSep0007TxUri', () => {
  it('builds a tx URI with the default callback', () => {
    const uri = buildSep0007TxUri({ xdr: VALID_XDR });
    const parsed = new URL(uri.replace('web+stellar:', 'https://'));

    expect(uri.startsWith('web+stellar:tx?')).toBe(true);
    expect(parsed.searchParams.get('xdr')).toBe(VALID_XDR);
    expect(parsed.searchParams.get('callback')).toBe(SEP0007_DEFAULT_CALLBACK);
  });

  it('includes optional msg, pubkey and network passphrase', () => {
    const uri = buildSep0007TxUri({
      xdr: VALID_XDR,
      msg: 'Pay subscription 42',
      pubkey: VALID_PUBKEY,
      networkPassphrase: 'Test SDF Network ; September 2015',
      callback: 'url:subtrackr://stellar/callback',
    });
    const parsed = new URL(uri.replace('web+stellar:', 'https://'));

    expect(parsed.searchParams.get('msg')).toBe('Pay subscription 42');
    expect(parsed.searchParams.get('pubkey')).toBe(VALID_PUBKEY);
    expect(parsed.searchParams.get('network_passphrase')).toBe(
      'Test SDF Network ; September 2015'
    );
  });

  it('encodes special characters in msg', () => {
    const uri = buildSep0007TxUri({ xdr: VALID_XDR, msg: 'a & b = c' });
    expect(uri).toContain('msg=a+%26+b+%3D+c');
  });

  it('rejects an empty or non-base64 XDR', () => {
    expect(() => buildSep0007TxUri({ xdr: '' })).toThrow(Sep0007Error);
    expect(() => buildSep0007TxUri({ xdr: 'not base64 !!!' })).toThrow(Sep0007Error);
    expect(() => buildSep0007TxUri({ xdr: 'short' })).toThrow(Sep0007Error);
  });

  it('rejects an oversized msg', () => {
    expect(() => buildSep0007TxUri({ xdr: VALID_XDR, msg: 'x'.repeat(1001) })).toThrow(
      Sep0007Error
    );
  });

  it('rejects a callback without the url: prefix', () => {
    expect(() =>
      buildSep0007TxUri({ xdr: VALID_XDR, callback: 'https://example.com' })
    ).toThrow(Sep0007Error);
  });

  it('rejects an invalid pubkey', () => {
    expect(() => buildSep0007TxUri({ xdr: VALID_XDR, pubkey: 'nope' })).toThrow(
      Sep0007Error
    );
  });
});

describe('buildSep0007PayUri', () => {
  it('builds a pay URI with destination and amount', () => {
    const uri = buildSep0007PayUri({
      destination: VALID_PUBKEY,
      amount: '12.5',
      currency: 'USDC:GBBD47IF6LWK7P7MDEVSCQZ3PIBVR7TJ7F3FYQ6AYFXF5QEDRF7M7U6D',
      memo: 'sub-42',
      memoType: 'text',
    });
    const parsed = new URL(uri.replace('web+stellar:', 'https://'));

    expect(uri.startsWith('web+stellar:pay?')).toBe(true);
    expect(parsed.searchParams.get('destination')).toBe(VALID_PUBKEY);
    expect(parsed.searchParams.get('amount')).toBe('12.5');
    expect(parsed.searchParams.get('currency')).toContain('USDC:');
    expect(parsed.searchParams.get('memo')).toBe('sub-42');
    expect(parsed.searchParams.get('memo_type')).toBe('text');
  });

  it('rejects an invalid destination', () => {
    expect(() => buildSep0007PayUri({ destination: 'rMNP...' })).toThrow(Sep0007Error);
  });

  it('rejects a non-positive amount', () => {
    expect(() => buildSep0007PayUri({ destination: VALID_PUBKEY, amount: '-1' })).toThrow(
      Sep0007Error
    );
    expect(() => buildSep0007PayUri({ destination: VALID_PUBKEY, amount: 'abc' })).toThrow(
      Sep0007Error
    );
  });

  it('rejects an unsupported memo type', () => {
    expect(() =>
      buildSep0007PayUri({ destination: VALID_PUBKEY, memoType: 'wat' as 'text' })
    ).toThrow(Sep0007Error);
  });
});

describe('parseSep0007Uri', () => {
  it('round-trips a tx URI', () => {
    const uri = buildSep0007TxUri({ xdr: VALID_XDR, msg: 'hello' });
    const parsed = parseSep0007Uri(uri);

    expect(parsed.operation).toBe('tx');
    expect(parsed.params.xdr).toBe(VALID_XDR);
    expect(parsed.params.msg).toBe('hello');
  });

  it('round-trips a pay URI', () => {
    const uri = buildSep0007PayUri({ destination: VALID_PUBKEY, amount: '1' });
    const parsed = parseSep0007Uri(uri);

    expect(parsed.operation).toBe('pay');
    expect(parsed.params.destination).toBe(VALID_PUBKEY);
  });

  it('rejects foreign schemes and unknown operations', () => {
    expect(() => parseSep0007Uri('https://example.com')).toThrow(Sep0007Error);
    expect(() => parseSep0007Uri('web+stellar:sign?xdr=AAAA')).toThrow(Sep0007Error);
    expect(() => parseSep0007Uri('web+stellar:tx?xdr=bad!!')).toThrow(Sep0007Error);
    expect(() => parseSep0007Uri(null)).toThrow(Sep0007Error);
  });
});

describe('parseSep0007Callback', () => {
  it('parses a successful callback with xdr', () => {
    const result = parseSep0007Callback(
      `${CALLBACK_PREFIX}status=success&xdr=${VALID_XDR}`
    );

    expect(result.status).toBe('success');
    expect(result.xdr).toBe(VALID_XDR);
  });

  it('accepts the tx alias for the signed envelope', () => {
    const result = parseSep0007Callback(`${CALLBACK_PREFIX}status=success&tx=${VALID_XDR}`);
    expect(result.xdr).toBe(VALID_XDR);
  });

  it('surfaces wallet errors', () => {
    const result = parseSep0007Callback(
      `${CALLBACK_PREFIX}status=error&error=User%20declined`
    );

    expect(result.status).toBe('error');
    expect(result.error).toBe('User declined');
  });

  it('rejects malformed callbacks', () => {
    expect(() => parseSep0007Callback(`${CALLBACK_PREFIX}status=success`)).toThrow(
      Sep0007Error
    );
    expect(() => parseSep0007Callback(`${CALLBACK_PREFIX}status=unknown`)).toThrow(
      Sep0007Error
    );
    expect(() => parseSep0007Callback('subtrackr://stellar/callback')).toThrow(
      Sep0007Error
    );
    expect(() => parseSep0007Callback(undefined)).toThrow(Sep0007Error);
  });
});

describe('openInWallet', () => {
  it('resolves true when a wallet handles the URI', async () => {
    await expect(openInWallet(`web+stellar:tx?xdr=${VALID_XDR}`)).resolves.toBe(true);
    expect(Linking.openURL).toHaveBeenCalledWith(`web+stellar:tx?xdr=${VALID_XDR}`);
  });

  it('resolves false when no wallet is installed', async () => {
    Linking.openURL.mockRejectedValue(new Error('No activity found'));

    await expect(openInWallet(`web+stellar:tx?xdr=${VALID_XDR}`)).resolves.toBe(false);
  });

  it('rejects non SEP-0007 URIs', async () => {
    await expect(openInWallet('https://example.com')).rejects.toThrow(Sep0007Error);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

describe('requestWalletSignature', () => {
  it('resolves with the signed XDR after the wallet redirects back', async () => {
    const pending = requestWalletSignature({ xdr: VALID_XDR, timeoutMs: 1000 });
    await flush();

    emitCallback(`${CALLBACK_PREFIX}status=success&xdr=${VALID_XDR}SIGNED`);

    const result = await pending;
    expect(result.status).toBe('opened');
    expect(result.signedXdr).toBe(`${VALID_XDR}SIGNED`);
    expect(result.uri).toContain('web+stellar:tx?');
  });

  it('falls back when no wallet can open the URI', async () => {
    Linking.openURL.mockRejectedValue(new Error('No activity found'));

    const result = await requestWalletSignature({ xdr: VALID_XDR });

    expect(result.status).toBe('fallback');
    expect(result.signedXdr).toBeUndefined();
    expect(result.reason).toContain('web+stellar');
  });

  it('falls back when the wallet never calls back', async () => {
    const result = await requestWalletSignature({ xdr: VALID_XDR, timeoutMs: 10 });

    expect(result.status).toBe('fallback');
    expect(result.reason).toContain('time');
  });

  it('falls back when the wallet reports an error', async () => {
    const pending = requestWalletSignature({ xdr: VALID_XDR, timeoutMs: 1000 });
    await flush();

    emitCallback(`${CALLBACK_PREFIX}status=error&error=Declined`);

    const result = await pending;
    expect(result.status).toBe('fallback');
  });
});

describe('waitForSep0007Callback', () => {
  it('resolves null for an unrelated URL', async () => {
    const pending = waitForSep0007Callback(1000);
    await flush();

    emitCallback('subtrackr://settings');

    await expect(pending).resolves.toBeNull();
  });

  it('resolves null on timeout', async () => {
    await expect(waitForSep0007Callback(10)).resolves.toBeNull();
  });
});

describe('cancelSep0007Wait', () => {
  it('resolves a pending wait with null', async () => {
    const pending = waitForSep0007Callback(5000);
    await flush();

    cancelSep0007Wait();

    await expect(pending).resolves.toBeNull();
  });
});

describe('submitSignedTransaction', () => {
  it('submits the signed envelope and returns the hash', async () => {
    const hash = await submitSignedTransaction(VALID_XDR);

    expect(hash).toBe('submitted-hash');
    expect(mockFromXDR).toHaveBeenCalledWith(
      VALID_XDR,
      expect.stringContaining('Test SDF Network')
    );
    expect(mockSubmitTransaction).toHaveBeenCalled();
  });

  it('rejects an invalid signed envelope before submitting', async () => {
    await expect(submitSignedTransaction('bad!!')).rejects.toThrow(Sep0007Error);
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it('wraps XDR parse failures', async () => {
    mockFromXDR.mockImplementation(() => {
      throw new Error('Unable to decode');
    });

    await expect(submitSignedTransaction(VALID_XDR)).rejects.toMatchObject({
      code: 'INVALID_SIGNED_XDR',
    });
  });

  it('surfaces submission failures', async () => {
    mockSubmitTransaction.mockRejectedValue(new Error('tx timeout'));

    await expect(submitSignedTransaction(VALID_XDR)).rejects.toMatchObject({
      code: 'SUBMIT_FAILED',
    });
  });

  it('rejects when the network returns no hash', async () => {
    mockSubmitTransaction.mockResolvedValue({});

    await expect(submitSignedTransaction(VALID_XDR)).rejects.toMatchObject({
      code: 'SUBMIT_FAILED',
    });
  });
});

describe('signViaDeepLink', () => {
  it('submits the signed envelope returned by the wallet', async () => {
    const pending = signViaDeepLink({ xdr: VALID_XDR, timeoutMs: 1000 });
    await flush();

    emitCallback(`${CALLBACK_PREFIX}status=success&xdr=${VALID_XDR}SIGNED`);

    await expect(pending).resolves.toBe('submitted-hash');
  });

  it('returns null when no wallet handles the deep link', async () => {
    Linking.openURL.mockRejectedValue(new Error('No activity found'));

    await expect(signViaDeepLink({ xdr: VALID_XDR })).resolves.toBeNull();
  });
});
