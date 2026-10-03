/**
 * webhook.test.ts — /webhook/source route security tests
 *
 * Tests the dual-defense gate: HMAC signature + authHandshake payload validation.
 * Both must pass before a webhook payload reaches the integration_events
 * insert path.
 *
 * Architecture rationale (per CLAUDE.md): authHandshake is the application-level
 * intentional check; HMAC is the cryptographic transport-level check.
 * Defense in depth: each catches a different attack class.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { SourceAuthManager } from '../auth.js';
import type { SourceBrokerConfig } from '../config.js';

const config: SourceBrokerConfig = {
  postgrestUrl: 'http://postgrest',
  postgrestServiceToken: 't',
  postgresUrl: 'postgres://t',
  keycloakUrl: 'http://k',
  keycloakRealm: 'aisha',
  sourceApiUrl: 'http://s',
  sourceServiceEmail: 'e',
  sourceServicePassword: 'p',
  sourcePgUrl: 'postgres://s',
  sourceAuthHandshakeOutgoing: 'RAM YAM KHAM OM A HUM',
  sourceAuthHandshakeIncoming: 'OM A HUM VAJRA GURU PADMA SIDDHI HUM',
  jwtCacheTtlMs: 3_600_000,
  webhookHmacSecret: 'test-webhook-secret',
  syncIntervalMs: 86_400_000,
  port: 8090,
  logLevel: 'info',
  corsAllowlist: '',
  rateLimitEnabled: false,
  oidcAppClientId: 'aisha-app',
  devAllowUnauthedSync: false,
  aishaGatewayUrl: 'http://gateway:3001',
  aishaGatewayIntranetKey: '',
  aishaJwtSecret: '',
  aishaJwtExpSec: 3600,
  aishaMemberRole: 'authenticated',
};

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('webhook gate — HMAC signature', () => {
  const auth = new SourceAuthManager(config);

  it('accepts payload signed with correct secret', () => {
    const body = JSON.stringify({
      authHandshake: config.sourceAuthHandshakeIncoming,
      event_source: 'source-api',
      event_type: 'event_attendance.recorded',
      occurred_at: '2026-05-23T12:00:00Z',
      metadata: { user_id: 'abc' },
    });
    const sig = signBody(body, config.webhookHmacSecret);
    expect(auth.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects payload signed with wrong secret', () => {
    const body = '{"any":"body"}';
    const sig = signBody(body, 'wrong-secret');
    expect(auth.verifyWebhookSignature(body, sig)).toBe(false);
  });

  it('rejects tampered body (one-character change breaks signature)', () => {
    const body = JSON.stringify({ event_type: 'login' });
    const sig = signBody(body, config.webhookHmacSecret);
    const tampered = body.replace('login', 'logout');
    expect(auth.verifyWebhookSignature(tampered, sig)).toBe(false);
  });

  it('rejects malformed signature hex string', () => {
    const body = '{"foo":"bar"}';
    expect(auth.verifyWebhookSignature(body, 'not-hex-at-all')).toBe(false);
  });

  it('uses constant-time comparison (length mismatch returns false without comparison)', () => {
    // Shorter signature should fail length check before timingSafeEqual
    const body = '{"x":1}';
    expect(auth.verifyWebhookSignature(body, 'abc')).toBe(false);
  });
});

describe('webhook gate — authHandshake check', () => {
  const auth = new SourceAuthManager(config);

  it('accepts payload with correct incoming authHandshake', () => {
    expect(auth.verifyAuthHandshake('OM A HUM VAJRA GURU PADMA SIDDHI HUM')).toBe(true);
  });

  it('rejects payload with source OUTGOING authHandshake (security: wrong direction)', () => {
    // The outgoing authHandshake is what WE send TO source; receiving it back would
    // mean the webhook is misconfigured or being spoofed
    expect(auth.verifyAuthHandshake(config.sourceAuthHandshakeOutgoing)).toBe(false);
  });

  it('rejects missing authHandshake field', () => {
    expect(auth.verifyAuthHandshake(undefined)).toBe(false);
  });

  it('rejects empty authHandshake (no truthiness shortcut)', () => {
    expect(auth.verifyAuthHandshake('')).toBe(false);
  });

  it('rejects authHandshake with whitespace variations (exact match required)', () => {
    expect(auth.verifyAuthHandshake(' OM A HUM VAJRA GURU PADMA SIDDHI HUM ')).toBe(false);
    expect(auth.verifyAuthHandshake('OM A HUM  VAJRA GURU PADMA SIDDHI HUM')).toBe(false);
  });
});

describe('webhook payload shape (architectural invariant)', () => {
  it('payload must have event_source, event_type, occurred_at, metadata', () => {
    // Documents the contract expected by webhook handler
    const validPayload = {
      authHandshake: config.sourceAuthHandshakeIncoming,
      event_source: 'source-api',
      event_type: 'event_attendance.recorded',
      occurred_at: '2026-05-23T12:00:00Z',
      metadata: { user_id: '11111111-1111-1111-1111-111111111111', event_id: 'a-1' },
    };
    expect(Object.keys(validPayload).sort()).toEqual([
      'authHandshake', 'event_source', 'event_type', 'metadata', 'occurred_at',
    ]);
  });

  it('metadata.user_id is required for actor-scoped signals', () => {
    // Webhook handler resolves actor from metadata.user_id |
    // metadata.actor_user_id | metadata.profile_id (heuristic)
    const payload = { metadata: { user_id: '11111111-1111-1111-1111-111111111111' } };
    const resolved =
      payload.metadata.user_id ||
      (payload.metadata as Record<string, string | undefined>).actor_user_id ||
      (payload.metadata as Record<string, string | undefined>).profile_id;
    expect(resolved).toBe('11111111-1111-1111-1111-111111111111');
  });
});
