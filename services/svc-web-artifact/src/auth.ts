/**
 * svc-web-artifact auth — service-role token guard.
 *
 * Both protected routes (`/parse`, `/seed-default`) are called by trusted
 * automation (n8n workers + cold-start bootstrap + the in-process self-trigger),
 * not by user-facing UIs. So the guard is a constant-time-ish equality check
 * against POSTGREST_SERVICE_TOKEN — same pattern as svc-ai-chat's
 * `verifyServiceRole`. JWT verification via @aisha/security would add no
 * value here because there is no user identity to verify; the only thing
 * we need to confirm is "the caller knows the service token."
 *
 * The /health route stays anonymous (liveness probe).
 */
import { config } from './config.js';

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function verifyServiceRole(authHeader: string | undefined): void {
  if (!config.postgrestServiceToken) {
    // Boot-time misconfiguration — refuse to authorise anything rather than
    // silently accept all callers.
    throw new AuthError(503, 'service-role token not configured');
  }
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  if (authHeader.slice(7) !== config.postgrestServiceToken) {
    throw new AuthError(401, 'Invalid service-role token');
  }
}
