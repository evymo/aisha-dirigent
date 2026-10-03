/**
 * Edge Function: Verify App Integrity
 *
 * Verifies mobile app integrity tokens from:
 * - Android: Google Play Integrity API
 * - iOS: Apple App Attest API
 *
 * This function should be called from other Edge Functions to verify
 * that requests are coming from legitimate app instances.
 *
 * Environment variables required:
 * - GOOGLE_CLOUD_PROJECT_NUMBER: For Android Play Integrity
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON: Service account for Google API
 * - APPLE_APP_ID: For iOS App Attest (e.g., "TEAMID.com.example.app")
 * - APPLE_APP_ATTEST_VERIFY_URL: Optional external verifier endpoint (recommended for production)
 * - APPLE_APP_ATTEST_VERIFY_API_KEY: Optional bearer token for external verifier
 * - APPLE_APP_ATTEST_ALLOW_FORMAT_ONLY: Optional local fallback for non-production environments
 */

import { serve } from '../_shared/deps.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-integrity-token, x-platform, x-integrity-challenge, x-integrity-key-id, x-app-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PlayIntegrityResponse {
  tokenPayloadExternal?: {
    accountDetails?: {
      appLicensingVerdict?: string;
    };
    appIntegrity?: {
      appRecognitionVerdict?: string;
      packageName?: string;
      certificateSha256Digest?: string[];
      versionCode?: string;
    };
    deviceIntegrity?: {
      deviceRecognitionVerdict?: string[];
    };
    requestDetails?: {
      nonce?: string;
      requestPackageName?: string;
      timestampMillis?: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

interface VerificationResult {
  valid: boolean;
  platform: 'android' | 'ios';
  verdict?: {
    deviceIntegrity: string[];
    appIntegrity: string;
    accountLicensing: string;
  };
  error?: string;
}

interface IOSVerificationOptions {
  appId?: string;
  challenge?: string;
  keyId?: string;
}

interface IOSVerifierResponse {
  valid: boolean;
  verdict?: {
    deviceIntegrity?: string[];
    appIntegrity?: string;
    accountLicensing?: string;
  };
  error?: string;
}

function toBase64UrlFromString(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toBase64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseBooleanEnv(name: string, defaultValue = false): boolean {
  const raw = Deno.env.get(name);
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

function decodeBase64LikeToken(input: string): Uint8Array | null {
  const sanitized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = sanitized.length % 4;
  const padded = padding === 0 ? sanitized : `${sanitized}${'='.repeat(4 - padding)}`;

  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Verify Android Play Integrity token
 */
async function verifyAndroidIntegrity(token: string): Promise<VerificationResult> {
  const projectNumber = Deno.env.get('GOOGLE_CLOUD_PROJECT_NUMBER');
  const credentials = Deno.env.get('GOOGLE_APPLICATION_CREDENTIALS_JSON');

  if (!projectNumber || !credentials) {
    return {
      valid: false,
      platform: 'android',
      error: 'Missing Google Cloud configuration',
    };
  }

  try {
    // Parse service account credentials
    const serviceAccount = JSON.parse(credentials);

    // Get access token using service account
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = toBase64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const jwtPayload = toBase64UrlFromString(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/playintegrity',
        aud: tokenUrl,
        iat: now,
        exp: now + 3600,
      })
    );

    // Sign JWT with private key (simplified - in production use proper JWT signing)
    const encoder = new TextEncoder();
    const keyData = serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----\n?/, '')
      .replace(/\n?-----END PRIVATE KEY-----\n?/, '')
      .replace(/\n/g, '');

    const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureInput = encoder.encode(`${jwtHeader}.${jwtPayload}`);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, signatureInput);
    const jwtSignature = toBase64UrlFromBytes(new Uint8Array(signature));

    const jwt = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch(tokenUrl, {
        signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      throw new Error('Failed to obtain access token');
    }

    // Verify integrity token with Google API
    const verifyUrl = `https://playintegrity.googleapis.com/v1/${projectNumber}:decodeIntegrityToken`;
    const verifyResponse = await fetch(verifyUrl, {
        signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrity_token: token }),
    });

    if (!verifyResponse.ok) {
      throw new Error(`Play Integrity API failed: ${verifyResponse.status}`);
    }
    const result: PlayIntegrityResponse = await verifyResponse.json();

    if (result.error) {
      return {
        valid: false,
        platform: 'android',
        error: result.error.message,
      };
    }

    const payload = result.tokenPayloadExternal;
    if (!payload) {
      return {
        valid: false,
        platform: 'android',
        error: 'Invalid token payload',
      };
    }

    // Check device integrity
    const deviceVerdict = payload.deviceIntegrity?.deviceRecognitionVerdict || [];
    const appVerdict = payload.appIntegrity?.appRecognitionVerdict || 'UNKNOWN';
    const accountVerdict = payload.accountDetails?.appLicensingVerdict || 'UNKNOWN';

    // Device should have at least MEETS_DEVICE_INTEGRITY
    const hasDeviceIntegrity = deviceVerdict.includes('MEETS_DEVICE_INTEGRITY');
    // App should be recognized
    const hasAppIntegrity = appVerdict === 'PLAY_RECOGNIZED';

    return {
      valid: hasDeviceIntegrity && hasAppIntegrity,
      platform: 'android',
      verdict: {
        deviceIntegrity: deviceVerdict,
        appIntegrity: appVerdict,
        accountLicensing: accountVerdict,
      },
    };
  } catch (error) {
    return {
      valid: false,
      platform: 'android',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify iOS App Attest token
 */
async function verifyIOSIntegrity(
  attestationOrAssertion: string,
  options?: IOSVerificationOptions,
): Promise<VerificationResult> {
  const appId = Deno.env.get('APPLE_APP_ID');
  const verifyUrl = Deno.env.get('APPLE_APP_ATTEST_VERIFY_URL');
  const verifyApiKey = Deno.env.get('APPLE_APP_ATTEST_VERIFY_API_KEY');
  const allowFormatOnly = parseBooleanEnv('APPLE_APP_ATTEST_ALLOW_FORMAT_ONLY', false);

  if (!appId) {
    return {
      valid: false,
      platform: 'ios',
      error: 'Missing Apple App ID configuration',
    };
  }

  try {
    if (options?.appId && options.appId !== appId) {
      return {
        valid: false,
        platform: 'ios',
        error: 'App ID mismatch',
      };
    }

    const decoded = decodeBase64LikeToken(attestationOrAssertion);
    if (!decoded || decoded.length < 100) {
      return {
        valid: false,
        platform: 'ios',
        error: 'Invalid attestation format',
      };
    }

    if (verifyUrl) {
      const verifierResponse = await fetch(verifyUrl, {
          signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(verifyApiKey ? { Authorization: `Bearer ${verifyApiKey}` } : {}),
        },
        body: JSON.stringify({
          appId,
          challenge: options?.challenge,
          keyId: options?.keyId,
          token: attestationOrAssertion,
        }),
      });

      if (!verifierResponse.ok) {
        return {
          valid: false,
          platform: 'ios',
          error: `Verifier request failed (${verifierResponse.status})`,
        };
      }

      const verifierData = await verifierResponse.json() as IOSVerifierResponse;
      if (!verifierData.valid) {
        return {
          valid: false,
          platform: 'ios',
          error: verifierData.error || 'Verifier rejected attestation',
        };
      }

      return {
        valid: true,
        platform: 'ios',
        verdict: {
          deviceIntegrity: verifierData.verdict?.deviceIntegrity || ['VERIFIED'],
          appIntegrity: verifierData.verdict?.appIntegrity || 'ATTESTED',
          accountLicensing: verifierData.verdict?.accountLicensing || 'N/A',
        },
      };
    }

    if (!allowFormatOnly) {
      return {
        valid: false,
        platform: 'ios',
        error: 'iOS verifier not configured. Set APPLE_APP_ATTEST_VERIFY_URL or explicitly allow format-only verification.',
      };
    }

    return {
      valid: true,
      platform: 'ios',
      verdict: {
        deviceIntegrity: ['FORMAT_ONLY'],
        appIntegrity: 'FORMAT_ONLY',
        accountLicensing: 'N/A',
      },
    };
  } catch (error) {
    return {
      valid: false,
      platform: 'ios',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const {
      token,
      platform,
      appId,
      challenge,
      keyId,
    } = await req.json();
    const normalizedPlatform = typeof platform === 'string' ? platform.toLowerCase() : platform;

    if (typeof token !== 'string' || !token || !normalizedPlatform) {
      return new Response(
        JSON.stringify({ error: 'Missing token or platform' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    let result: VerificationResult;

    if (normalizedPlatform === 'android') {
      result = await verifyAndroidIntegrity(token);
    } else if (normalizedPlatform === 'ios') {
      result = await verifyIOSIntegrity(token, { appId, challenge, keyId });
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid platform' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.valid ? 200 : 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[verify-app-integrity] Internal error');
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
