import { config } from '../config.js';
import { zkontrolujPayloadBezTajemstvi } from './bez-tajemstvi.js';
import { SignJWT, importPKCS8 } from 'jose';
import {
  federationDefects,
  getFederatedAccessToken,
  readFederationConfig,
} from './gcp-federation.js';

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

let cachedAccount: ServiceAccount | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  if (cachedAccount) return cachedAccount;
  if (!config.fcmServiceAccountJson) return null;

  try {
    cachedAccount = JSON.parse(config.fcmServiceAccountJson) as ServiceAccount;
    return cachedAccount;
  } catch {
    return null;
  }
}

/**
 * Dvě cesty k pověření, v tomto pořadí:
 *   1. klíč service accountu v env — původní, ponechaná kvůli instancím, které ji používají
 *   2. federace přes náš Keycloak — bez dlouhověkého klíče
 *
 * Federace je druhá záměrně: kdo klíč nastavený má, nemá se mu chování změnit pod rukama.
 * Naopak organizace, která klíče zakazuje (`iam.disableServiceAccountKeyCreation`),
 * první cestu ani nemůže naplnit, takže se rovnou použije druhá.
 */
function credentialMode(): 'service-account' | 'federation' | 'none' {
  if (getServiceAccount()) return 'service-account';
  return readFederationConfig() ? 'federation' : 'none';
}

export function isFcmConfigured(): boolean {
  return credentialMode() !== 'none';
}

/** Co přesně chybí — „not configured" bez uvedení čeho se přes tři systémy neladí. */
export function fcmConfigurationDefects(): string[] {
  if (isFcmConfigured()) return [];
  const chybi = federationDefects();
  return [
    'FIREBASE_SERVICE_ACCOUNT_JSON není nastavený a federace není úplná.',
    ...chybi.map((k) => `chybí ${k}`),
  ];
}

export function getFcmProjectId(): string {
  const sa = getServiceAccount();
  if (sa) return sa.project_id;
  // Bez klíče se projekt z ničeho neodvodí — musí ho říct prostředí.
  // Dosadit jméno „nějakého" projektu by znamenalo posílat notifikace cizí instanci.
  const fromEnv = process.env.FCM_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    'FCM: projekt není znám — bez FIREBASE_SERVICE_ACCOUNT_JSON musí být nastavený FCM_PROJECT_ID.',
  );
}

export async function getFcmAccessToken(): Promise<string> {
  // Return cached if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  if (credentialMode() === 'federation') {
    const cfg = readFederationConfig();
    if (!cfg) throw new Error('FCM not configured');
    cachedToken = await getFederatedAccessToken(cfg);
    return cachedToken.token;
  }

  const sa = getServiceAccount();
  if (!sa) throw new Error(`FCM not configured: ${fcmConfigurationDefects().join('; ')}`);

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(sa.private_key, 'RS256');

  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`FCM token exchange failed: ${res.status} ${detail}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string };
  data?: Record<string, string>;
  android?: {
    priority: 'high' | 'normal';
    notification?: { sound?: string; channelId?: string };
  };
  apns?: {
    payload: { aps: { badge?: number; sound?: string; 'content-available'?: number } };
  };
}

export async function sendFcmMessage(
  message: FcmMessage,
  accessToken: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  // ⛔ Hranice systému: dál už payload vidí Google, protokol oznámení i uzamčená
  // obrazovka telefonu. Jednorázový kód sem nepatří — jde Telegramem.
  zkontrolujPayloadBezTajemstvi(message.data, 'FCM');
  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(config.fcmTimeoutMs),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `FCM error: ${res.status} - ${errText}` };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${msg}` };
  }
}
