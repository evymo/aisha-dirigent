import { config } from './config.js';

/** Base64url encode */
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sign HMAC-SHA256 JWT for LiveKit */
export async function signLivekitJwt(
  payload: Record<string, unknown>,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = enc.encode(`${headerB64}.${payloadB64}`);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(config.livekitApiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const sigB64 = base64url(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

/** Create LiveKit access token for a user joining a room */
export async function createRoomAccessToken(opts: {
  identity: string;
  name: string;
  roomName: string;
  canPublish: boolean;
  canSubscribe: boolean;
  roomType: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signLivekitJwt({
    iss: config.livekitApiKey,
    sub: opts.identity,
    name: opts.name,
    nbf: now,
    exp: now + 3600,
    iat: now,
    jti: crypto.randomUUID(),
    video: {
      room: opts.roomName,
      roomJoin: true,
      canPublish: opts.canPublish,
      canSubscribe: opts.canSubscribe,
      canPublishData: true,
    },
    metadata: JSON.stringify({ userId: opts.identity, roomType: opts.roomType }),
  });
}

/** Create LiveKit Egress API token for recording */
export async function createEgressApiToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signLivekitJwt({
    iss: config.livekitApiKey,
    sub: config.livekitApiKey,
    iat: now,
    exp: now + 600,
    video: { roomRecord: true },
  });
}
