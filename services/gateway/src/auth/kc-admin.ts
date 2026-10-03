/**
 * Přístup ke Keycloak Admin API — ražený token servisního účtu.
 *
 * ⛔ PROČ TO VZNIKLO: `routes/admin.ts` četlo `process.env.KC_ADMIN_TOKEN`,
 * jenže tu proměnnou NIKDY nikdo nenastavoval — není v žádném compose souboru.
 * `/kc-role-sync` tedy v nasazení vždycky vrátil 500 „KC admin token not
 * configured". A i kdyby se nastavila, statický admin token je slepá ulička:
 * KC ho razí na ~60 s, takže by byl skoro pořád prošlý.
 *
 * ŘEŠENÍ (vzor už v realmu je — `netbird-backend`): confidential klient se
 * servisním účtem a rolemi `realm-management` (manage-users, view-users,
 * query-users). Gateway si token razí sama přes client_credentials, drží ho
 * v paměti a obnovuje před vypršením.
 *
 * NEJDE o master-realm admina: servisní účet umí spravovat uživatele v JEDNOM
 * realmu a nic víc. Heslo platformního admina do gateway nepatří.
 */
import { config } from '../config.js';
import { guardedFetch } from '../lib/guarded-fetch.js';

// Čteno při KAŽDÉM volání, ne při načtení modulu. Const na úrovni modulu by
// zamrzl stav prostředí v okamžiku importu — což je jednak netestovatelné,
// jednak křehké vůči pořadí inicializace (kdo načte dřív, ten vyhraje).
const clientId = (): string => process.env.KC_ADMIN_CLIENT_ID ?? 'aisha-user-admin';
const clientSecret = (): string => process.env.KC_ADMIN_CLIENT_SECRET ?? '';

/** Ražený token + čas, kdy ho přestaneme považovat za použitelný. */
let cached: { token: string; expiresAt: number } | null = null;
/** Jediný let: souběžné požadavky nesmí razit každý svůj token. */
let inFlight: Promise<string | null> | null = null;

export function kcAdminConfigured(): boolean {
  return clientSecret().length > 0;
}

async function mint(): Promise<string | null> {
  const secret = clientSecret();
  if (!secret) return null;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId(),
    client_secret: secret,
  });
  const res = await guardedFetch(config.oidcTokenUrl, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  // 30 s rezerva: token nesmí vypršet mezi naší kontrolou a odpovědí Keycloaku.
  const ttl = Math.max((data.expires_in ?? 60) - 30, 10);
  cached = { token: data.access_token, expiresAt: Date.now() + ttl * 1000 };
  return cached.token;
}

/** Platný admin token, nebo null když servisní účet není nakonfigurovaný. */
export async function kcAdminToken(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (inFlight) return inFlight;
  inFlight = mint().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Jen pro testy — vyprázdní keš mezi případy. */
export function __resetKcAdminTokenCache(): void {
  cached = null;
  inFlight = null;
}



export const kcAdminBase = (): string =>
  `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`;
