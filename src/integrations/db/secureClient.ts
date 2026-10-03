import { createApiClient, gatewayUrl, isUsingDevFallback } from '@/integrations/api/client';
import { oidcConfig } from '@/integrations/auth/oidc-config';
import { httpFetch } from '@/lib/net/httpFetch';
import { safeError } from '@/lib/security/safeLogger';

import type { ApiClient } from '@/integrations/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a PHI authentication attempt. */
export interface PhiAuthResult {
  /** Whether authentication succeeded. */
  ok: boolean;
  /** The KC access token for PHI operations (if ok). */
  accessToken?: string;
  /** Human-readable error message (if !ok). */
  message?: string;
}

// ---------------------------------------------------------------------------
// KC Direct Grant — password re-authentication
// ---------------------------------------------------------------------------

/**
 * Verify user password via KC Resource Owner Password Credentials grant.
 *
 * Used for PHI mode step-up authentication: the user re-enters their password
 * to obtain a separate short-lived access token for sensitive data operations.
 *
 * @param email - User email.
 * @param password - User password.
 * @returns PhiAuthResult with access token on success.
 */
export async function phiVerifyPassword(email: string, password: string): Promise<PhiAuthResult> {
  try {
    const tokenUrl = `${oidcConfig.authority}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: oidcConfig.clientId,
      username: email,
      password,
      scope: 'openid',
    });

    const response = await httpFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, message: 'Authentication failed.' };
    }

    const data = await response.json() as { access_token?: string };
    if (!data.access_token) {
      return { ok: false, message: 'Authentication failed.' };
    }

    return { ok: true, accessToken: data.access_token };
  } catch (err) {
    safeError('phi.verifyPassword.failed', err);
    return { ok: false, message: 'Authentication failed.' };
  }
}

// ---------------------------------------------------------------------------
// OTP — gateway endpoint for email OTP
// ---------------------------------------------------------------------------

/**
 * Request an email OTP for PHI mode entry.
 *
 * Calls the gateway `/auth/v1/phi/request-otp` endpoint which sends
 * a verification code to the user's email.
 *
 * @param email - User email.
 * @param templateData - Optional email template data (brand, lang).
 * @returns PhiAuthResult (ok only indicates OTP was sent).
 */
export async function phiRequestOtp(
  email: string,
  templateData?: Record<string, unknown>,
): Promise<PhiAuthResult> {
  try {
    const response = await httpFetch(`${gatewayUrl}/auth/v1/phi/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ...templateData }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.json().catch((e: unknown) => {
        safeError('phi.requestOtp.parseError', e);
        return {};
      }) as Record<string, unknown>;
      const message = typeof body.message === 'string' ? body.message : 'OTP request failed.';
      return { ok: false, message };
    }

    return { ok: true };
  } catch (err) {
    safeError('phi.requestOtp.failed', err);
    return { ok: false, message: 'OTP request failed.' };
  }
}

/**
 * Verify an email OTP for PHI mode entry.
 *
 * Calls the gateway `/auth/v1/phi/verify-otp` endpoint which validates
 * the code and returns a short-lived PHI access token.
 *
 * @param email - User email.
 * @param token - The OTP code entered by the user.
 * @returns PhiAuthResult with access token on success.
 */
export async function phiVerifyOtp(email: string, token: string): Promise<PhiAuthResult> {
  try {
    const response = await httpFetch(`${gatewayUrl}/auth/v1/phi/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, message: 'Verification failed.' };
    }

    const data = await response.json() as { access_token?: string };
    if (!data.access_token) {
      return { ok: false, message: 'Verification failed.' };
    }

    return { ok: true, accessToken: data.access_token };
  } catch (err) {
    safeError('phi.verifyOtp.failed', err);
    return { ok: false, message: 'Verification failed.' };
  }
}

// ---------------------------------------------------------------------------
// Secure API client factory
// ---------------------------------------------------------------------------

/**
 * Creates a PHI-mode API client that uses a fixed access token.
 *
 * The returned client has the same `.rpc()` interface as the default `api` /
 * `aisha` shim, but injects the provided PHI token instead of the standard
 * Keycloak access token. This ensures sensitive data operations are traced
 * to the re-authenticated session.
 *
 * Throws if running on dev fallback backend — secure mode is only allowed on
 * properly configured production/staging backends.
 *
 * @param accessToken - The PHI access token obtained from phiVerifyPassword/phiVerifyOtp.
 * @returns An ApiClient for PHI data operations.
 */
export function createPhiApiClient(accessToken: string): ApiClient {
  if (isUsingDevFallback) {
    throw new Error(
      'secure mode is not available: API client is using dev fallback backend. ' +
      'Set VITE_API_URL (or VITE_AISHA_GATEWAY_URL) environment variables.'
    );
  }

  return createApiClient(async () => accessToken);
}

/**
 * @deprecated Use `createPhiApiClient` instead. This alias exists for backward
 * compatibility during the v2 migration.
 */
export function createLegacyPhiClient(): ApiClient {
  // Legacy alias — no longer constructs a supabase-js client. Callers that
  // used the returned client for `.rpc()` continue to work since ApiClient
  // exposes the same method surface. Callers relying on `.auth.*` or other
  // removed APIs will hit runtime errors and must migrate.
  if (isUsingDevFallback) {
    throw new Error(
      'secure mode is not available: API client is using dev fallback backend. ' +
      'Set VITE_API_URL (or VITE_AISHA_GATEWAY_URL) environment variables.'
    );
  }
  return createApiClient(async () => null);
}
