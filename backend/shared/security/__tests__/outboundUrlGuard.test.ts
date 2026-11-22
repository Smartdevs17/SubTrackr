/**
 * Tests for outboundUrlGuard — SSRF protection for server-side fetches.
 *
 * @see backend/shared/security/outboundUrlGuard.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1686
 */

import {
  OutboundUrlError,
  isPrivateHostname,
  validateOutboundUrl,
} from '../outboundUrlGuard';

describe('isPrivateHostname', () => {
  it('flags loopback and metadata hostnames', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('LOCALHOST')).toBe(true);
    expect(isPrivateHostname('metadata.google.internal')).toBe(true);
    expect(isPrivateHostname('instance-data')).toBe(true);
  });

  it('flags internal-looking suffixes', () => {
    expect(isPrivateHostname('db.local')).toBe(true);
    expect(isPrivateHostname('svc.internal')).toBe(true);
    expect(isPrivateHostname('api.localhost')).toBe(true);
  });

  it('flags loopback and RFC1918 IPv4 literals', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('10.1.2.3')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('0.0.0.0')).toBe(true);
    expect(isPrivateHostname('255.255.255.255')).toBe(true);
  });

  it('flags the cloud metadata address specifically', () => {
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
  });

  it('flags CGNAT space', () => {
    expect(isPrivateHostname('100.64.0.1')).toBe(true);
  });

  it('flags private IPv6 literals', () => {
    expect(isPrivateHostname('::1')).toBe(true);
    expect(isPrivateHostname('fd00::1')).toBe(true);
    expect(isPrivateHostname('fe80::1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 loopback', () => {
    expect(isPrivateHostname('::ffff:127.0.0.1')).toBe(true);
  });

  it('allows ordinary public hosts', () => {
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('hooks.zapier.com')).toBe(false);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
    expect(isPrivateHostname('172.15.0.1')).toBe(false);
  });

  it('treats a malformed dotted quad as unsafe', () => {
    expect(isPrivateHostname('999.1.1.1')).toBe(true);
    expect(isPrivateHostname('127.0.0')).toBe(true);
  });

  it('treats an empty host as unsafe', () => {
    expect(isPrivateHostname('')).toBe(true);
  });
});

describe('validateOutboundUrl', () => {
  it('accepts a normal public https URL', () => {
    // A real Zapier host, but deliberately *not* a `/hooks/catch/<n>/<n>/`
    // path: that shape is indistinguishable from a live Zapier hook URL and
    // trips secret detectors in CI (the assertion only needs "public host").
    const result = validateOutboundUrl('https://hooks.zapier.com/example-endpoint');
    expect(result.protocol).toBe('https:');
    expect(result.hostname).toBe('hooks.zapier.com');
  });

  it('accepts plain http', () => {
    expect(validateOutboundUrl('http://example.com/hook').protocol).toBe('http:');
  });

  it('rejects non-HTTP schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://example.com',
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/plain,hi',
    ]) {
      expect(() => validateOutboundUrl(url)).toThrow(OutboundUrlError);
    }
  });

  it('rejects relative or malformed values', () => {
    expect(() => validateOutboundUrl('/relative/path')).toThrow(OutboundUrlError);
    expect(() => validateOutboundUrl('not a url')).toThrow(OutboundUrlError);
    expect(() => validateOutboundUrl('')).toThrow(OutboundUrlError);
    expect(() => validateOutboundUrl(undefined)).toThrow(OutboundUrlError);
    expect(() => validateOutboundUrl(null)).toThrow(OutboundUrlError);
    expect(() => validateOutboundUrl(42)).toThrow(OutboundUrlError);
  });

  it('rejects loopback and private targets', () => {
    expect(() => validateOutboundUrl('http://localhost/hook')).toThrow(/non-public/);
    expect(() => validateOutboundUrl('http://127.0.0.1:8080/hook')).toThrow(/non-public/);
    expect(() => validateOutboundUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /non-public/
    );
    expect(() => validateOutboundUrl('http://10.0.0.5/admin')).toThrow(/non-public/);
  });

  it('rejects embedded credentials', () => {
    expect(() => validateOutboundUrl('https://user:pass@example.com/')).toThrow(
      /embedded credentials/
    );
  });

  it('enforces an allowlist when one is supplied', () => {
    expect(
      validateOutboundUrl('https://hooks.zapier.com/x', { allowedHosts: ['hooks.zapier.com'] })
        .hostname
    ).toBe('hooks.zapier.com');

    // Subdomains of an allowlisted host are permitted.
    expect(() =>
      validateOutboundUrl('https://eu.hooks.zapier.com/x', { allowedHosts: ['hooks.zapier.com'] })
    ).not.toThrow();

    expect(() =>
      validateOutboundUrl('https://evil.example.com/x', { allowedHosts: ['hooks.zapier.com'] })
    ).toThrow(/allowlist/);
  });

  it('does not treat a lookalike host as allowlisted', () => {
    expect(() =>
      validateOutboundUrl('https://hooks.zapier.com.evil.test/x', {
        allowedHosts: ['hooks.zapier.com'],
      })
    ).toThrow(/allowlist/);
  });

  it('still applies the private-address rules when an allowlist is present', () => {
    expect(() =>
      validateOutboundUrl('http://127.0.0.1/x', { allowedHosts: ['127.0.0.1'] })
    ).toThrow(OutboundUrlError);
  });
});