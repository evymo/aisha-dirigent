/**
 * kc-client-secret.mjs — read OIDC client secrets LIVE from Keycloak (the
 * authority) so nothing has to be copied, stored, or kept in sync.
 *
 * Keycloak is the identity provider that validates each client secret at auth
 * time, so its stored value is the single source of truth. Consumers (their
 * Coolify env) are reconciled *to* KC — never the other way — which is why this
 * module only READS (GET), never writes. Provisioning (the initial push of a
 * generated secret INTO KC) stays in provision-sso.sh; drift healing pulls FROM
 * KC via scripts/reconcile-oidc-secrets.mjs.
 *
 * CLIENT_REGISTRY is the authoritative clientId ↔ Coolify env-key mapping,
 * lifted verbatim from provision-sso.sh (the SoT that creates these clients):
 *   set_client_secret "<clientId>" "$<consumer var ← envKey>" …
 * If you add an OIDC client there, add it here too (the coverage gate checks).
 *
 * Secret VALUES are never logged by callers — only clientId + a drift boolean.
 */

/**
 * clientId → the Coolify env key whose value must equal the KC client secret.
 * Derived from provision-sso.sh:112-119 (prod var wiring) and :520-527 (calls).
 */
export const CLIENT_REGISTRY = [
  { clientId: "aisha-app", envKey: "KEYCLOAK_CLIENT_SECRET" },
  { clientId: "appsmith-proxy", envKey: "APPSMITH_OIDC_SECRET" },
  { clientId: "nocodb-proxy", envKey: "NOCODB_OIDC_SECRET" },
  { clientId: "langfuse", envKey: "LANGFUSE_OIDC_SECRET" },
  { clientId: "studio-proxy", envKey: "STUDIO_OIDC_SECRET" },
  { clientId: "n8n-proxy", envKey: "N8N_OIDC_SECRET" },
  // openclaw-auth OAuth2 proxy (fronts the public companion route); provision-sso.sh
  // sets its secret from OPENCLAW_OIDC_SECRET (same value the compose passes the proxy).
  { clientId: "openclaw-proxy", envKey: "OPENCLAW_OIDC_SECRET" },
  // netbird management authenticates to KC as `netbird-backend`; its secret is
  // wired to NETBIRD_MGMT_SECRET (provision-sso.sh:118). Stale drift here was
  // the 2026-07-02 mesh-enroll incident root cause.
  { clientId: "netbird-backend", envKey: "NETBIRD_MGMT_SECRET" },
  { clientId: "appsmith-intranet-proxy", envKey: "APPSMITH_INTRANET_OIDC_SECRET" },
  // extranet-auth OAuth2 proxy stojí před extranetem, aby se bundle nevydal
  // nepřihlášenému. Drift jeho tajemství by povrch neshodil viditelně —
  // oauth2-proxy prostě přestane vyměňovat kód a uživatel skončí na chybě
  // od IdP, ne na rozbité stránce. Proto sem patří jako ostatní.
  { clientId: "extranet-proxy", envKey: "EXTRANET_OIDC_SECRET" },
];

/**
 * Obtain a Keycloak admin access token via the master-realm admin-cli
 * password grant (same flow provision-sso.sh:get_kc_token uses).
 *
 * @param {object} cfg
 * @param {string} cfg.kcUrl     e.g. https://auth.example.com (no trailing slash needed)
 * @param {string} cfg.admin     admin username (KEYCLOAK_ADMIN)
 * @param {string} cfg.password  admin password (KEYCLOAK_ADMIN_PASSWORD)
 * @param {number} [cfg.timeoutMs=15000]
 * @param {typeof fetch} [cfg.fetchImpl=fetch]  injectable for tests
 * @param {number} [cfg.transientRetryMs=0]  okno pro opakování PŘECHODNÝCH chyb (0 = jeden pokus)
 * @param {(ms: number) => Promise<void>} [cfg.sleep]  injectable for tests
 * @param {(info: {pokus: number, prodleva: number, chyba: string}) => void} [cfg.onRetry]
 * @returns {Promise<string>} bearer access token
 */
export async function getKcAdminToken({
  kcUrl,
  admin,
  password,
  timeoutMs = 15000,
  fetchImpl = fetch,
  transientRetryMs = 0,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onRetry = () => {},
}) {
  if (!kcUrl) throw new Error("getKcAdminToken: kcUrl required");
  if (!admin || !password) throw new Error("getKcAdminToken: admin + password required");
  // ⛔ NAMĚŘENO 2026-09-19 (guru, konvergence): Keycloak sdílí DB s core. Redeploy
  // core restartuje i tu DB a migrace hned nato žádá admin token — Keycloak
  // vrátil HTTP 500 (Agroal „Acquisition timeout", pool se teprve obnovoval)
  // a operátoři se neprovisionovali, ač byl Keycloak do 30 s zpátky.
  // Přechodná = síťová chyba nebo 5xx; ta se opakuje, dokud nevyprší
  // transientRetryMs, pak padá POSLEDNÍ chyba nahlas. 4xx (špatné heslo,
  // chybějící klient) přechodná NENÍ a padá hned — opakování by ji jen schovalo.
  let zbyva = transientRetryMs;
  for (let pokus = 1; ; pokus++) {
    try {
      return await jedenPokusAdminToken({ kcUrl, admin, password, timeoutMs, fetchImpl });
    } catch (err) {
      const prodleva = Math.min(2000 * pokus, 15000);
      if (!err.prechodna || prodleva > zbyva) throw err;
      onRetry({ pokus, prodleva, chyba: err.message });
      await sleep(prodleva);
      zbyva -= prodleva;
    }
  }
}

async function jedenPokusAdminToken({ kcUrl, admin, password, timeoutMs, fetchImpl }) {
  const base = kcUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(`${base}/realms/master/protocol/openid-connect/token`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: admin,
          password,
          grant_type: "password",
          client_id: "admin-cli",
        }).toString(),
      });
    } catch (err) {
      // Spojení se nepodařilo (odmítnuto, reset, timeout) — přechodné.
      throw Object.assign(new Error(`KC admin token: ${err?.name || "Error"}: ${err?.message || err}`), { prechodna: true });
    }
    const text = await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(`KC admin token HTTP ${res.status}: ${text.slice(0, 160)}`), {
        prechodna: res.status >= 500,
      });
    }
    const token = JSON.parse(text)?.access_token;
    if (!token) throw new Error("KC admin token response missing access_token");
    return token;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a client's internal UUID from its clientId.
 * @returns {Promise<string|null>} uuid, or null if the client does not exist.
 */
export async function getClientUuid({ kcUrl, realm, clientId, token, timeoutMs = 15000, fetchImpl = fetch }) {
  const base = kcUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `${base}/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`,
      { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`KC clients lookup HTTP ${res.status}: ${text.slice(0, 160)}`);
    const arr = JSON.parse(text);
    return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a confidential client's current secret VALUE from Keycloak.
 *
 * @returns {Promise<string|null>} the secret, or null when the client is
 *   missing or public (no confidential secret). Callers must not log the value.
 */
export async function getClientSecret({ kcUrl, realm, clientId, token, timeoutMs = 15000, fetchImpl = fetch }) {
  const uuid = await getClientUuid({ kcUrl, realm, clientId, token, timeoutMs, fetchImpl });
  if (!uuid) return null;
  const base = kcUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `${base}/admin/realms/${encodeURIComponent(realm)}/clients/${uuid}/client-secret`,
      { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`KC client-secret HTTP ${res.status} for ${clientId}: ${text.slice(0, 160)}`);
    const value = JSON.parse(text)?.value;
    return typeof value === "string" && value.length > 0 ? value : null;
  } finally {
    clearTimeout(timer);
  }
}
