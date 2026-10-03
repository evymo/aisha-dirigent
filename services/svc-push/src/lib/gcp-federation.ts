/**
 * Přístup k Google API BEZ dlouhověkého klíče — Workload Identity Federation.
 *
 * PROČ (změřeno 2026-08-05)
 * -------------------------
 * Organizace `info-org` má politiku `constraints/iam.disableServiceAccountKeyCreation`,
 * takže klíč service accountu **nelze vytvořit**. A je to správně: klíč v env
 * proměnné je dlouhověké tajemství, které se těžko rotuje a snadno uniká.
 *
 * Federace to řeší jinak: kontejner si vezme token od NAŠEHO Keycloaku, Google
 * ho přijme (má nakonfigurovaného poskytovatele s naším issuerem) a vrátí
 * krátkodobý přístupový token. Nikde nevzniká soubor s klíčem.
 *
 * Řetěz je trojkrokový:
 *   1) Keycloak    → token pro klienta z `GCP_FEDERATION_CLIENT_ID` (client_credentials)
 *   2) Google STS  → výměna za federovaný token
 *   3) IAM Credentials → impersonace service accountu → přístupový token
 *
 * Krok 3 je nutný: federovaný token sám o sobě na FCM nestačí, oprávnění drží
 * service account. Google mu důvěřuje jen z okruhu, který je na straně poolu
 * omezený podmínkou na `assertion.azp` — bez ní by si token mohl vyměnit
 * KTERÝKOLI uživatel realmu.
 */

import { createSsrfGuard, type SsrfGuard } from '@aisha/security';

const STS_HOST = 'sts.googleapis.com';
const IAM_HOST = 'iamcredentials.googleapis.com';
const STS_URL = `https://${STS_HOST}/v1/token`;
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface FederationConfig {
  /** `//iam.googleapis.com/projects/N/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` */
  audience: string;
  /** service account, který se impersonuje */
  serviceAccountEmail: string;
  /** vydavatel tokenu — náš Keycloak */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Hostitel vydavatele — a zároveň kontrola, že adresa vůbec je adresa. */
function issuerHost(tokenUrl: string): string | null {
  try {
    return new URL(tokenUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Vrátí konfiguraci, jen když je ÚPLNÁ. Půlka nastavení není nastavení. */
export function readFederationConfig(env: NodeJS.ProcessEnv = process.env): FederationConfig | null {
  const audience = env.GCP_WORKLOAD_IDENTITY_AUDIENCE?.trim();
  const serviceAccountEmail = env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  const tokenUrl = env.GCP_FEDERATION_TOKEN_URL?.trim();
  const clientId = env.GCP_FEDERATION_CLIENT_ID?.trim();
  const clientSecret = env.GCP_FEDERATION_CLIENT_SECRET?.trim();
  if (!audience || !serviceAccountEmail || !tokenUrl || !clientId || !clientSecret) return null;
  // Adresa, která není adresa, je vada konfigurace — ne něco, co se má ukázat až
  // v okamžiku odesílání notifikace.
  if (!issuerHost(tokenUrl)) return null;
  return { audience, serviceAccountEmail, tokenUrl, clientId, clientSecret };
}

/**
 * Stráž pro odchozí volání federace.
 *
 * PROČ (a ne holý `fetch`)
 * ------------------------
 * Krok 1 posílá `client_secret` na adresu z PROSTŘEDÍ. Holý `fetch` na tom má dvě
 * díry, které stráž zavírá:
 *
 *   1. Přesměrování — `fetch` následuje `Location` sám a u 307/308 ZOPAKUJE POST
 *      včetně těla. Vydavatel (nebo kdokoli, kdo odpoví místo něj) tak umí nechat
 *      naše tajemství doručit jinam. `safeFetch` prověřuje KAŽDÝ skok znovu.
 *   2. Překlep či podvrh v konfiguraci — `169.254.169.254` by z nás udělalo čtečku
 *      metadat cloudu. IP kontrola po DNS to odmítne bez ohledu na seznam hostitelů.
 *
 * Seznam hostitelů: dva Googlí jsou v kódu napevno, vydavatel se odvozuje z
 * konfigurace (je to důvěryhodný kotevní bod operátora, ne uživatelský vstup).
 * `http:` se povolí jen tehdy, když si ho operátor sám nastavil; vnitřní sítě ano,
 * protože vydavatel může být kontejner vedle nás.
 */
function createFederationGuard(cfg: FederationConfig): SsrfGuard {
  const host = issuerHost(cfg.tokenUrl);
  if (!host) throw new Error(`GCP_FEDERATION_TOKEN_URL není adresa: ${cfg.tokenUrl.slice(0, 80)}`);
  const schemes = cfg.tokenUrl.startsWith('http://') ? ['https:', 'http:'] : ['https:'];
  return createSsrfGuard({
    service: 'svc-push',
    hostAllowlist: [STS_HOST, IAM_HOST, host],
    allowedSchemes: schemes,
    allowInternalNetworks: true,
  });
}

/**
 * Které části chybí. Používá se k hlášení — „není nakonfigurováno" bez uvedení
 * CO chybí je k ničemu, když se to ladí přes tři systémy.
 */
export function federationDefects(env: NodeJS.ProcessEnv = process.env): string[] {
  const required = [
    'GCP_WORKLOAD_IDENTITY_AUDIENCE',
    'GCP_SERVICE_ACCOUNT_EMAIL',
    'GCP_FEDERATION_TOKEN_URL',
    'GCP_FEDERATION_CLIENT_ID',
    'GCP_FEDERATION_CLIENT_SECRET',
  ];
  const chybi = required.filter((k) => !env[k]?.trim());
  // Vyplněná, ale nepoužitelná adresa je taky vada — a hlásí se pod svým jménem.
  const tokenUrl = env.GCP_FEDERATION_TOKEN_URL?.trim();
  if (tokenUrl && !issuerHost(tokenUrl)) chybi.push('GCP_FEDERATION_TOKEN_URL');
  return chybi;
}

async function postForm(
  guard: SsrfGuard,
  url: string,
  body: Record<string, string>,
  timeoutMs = 10_000,
) {
  const res = await guard.safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${url} → ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Krok 1 — token od našeho Keycloaku. */
export async function fetchIssuerToken(cfg: FederationConfig): Promise<string> {
  const data = await postForm(createFederationGuard(cfg), cfg.tokenUrl, {
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    // Publikum musí sedět s `--allowed-audiences` poskytovatele, jinak Google token odmítne.
    audience: cfg.clientId,
  });
  const token = data.access_token;
  if (typeof token !== 'string' || !token) throw new Error('Keycloak nevrátil access_token');
  return token;
}

/** Krok 2 — výměna na Google STS za federovaný token. */
export async function exchangeForFederatedToken(cfg: FederationConfig, issuerToken: string): Promise<string> {
  const data = await postForm(createFederationGuard(cfg), STS_URL, {
    audience: cfg.audience,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: SCOPE,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token: issuerToken,
  });
  const token = data.access_token;
  if (typeof token !== 'string' || !token) throw new Error('STS nevrátil access_token');
  return token;
}

/** Krok 3 — impersonace service accountu. Vrací i expiraci, ať jde token kešovat. */
export async function impersonateServiceAccount(
  cfg: FederationConfig,
  federatedToken: string,
): Promise<{ token: string; expiresAt: number }> {
  const url =
    `https://${IAM_HOST}/v1/projects/-/serviceAccounts/${encodeURIComponent(cfg.serviceAccountEmail)}:generateAccessToken`;
  const res = await createFederationGuard(cfg).safeFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${federatedToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/firebase.messaging'] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`impersonace ${cfg.serviceAccountEmail} → ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { accessToken?: string; expireTime?: string };
  if (!data.accessToken) throw new Error('IAM Credentials nevrátilo accessToken');
  // `expireTime` je ISO; když chybí, kešuje se konzervativně na 5 minut místo hádání hodiny.
  const expiresAt = data.expireTime ? Date.parse(data.expireTime) : Date.now() + 5 * 60_000;
  return { token: data.accessToken, expiresAt };
}

/** Celý řetěz. */
export async function getFederatedAccessToken(
  cfg: FederationConfig,
): Promise<{ token: string; expiresAt: number }> {
  const issuerToken = await fetchIssuerToken(cfg);
  const federated = await exchangeForFederatedToken(cfg, issuerToken);
  return impersonateServiceAccount(cfg, federated);
}
