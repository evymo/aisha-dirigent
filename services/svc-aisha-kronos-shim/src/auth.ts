/**
 * Auth pro svc-aisha-kronos-shim — Maestro posílá X-Api-Key header
 * (per Alquist convention v packages/insight/maestro/maestro/services/kronos.py).
 * Shim validuje proti config.kronosApiKey s constant-time compare
 * (XOR loop místo `!==`) aby nešel timing-attack na kronosApiKey.
 */
import { constantTimeStringCompare } from '@aisha/security';
import { config } from './config.js';

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function verifyKronosApiKey(headers: Record<string, string | string[] | undefined>): void {
  if (!config.kronosApiKey) {
    throw new AuthError(503, 'KRONOS_API_KEY není nakonfigurovaný — shim odmítá všechny calls.');
  }
  const raw = headers['x-api-key'] ?? headers['X-Api-Key'];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (!provided) {
    throw new AuthError(401, 'Missing X-Api-Key header');
  }
  if (!constantTimeStringCompare(provided, config.kronosApiKey)) {
    throw new AuthError(401, 'Invalid Kronos API key');
  }
}
