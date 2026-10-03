/**
 * FCM HTTP v1 API Authentication
 * 
 * Generates OAuth2 access tokens from Firebase service account credentials
 * for use with FCM HTTP v1 API.
 * 
 * Required secret: FIREBASE_SERVICE_ACCOUNT_JSON (full JSON key from Firebase Console)
 * Optional secret: FCM_PROJECT_ID (defaults to parsed from service account)
 */

import { createJwt, getNumericDate } from './deps.ts';

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/**
 * Parse service account credentials from environment
 */
function getServiceAccountCredentials(): ServiceAccountCredentials {
  const json = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!json) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured');
  }
  
  try {
    return JSON.parse(json) as ServiceAccountCredentials;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

/**
 * Get FCM project ID (from env or service account)
 */
export function getFcmProjectId(): string {
  const envProjectId = Deno.env.get('FCM_PROJECT_ID');
  if (envProjectId) {
    return envProjectId;
  }
  
  const credentials = getServiceAccountCredentials();
  return credentials.project_id;
}

/**
 * Import private key for JWT signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and decode base64
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
}

/**
 * Generate a new OAuth2 access token using service account credentials
 */
async function generateAccessToken(): Promise<string> {
  const credentials = getServiceAccountCredentials();
  
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour
  
  // Create JWT for token request
  const key = await importPrivateKey(credentials.private_key);
  
  const jwt = await createJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: credentials.client_email,
      sub: credentials.client_email,
      aud: credentials.token_uri,
      iat: getNumericDate(0), // now
      exp: getNumericDate(3600), // 1 hour from now
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    },
    key
  );
  
  // Exchange JWT for access token
  const response = await fetch(credentials.token_uri, {
      signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  
  // Cache the token
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) - 60, // Refresh 1 minute before expiry
  };
  
  return data.access_token;
}

/**
 * Get a valid OAuth2 access token for FCM API
 * Uses cached token if still valid, otherwise generates new one
 */
export async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  // Return cached token if still valid
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }
  
  // Generate new token
  return await generateAccessToken();
}

/**
 * Check if FCM is properly configured
 */
export function isFcmConfigured(): boolean {
  try {
    getServiceAccountCredentials();
    return true;
  } catch {
    return false;
  }
}
