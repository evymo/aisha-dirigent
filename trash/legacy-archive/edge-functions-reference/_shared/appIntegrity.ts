/**
 * App Integrity Helper for Edge Functions
 *
 * Provides utilities for verifying mobile app integrity tokens.
 * Can be used as middleware in other Edge Functions.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export interface IntegrityVerificationResult {
  valid: boolean;
  platform: 'android' | 'ios';
  verdict?: {
    deviceIntegrity: string[];
    appIntegrity: string;
    accountLicensing: string;
  };
  error?: string;
}

/**
 * Verify app integrity token by calling the verify-app-integrity function.
 *
 * @param token - The integrity token from the mobile app
 * @param platform - 'android' or 'ios'
 * @returns Verification result
 */
export async function verifyAppIntegrity(
  token: string,
  platform: 'android' | 'ios',
  options?: {
    challenge?: string;
    keyId?: string;
    appId?: string;
  },
): Promise<IntegrityVerificationResult> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-app-integrity`, {
        signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        token,
        platform,
        challenge: options?.challenge,
        keyId: options?.keyId,
        appId: options?.appId,
      }),
    });

    if (!response.ok) {
      return { valid: false, platform, error: `HTTP ${response.status}` };
    }
    return await response.json();
  } catch (error) {
    return {
      valid: false,
      platform,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Extract integrity token and platform from request headers.
 *
 * Expected headers:
 * - X-Integrity-Token: The token from App Integrity
 * - X-Platform: 'android' or 'ios'
 *
 * @param req - The incoming request
 * @returns Token and platform, or null if not present
 */
export function extractIntegrityHeaders(
  req: Request
): { token: string; platform: 'android' | 'ios'; challenge?: string; keyId?: string; appId?: string } | null {
  const token = req.headers.get('X-Integrity-Token');
  const platform = req.headers.get('X-Platform') as 'android' | 'ios' | null;
  const challenge = req.headers.get('X-Integrity-Challenge') ?? undefined;
  const keyId = req.headers.get('X-Integrity-Key-Id') ?? undefined;
  const appId = req.headers.get('X-App-Id') ?? undefined;

  if (!token || !platform || !['android', 'ios'].includes(platform)) {
    return null;
  }

  return { token, platform, challenge, keyId, appId };
}

/**
 * Middleware to require valid app integrity for a request.
 *
 * @param req - The incoming request
 * @param options - Optional configuration
 * @returns Verification result, or null if headers are missing
 */
export async function requireAppIntegrity(
  req: Request,
  options?: {
    /** Allow requests without integrity headers (e.g., for web) */
    allowMissing?: boolean;
    /** Minimum device integrity level for Android */
    minDeviceIntegrity?: string[];
  }
): Promise<IntegrityVerificationResult | null> {
  const headers = extractIntegrityHeaders(req);

  if (!headers) {
    if (options?.allowMissing) {
      return null;
    }
    return {
      valid: false,
      platform: 'android',
      error: 'Missing integrity headers',
    };
  }

  const result = await verifyAppIntegrity(headers.token, headers.platform, {
    challenge: headers.challenge,
    keyId: headers.keyId,
    appId: headers.appId,
  });

  // Additional checks for Android
  if (
    result.valid &&
    headers.platform === 'android' &&
    options?.minDeviceIntegrity
  ) {
    const deviceVerdict = result.verdict?.deviceIntegrity || [];
    const hasRequired = options.minDeviceIntegrity.every((level) =>
      deviceVerdict.includes(level)
    );
    if (!hasRequired) {
      return {
        ...result,
        valid: false,
        error: 'Device integrity level too low',
      };
    }
  }

  return result;
}

/**
 * Check if request is from a verified mobile app.
 * Returns true for valid mobile requests, or if integrity is not required.
 *
 * @param req - The incoming request
 * @param options - Configuration options
 */
export async function isVerifiedMobileRequest(
  req: Request,
  options?: {
    /** Require integrity verification (default: false for gradual rollout) */
    required?: boolean;
  }
): Promise<boolean> {
  const headers = extractIntegrityHeaders(req);

  // No integrity headers - allowed if not required
  if (!headers) {
    return !options?.required;
  }

  const result = await verifyAppIntegrity(headers.token, headers.platform, {
    challenge: headers.challenge,
    keyId: headers.keyId,
    appId: headers.appId,
  });
  return result.valid;
}
