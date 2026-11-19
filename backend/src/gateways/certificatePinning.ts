/**
 * backend/src/gateways/certificatePinning.ts
 *
 * SPKI certificate pinning for all provider API URLs.
 *
 * Each outbound HTTPS request to a third-party provider is verified against a
 * set of pre-registered Subject Public Key Info (SPKI) SHA-256 hashes.  If the
 * server presents a certificate whose SPKI hash is not in the pin-set, the
 * connection is aborted before any application data is exchanged.
 *
 * Usage — wrap the native `https` agent used by fetch / axios / got:
 *
 *   import { createPinnedAgent, PROVIDER_PINS } from './certificatePinning';
 *   const agent = createPinnedAgent(PROVIDER_PINS['stripe.com']);
 *   await fetch('https://api.stripe.com/v1/charges', { agent });
 *
 * Pin management:
 *   Run `npx ts-node backend/src/gateways/scripts/extract-spki.ts <hostname>`
 *   to obtain the current certificate's SPKI hash. Always include at least TWO
 *   pins per provider (the active leaf/intermediate and an emergency backup)
 *   before deploying to prevent accidental lock-out on certificate rotation.
 */

import https from 'node:https';
import crypto from 'node:crypto';
import tls from 'node:tls';
import type { TLSSocket } from 'node:tls';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PinSet {
  /** SHA-256 SPKI hashes, base64-encoded (from `openssl x509 -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`). */
  hashes: ReadonlyArray<string>;
  /** Report-only: log pin failures but do not abort the connection. Use only during pin rotation burn-in. */
  reportOnly?: boolean;
}

export type ProviderPinMap = Record<string, PinSet>;

// ── Built-in provider pins ────────────────────────────────────────────────────

/**
 * Registered SPKI pins keyed by hostname (no port, no path).
 *
 * To rotate a pin:
 *   1. Add the new hash alongside the old one.
 *   2. Deploy and monitor for pin-failure alerts (LOG_PIN_FAILURE=true).
 *   3. Once the old certificate expires and the new one is fully deployed,
 *      remove the old hash.
 */
export const PROVIDER_PINS: ProviderPinMap = {
  'api.stripe.com': {
    hashes: [
      process.env.PIN_STRIPE_PRIMARY ?? '',
      process.env.PIN_STRIPE_BACKUP ?? '',
    ].filter(Boolean),
  },
  'api.paypal.com': {
    hashes: [
      process.env.PIN_PAYPAL_PRIMARY ?? '',
      process.env.PIN_PAYPAL_BACKUP ?? '',
    ].filter(Boolean),
  },
  'hooks.slack.com': {
    hashes: [
      process.env.PIN_SLACK_PRIMARY ?? '',
      process.env.PIN_SLACK_BACKUP ?? '',
    ].filter(Boolean),
  },
};

// ── SPKI hash extraction ──────────────────────────────────────────────────────

/**
 * Extract the SHA-256 SPKI hash from a TLS certificate (DER-encoded public key).
 * Matches the Chrome / Firefox / RFC 7469 format used for HTTP Public Key Pinning.
 */
export function spkiHashFromCert(cert: tls.PeerCertificate): string {
  const pubkeyDer = (cert as unknown as { pubkey?: Buffer }).pubkey;
  if (!pubkeyDer) {
    throw new Error('TLS certificate has no pubkey field — Node.js >= 15 required');
  }
  return crypto.createHash('sha256').update(pubkeyDer).digest('base64');
}

// ── Pin verification ──────────────────────────────────────────────────────────

/**
 * Verify that at least one certificate in the presented chain matches a
 * registered SPKI hash.
 *
 * @throws Error when no pin matches and `reportOnly` is false.
 */
export function verifyPins(
  socket: TLSSocket,
  hostname: string,
  pinMap: ProviderPinMap,
): void {
  const pinSet = pinMap[hostname];
  if (!pinSet || pinSet.hashes.length === 0) return; // No pins registered — skip

  let cert = socket.getPeerCertificate(true);
  const checked: string[] = [];

  // Walk the certificate chain (leaf → root)
  while (cert && cert.raw) {
    let hash: string;
    try {
      hash = spkiHashFromCert(cert);
    } catch {
      break;
    }
    checked.push(hash);
    if (pinSet.hashes.includes(hash)) return; // Pin matched

    const issuer = cert.issuerCertificate;
    if (!issuer || issuer === cert) break;
    cert = issuer;
  }

  const message =
    `Certificate pin failure for ${hostname}: ` +
    `presented hashes [${checked.join(', ')}] not in pin-set [${pinSet.hashes.join(', ')}]`;

  if (pinSet.reportOnly) {
    console.error(`[PIN-REPORT-ONLY] ${message}`);
    return;
  }

  throw new Error(message);
}

// ── Pinned HTTPS agent factory ────────────────────────────────────────────────

/**
 * Create a Node.js `https.Agent` that enforces SPKI pinning for the given
 * hostname using the provided `pinMap`.
 *
 * Pass the returned agent to `fetch`, `axios`, or any other HTTP client that
 * accepts a `httpAgent` / `agent` option.
 */
export function createPinnedAgent(
  hostname: string,
  pinMap: ProviderPinMap = PROVIDER_PINS,
  agentOptions: https.AgentOptions = {},
): https.Agent {
  return new https.Agent({
    ...agentOptions,
    checkServerIdentity(host, cert) {
      // Let Node.js perform its standard hostname / SAN check first
      const standardError = tls.checkServerIdentity(host, cert);
      if (standardError) throw standardError;

      // Then verify the SPKI pin
      // `cert` from checkServerIdentity is already a tls.PeerCertificate
      const pinSet = pinMap[hostname];
      if (!pinSet || pinSet.hashes.length === 0) return undefined;

      const hash = crypto
        .createHash('sha256')
        .update((cert as unknown as { pubkey: Buffer }).pubkey)
        .digest('base64');

      if (!pinSet.hashes.includes(hash)) {
        const message =
          `Certificate pin failure for ${hostname}: ` +
          `presented SPKI hash ${hash} not in pin-set`;
        if (pinSet.reportOnly) {
          console.error(`[PIN-REPORT-ONLY] ${message}`);
          return undefined;
        }
        return new Error(message);
      }
      return undefined;
    },
  });
}

/**
 * Build a map of hostname → pinned agent for all entries in `PROVIDER_PINS`.
 * Useful for pre-creating agents at startup rather than per-request.
 */
export function buildPinnedAgents(
  pinMap: ProviderPinMap = PROVIDER_PINS,
): Record<string, https.Agent> {
  return Object.fromEntries(
    Object.keys(pinMap).map((hostname) => [
      hostname,
      createPinnedAgent(hostname, pinMap),
    ]),
  );
}
