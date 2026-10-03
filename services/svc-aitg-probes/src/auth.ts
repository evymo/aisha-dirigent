/**
 * svc-aitg-probes auth — service-role only.
 *
 * Probes are admin / service-role operations (they read adversarial
 * corpus and write to audit_journal). User-level JWT auth is not
 * appropriate. Thin wrapper around @aisha/security's verifyServiceRole
 * so the canonical service-security gate detects the auth pattern.
 */

import { verifyServiceRole, AuthError } from '@aisha/security';
import { config } from './config.js';

export { AuthError };

/**
 * Verify the inbound Authorization header carries the orchestrator
 * service-role token. Throws AuthError on any mismatch.
 */
export function verifyToken(authHeader: string | undefined): void {
  verifyServiceRole(authHeader, config.postgrestServiceToken);
}
