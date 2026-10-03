/**
 * Session vlastníka n8n a klient interního REST API (`/rest/*`).
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru, n8n 1.79.0): veřejné API (`/api/v1`) pověření
 * NEVYPÍŠE — `GET /credentials` → 405 „GET method not allowed" (openapi.yml má
 * u /credentials jen POST, u /credentials/{id} jen DELETE). provision-credentials
 * proto na výpisu padal a nevzniklo nic; deploy-workflows výpis „přeskočil" a
 * zakládal pověření znovu při KAŽDÉM nasazení (duplicity). Interní REST
 * (credentials.controller.js) umí výpis, založení, úpravu i smazání — se session
 * vlastníka, kterou díky heslu z tajemství platformy (N8N_BOOTSTRAP_OWNER_PASSWORD)
 * umí vyrobit každé nasazení.
 */

/**
 * Heslo vlastníka z tajemství platformy. n8n passwordSchema chce ≥8 znaků,
 * ≥1 číslici a ≥1 velké písmeno (max 64); tajemství je base64url, kde číslice
 * ani velké písmeno zaručené nejsou — předpona „Aa1" je zaručí deterministicky,
 * takže setup i pozdější přihlášení skládají TOTÉŽ heslo.
 */
export function hesloVlastnika(tajemstvi) {
  if (!tajemstvi) {
    throw new Error(
      "N8N_BOOTSTRAP_OWNER_PASSWORD chybí — heslo vlastníka n8n je tajemství platformy " +
        "(generate-secrets → .env.coolify → coolify-sync-envs). Bez něj by vlastník " +
        "vznikl s heslem, kterým se další nasazení nepřihlásí.",
    );
  }
  const heslo = `Aa1${tajemstvi}`;
  if (heslo.length > 64) throw new Error(`heslo vlastníka má ${heslo.length} znaků, n8n bere nejvýš 64`);
  return heslo;
}

/** Cookie `n8n-auth=…` (jméno=hodnota) z odpovědi fetch, nebo null. */
export function authCookie(res) {
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const m = /^(n8n-auth=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

/**
 * Přihlášení vlastníka (n8n 1.79 LoginRequestDto = {email, password}).
 * 401 znamená vlastníka s JINÝM heslem — hláška říká cestu ven.
 */
export async function prihlasVlastnika({ rest, email, heslo }) {
  const res = await fetch(`${rest}/rest/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: heslo }),
    signal: AbortSignal.timeout(30_000),
  });
  const cookie = authCookie(res);
  if (res.ok && cookie) return cookie;
  if (res.status === 401) {
    throw new Error(
      "vlastník n8n existuje, ale heslo z N8N_BOOTSTRAP_OWNER_PASSWORD nesedí (HTTP 401) — " +
        "vlastník vznikl s jiným heslem (dřív náhodným a zahozeným). Jednorázově na kontejneru n8n:\n" +
        "    docker exec <n8n> n8n user-management:reset\n" +
        "a následné nasazení stacku (bootstrap pak vlastnictví převezme s tajemstvím platformy).",
    );
  }
  const text = await res.text().catch((e) => `(tělo nečitelné: ${e.name})`);
  throw new Error(`/rest/login failed: ${res.status} ${text.slice(0, 200)}`);
}

/** Klient interního REST se session vlastníka; odpovědi rozbalí z `{ data }`. */
export function restKlient({ rest, cookie }) {
  async function volej(metoda, cesta, telo) {
    const res = await fetch(`${rest}/rest${cesta}`, {
      method: metoda,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: telo === undefined ? undefined : JSON.stringify(telo),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${metoda} /rest${cesta} → ${res.status}: ${text.slice(0, 200)}`);
    if (!text) return null;
    const json = JSON.parse(text);
    return json && typeof json === "object" && "data" in json ? json.data : json;
  }
  return {
    get: (cesta) => volej("GET", cesta),
    post: (cesta, telo) => volej("POST", cesta, telo),
    patch: (cesta, telo) => volej("PATCH", cesta, telo),
    smaz: (cesta) => volej("DELETE", cesta),
  };
}
