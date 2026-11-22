import KeyStore from '../../backend/shared/webhook/keyStore';
import SignatureService from '../../backend/shared/webhook/SignatureService';

describe('SignatureService', () => {
  const initialKey = 'test-secret-1';
  let ks: KeyStore;
  let svc: SignatureService;

  beforeEach(() => {
    ks = new KeyStore(initialKey);
    svc = new SignatureService(ks, { timestampTolerance: 300, clockSkewTolerance: 30, nonceTtl: 2 });
  });

  test('generates and verifies a signature', async () => {
    const body = JSON.stringify({ hi: 'there' });
    const { header } = svc.generate(body);
    await expect(svc.verify(body, header)).resolves.toBe(true);
  });

  test('rejects replayed nonce', async () => {
    const body = 'payload';
    const { header } = svc.generate(body, undefined, undefined, 'fixednonce');
    await expect(svc.verify(body, header)).resolves.toBe(true);
    await expect(svc.verify(body, header)).rejects.toThrow(/replay/);
  });

  test('rejects old timestamp beyond tolerance', async () => {
    const body = 'payload';
    const oldTs = Math.floor(Date.now() / 1000) - 10000; // far in past
    const { header } = svc.generate(body, undefined, oldTs, 'nonce2');
    await expect(svc.verify(body, header)).rejects.toThrow(/timestamp/);
  });

  test('accepts signature with rotated previous key', async () => {
    const body = 'payload2';
    // sign with current key
    const s1 = svc.generate(body);
    // rotate keys
    ks.rotate('new-key');
    // previous key (initial) should still verify
    await expect(svc.verify(body, s1.header)).resolves.toBe(true);
  });
});
