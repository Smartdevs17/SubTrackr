import crypto from 'crypto';
import KeyStore from './keyStore';
import NonceCache from '../cache/nonceCache';

export interface SignatureOptions {
  timestampTolerance?: number; // seconds
  clockSkewTolerance?: number; // seconds
  nonceTtl?: number; // seconds
}

export default class SignatureService {
  private keys: KeyStore;
  private nonceCache: NonceCache;
  private opts: Required<SignatureOptions>;

  constructor(keyStore: KeyStore, opts?: SignatureOptions) {
    this.keys = keyStore;
    this.nonceCache = new NonceCache();
    this.opts = {
      timestampTolerance: opts?.timestampTolerance ?? 300,
      clockSkewTolerance: opts?.clockSkewTolerance ?? 30,
      nonceTtl: opts?.nonceTtl ?? 600,
    };
  }

  generate(body: string, secret?: string, timestamp?: number, nonce?: string) {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const n = nonce ?? crypto.randomBytes(12).toString('hex');
    const key = secret ?? this.keys.getCurrent();
    const hmac = crypto.createHmac('sha256', key).update(`${ts}.${body}`).digest();
    const sig = hmac.toString('base64');
    const header = `t=${ts},s=${sig},v=1,n=${n}`;
    return { header, sig, ts, nonce: n };
  }

  parseHeader(header: string) {
    const parts = header.split(',').map(p => p.trim());
    const map: Record<string, string> = {};
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k && v) map[k] = v;
    }
    return map;
  }

  async verify(rawBody: string, header: string) {
    if (!header) throw new Error('missing signature header');
    const parsed = this.parseHeader(header);
    const ts = parseInt(parsed.t, 10);
    const sig = parsed.s;
    const ver = parsed.v;
    const nonce = parsed.n;
    if (!ts || !sig || !ver || !nonce) throw new Error('invalid signature header');
    if (ver !== '1') throw new Error('unsupported signature version');

    const now = Math.floor(Date.now() / 1000);
    const allowed = this.opts.timestampTolerance + this.opts.clockSkewTolerance;
    if (Math.abs(now - ts) > allowed) throw new Error('timestamp outside tolerance');

    // nonce replay check
    if (await this.nonceCache.has(nonce)) {
      throw new Error('replay detected');
    }

    // compute hmac against active keys
    const keys = this.keys.getActiveKeys();
    let match = false;
    for (const k of keys) {
      const h = crypto.createHmac('sha256', k).update(`${ts}.${rawBody}`).digest().toString('base64');
      if (h === sig) {
        match = true;
        break;
      }
    }
    if (!match) throw new Error('signature mismatch');

    // store nonce
    await this.nonceCache.set(nonce, this.opts.nonceTtl);
    return true;
  }
}
