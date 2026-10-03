/**
 * Unit tests for svc-livekit/livekit-jwt.ts — HMAC-SHA256 JWT signing.
 *
 * LiveKit room access tokens are HS256 JWTs signed with `livekitApiSecret`.
 * If we sign with a weak secret or wrong algorithm, anyone with the
 * resulting token can join any room. We lock in:
 *   1. Header is exactly `{ alg: 'HS256', typ: 'JWT' }` (no alg=none drift)
 *   2. Signature is HMAC-SHA256 over `header.payload` bytes
 *   3. Output is `header.payload.signature` in base64url (no padding)
 *   4. createRoomAccessToken includes iss, sub, video.room, exp = now+3600
 *   5. createEgressApiToken has video.roomRecord = true + exp = now+600
 *   6. `jti` is fresh per token (no jti reuse — replay-resistant)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../config.js', () => ({
  config: {
    livekitApiKey: 'API-KEY-test',
    livekitApiSecret: 'super-secret-livekit-key-1234567890',
  },
}));

function base64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; sig: string } {
  const [h, p, sig] = token.split('.');
  return {
    header: JSON.parse(base64urlDecode(h).toString('utf-8')),
    payload: JSON.parse(base64urlDecode(p).toString('utf-8')),
    sig,
  };
}

function expectedHmac(header: string, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('signLivekitJwt — output structure', () => {
  it('produces a three-part dot-separated JWT', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t = await signLivekitJwt({ foo: 'bar' });
    expect(t.split('.').length).toBe(3);
  });

  it('header is exactly { alg: HS256, typ: JWT } (no alg=none drift)', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t = await signLivekitJwt({ foo: 'bar' });
    const { header } = decodeJwt(t);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('payload is round-trippable JSON of the input', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t = await signLivekitJwt({ foo: 'bar', n: 42, arr: [1, 2, 3] });
    const { payload } = decodeJwt(t);
    expect(payload).toEqual({ foo: 'bar', n: 42, arr: [1, 2, 3] });
  });

  it('signature is HMAC-SHA256 of `header.payload` bytes using livekitApiSecret', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t = await signLivekitJwt({ foo: 'bar' });
    const [h, p, sig] = t.split('.');
    expect(sig).toBe(expectedHmac(h, p, 'super-secret-livekit-key-1234567890'));
  });

  it('signature is base64url (no `+`, no `/`, no `=` padding)', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t = await signLivekitJwt({ foo: 'bar' });
    const [, , sig] = t.split('.');
    expect(sig).not.toContain('+');
    expect(sig).not.toContain('/');
    expect(sig).not.toContain('=');
  });

  it('different payload → different signature (no fixed signature regression)', async () => {
    const { signLivekitJwt } = await import('../livekit-jwt.js');
    const t1 = await signLivekitJwt({ foo: 'bar' });
    const t2 = await signLivekitJwt({ foo: 'baz' });
    const sig1 = t1.split('.')[2];
    const sig2 = t2.split('.')[2];
    expect(sig1).not.toBe(sig2);
  });
});

describe('createRoomAccessToken', () => {
  beforeEach(() => {
    // Freeze time so iat/exp are predictable
    vi.useFakeTimers().setSystemTime(new Date('2026-05-17T12:00:00Z'));
  });

  it('returns token with correct iss, sub, video.room, video.roomJoin', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t = await createRoomAccessToken({
      identity: 'user-uuid-1',
      name: 'Alice',
      roomName: 'room-42',
      canPublish: true,
      canSubscribe: true,
      roomType: 'voice',
    });
    const { payload } = decodeJwt(t);
    expect(payload.iss).toBe('API-KEY-test');
    expect(payload.sub).toBe('user-uuid-1');
    expect(payload.name).toBe('Alice');
    expect(payload.video).toMatchObject({
      room: 'room-42',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
  });

  it('exp is iat + 3600 (1 hour) — token doesn\'t live longer than a single call session', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t = await createRoomAccessToken({
      identity: 'u', name: 'n', roomName: 'r', canPublish: true, canSubscribe: true, roomType: 'voice',
    });
    const { payload } = decodeJwt(t);
    expect(payload.exp).toBe(((payload.iat as number) + 3600));
  });

  it('nbf == iat (no future-dated tokens)', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t = await createRoomAccessToken({
      identity: 'u', name: 'n', roomName: 'r', canPublish: true, canSubscribe: true, roomType: 'voice',
    });
    const { payload } = decodeJwt(t);
    expect(payload.nbf).toBe(payload.iat);
  });

  it('jti is fresh per call (no token replay)', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t1 = await createRoomAccessToken({
      identity: 'u', name: 'n', roomName: 'r', canPublish: true, canSubscribe: true, roomType: 'voice',
    });
    const t2 = await createRoomAccessToken({
      identity: 'u', name: 'n', roomName: 'r', canPublish: true, canSubscribe: true, roomType: 'voice',
    });
    const p1 = decodeJwt(t1).payload;
    const p2 = decodeJwt(t2).payload;
    expect(p1.jti).not.toBe(p2.jti);
    expect(typeof p1.jti).toBe('string');
  });

  it('respects canPublish=false / canSubscribe=false (privilege restriction)', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t = await createRoomAccessToken({
      identity: 'u', name: 'n', roomName: 'r', canPublish: false, canSubscribe: false, roomType: 'voice',
    });
    const { payload } = decodeJwt(t);
    expect((payload.video as { canPublish: boolean }).canPublish).toBe(false);
    expect((payload.video as { canSubscribe: boolean }).canSubscribe).toBe(false);
  });

  it('metadata includes userId + roomType (for downstream LiveKit hooks)', async () => {
    const { createRoomAccessToken } = await import('../livekit-jwt.js');
    const t = await createRoomAccessToken({
      identity: 'u-1', name: 'n', roomName: 'r', canPublish: true, canSubscribe: true, roomType: 'consultation',
    });
    const { payload } = decodeJwt(t);
    expect(JSON.parse(payload.metadata as string)).toEqual({
      userId: 'u-1',
      roomType: 'consultation',
    });
  });
});

describe('createEgressApiToken', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-17T12:00:00Z'));
  });

  it('has video.roomRecord = true (recording-only privilege)', async () => {
    const { createEgressApiToken } = await import('../livekit-jwt.js');
    const t = await createEgressApiToken();
    const { payload } = decodeJwt(t);
    expect((payload.video as { roomRecord: boolean }).roomRecord).toBe(true);
  });

  it('does NOT grant roomJoin / canPublish (only recording)', async () => {
    const { createEgressApiToken } = await import('../livekit-jwt.js');
    const t = await createEgressApiToken();
    const { payload } = decodeJwt(t);
    const video = payload.video as Record<string, unknown>;
    expect(video.roomJoin).toBeUndefined();
    expect(video.canPublish).toBeUndefined();
  });

  it('exp is iat + 600 (10 min — short-lived per LiveKit recommendation)', async () => {
    const { createEgressApiToken } = await import('../livekit-jwt.js');
    const t = await createEgressApiToken();
    const { payload } = decodeJwt(t);
    expect(payload.exp).toBe(((payload.iat as number) + 600));
  });

  it('iss == sub == livekitApiKey (server-to-server auth pattern)', async () => {
    const { createEgressApiToken } = await import('../livekit-jwt.js');
    const t = await createEgressApiToken();
    const { payload } = decodeJwt(t);
    expect(payload.iss).toBe('API-KEY-test');
    expect(payload.sub).toBe('API-KEY-test');
  });
});
