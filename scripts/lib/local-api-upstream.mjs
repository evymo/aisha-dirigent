// =============================================================================
// local-api-upstream.mjs — serverová volání API v lokálním stacku
// =============================================================================
// Pure, side-effect-free. Used by scripts/local-compose-gen.mjs.
//
// Veřejná tvář API (`https://<API_DOMAIN>`) lokálně uvnitř Docker sítě
// neexistuje — není Traefik ani DNS záznam, prohlížeč jde na localhost:<port>.
// Serverový konzument ji ale skládá právě takhle: n8n s vypnutou mesh
// (`AISHA_API_URL=https://${API_DOMAIN}`), OpenClaw (`AISHA_MCP_URL`). Lokálně tak
// volal API na jméno, které nikdo nepřeloží (naměřeno 2026-10-08).
//
// Přepisuje se na mesh jméno API z topologie (API_UPSTREAM_MESH) — generátor ho
// dává gateway jako síťový alias (addMeshAliases), takže je to totéž místo, kam
// v produkci vede mesh lane. Nic se nedosazuje: chybí-li vstup, hodnota zůstane.
// =============================================================================

/**
 * `https://<apiDomain>[/cesta]` → `<apiUpstream>[/cesta]`; ostatní hodnoty beze změny.
 * @param {unknown} value
 * @param {{ apiDomain?: string, apiUpstream?: string }} opts
 */
export function rewritePublicApiUrlForLocal(value, { apiDomain, apiUpstream } = {}) {
  if (typeof value !== "string" || !apiDomain || !apiUpstream) return value;
  const verejna = `https://${apiDomain}`;
  if (value !== verejna && !value.startsWith(`${verejna}/`)) return value;
  return `${apiUpstream.replace(/\/+$/, "")}${value.slice(verejna.length)}`;
}

/**
 * Totéž nad `environment` služby (objekt `{K: V}` i pole `"K=V"`). Vrací nové env.
 */
export function rewritePublicApiUrlsInEnv(env, opts) {
  if (Array.isArray(env)) {
    return env.map((e) => {
      const eq = typeof e === "string" ? e.indexOf("=") : -1;
      return eq < 0 ? e : `${e.slice(0, eq)}=${rewritePublicApiUrlForLocal(e.slice(eq + 1), opts)}`;
    });
  }
  if (env && typeof env === "object") {
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, rewritePublicApiUrlForLocal(v, opts)]));
  }
  return env;
}
