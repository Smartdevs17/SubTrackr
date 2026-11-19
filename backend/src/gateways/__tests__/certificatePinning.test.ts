import { describe, it, expect, vi } from 'vitest';
import type { TLSSocket } from 'node:tls';
import {
  verifyPins,
  createPinnedAgent,
  buildPinnedAgents,
  type ProviderPinMap,
} from '../certificatePinning';

function makeSocket(hashes: string[]): TLSSocket {
  let idx = 0;
  const makeCert = (): object => {
    const hash = hashes[idx++];
    const cert: Record<string, unknown> = {
      pubkey: Buffer.from(hash ?? 'unknown', 'base64'),
      raw: Buffer.from('dummy'),
    };
    // Simulate chain end when we've exhausted hashes
    if (idx < hashes.length) {
      cert.issuerCertificate = makeCert();
    } else {
      cert.issuerCertificate = cert; // self-signed / root
    }
    return cert;
  };
  return { getPeerCertificate: () => makeCert() } as unknown as TLSSocket;
}

describe('verifyPins', () => {
  const pins: ProviderPinMap = {
    'api.example.com': { hashes: ['aGVsbG8=', 'd29ybGQ='] },
  };

  it('passes when the leaf certificate hash is in the pin-set', () => {
    // Build a socket whose leaf cert hashes to 'aGVsbG8='
    const socket = makeSocket(['aGVsbG8=']);
    expect(() => verifyPins(socket, 'api.example.com', pins)).not.toThrow();
  });

  it('passes when an intermediate certificate hash is in the pin-set', () => {
    const socket = makeSocket(['bm90aGVyZQ==', 'd29ybGQ=']);
    expect(() => verifyPins(socket, 'api.example.com', pins)).not.toThrow();
  });

  it('throws when no certificate in the chain matches', () => {
    const socket = makeSocket(['dW5rbm93bg==']);
    expect(() => verifyPins(socket, 'api.example.com', pins)).toThrow(
      'Certificate pin failure',
    );
  });

  it('skips verification for hosts with no registered pins', () => {
    const socket = makeSocket(['dW5rbm93bg==']);
    expect(() => verifyPins(socket, 'unpinned.example.com', pins)).not.toThrow();
  });

  it('logs but does not throw when reportOnly is set', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reportOnlyPins: ProviderPinMap = {
      'api.example.com': { hashes: ['d29ybGQ='], reportOnly: true },
    };
    const socket = makeSocket(['dW5rbm93bg==']);
    expect(() => verifyPins(socket, 'api.example.com', reportOnlyPins)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('PIN-REPORT-ONLY'));
    spy.mockRestore();
  });
});

describe('createPinnedAgent', () => {
  it('returns an https.Agent instance', () => {
    const agent = createPinnedAgent('api.example.com', {
      'api.example.com': { hashes: ['aGVsbG8='] },
    });
    expect(agent).toBeDefined();
    expect(typeof agent.destroy).toBe('function');
  });
});

describe('buildPinnedAgents', () => {
  it('creates an agent for every pin map entry', () => {
    const pinMap: ProviderPinMap = {
      'a.example.com': { hashes: ['aGVsbG8='] },
      'b.example.com': { hashes: ['d29ybGQ='] },
    };
    const agents = buildPinnedAgents(pinMap);
    expect(Object.keys(agents)).toEqual(['a.example.com', 'b.example.com']);
  });
});
