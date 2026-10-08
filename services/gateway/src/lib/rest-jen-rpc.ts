/**
 * /rest/v1 pro klienta = jen RPC.
 *
 * Platformní pravidlo „klient nikdy nečte tabulky, volá auditované RPC" dosud
 * hlídaly jen statické brány nad kódem webu a mobilu. Gateway ale posílal do
 * PostgRESTu i `GET /rest/v1/<tabulka>` a `PATCH`/`DELETE` nad tabulkou —
 * jedinou hradbou tak byla RLS každé jednotlivé tabulky (a heals.sql eviduje
 * několik případů, kdy nestačila: app_secrets, v_health_*, partner_profiles_public).
 *
 * Teď: kdo není `service_role`, smí přes /rest/v1 jen
 *   - `/rpc/<funkce>` (libovolná metoda),
 *   - kořen `/` (sonda dostupnosti v mobilu a v rozšíření).
 * Ostatní cesty → 403 `rest_rpc_only`. `service_role` (n8n, e2e fixtury, interní
 * služby) projde beze změny — tabulky přes gateway volá jen on (ověřeno git grepem
 * nad n8n/, e2e/, mobile-app/, extensions/, apps/, packages/).
 *
 * Roli určuje nepodepsaný obsah tokenu. To stačí: podpis ověří PostgREST
 * (případně překlad Keycloak tokenu za tímhle hookem), takže podvržená role
 * `service_role` neprojde dál než sem. Keycloak token je VŽDY uživatel — i kdyby
 * nesl vlastní claim `role`, překlad z něj dělá `authenticated`.
 */
import { decodeJwt } from 'jose';

export const REST_RPC_ONLY_ERROR = 'rest_rpc_only';

/** Identifikátor funkce v PostgRESTu — nic, co by šlo dekódovat na jinou cestu. */
const RPC_PATH = /^\/rest\/v1\/rpc\/[A-Za-z_][A-Za-z0-9_]*\/?$/;
const ROOT_PATH = /^\/rest\/v1\/?$/;

/** Role, pod kterou požadavek do PostgRESTu dorazí; `anon` bez nosiče. */
export function effectiveRestRole(authorization: string | undefined, keycloakIssuer: string): string {
  if (!authorization?.startsWith('Bearer ')) return 'anon';
  const token = authorization.slice('Bearer '.length).trim();
  try {
    const claims = decodeJwt(token);
    if (claims.iss === keycloakIssuer) return 'authenticated';
    return typeof claims.role === 'string' && claims.role.length > 0 ? claims.role : 'anon';
  } catch {
    // Neparsovatelný nosič PostgREST odmítne; pro tuhle bránu je to klient.
    return 'anon';
  }
}

/**
 * Smí klient s rolí `role` na `rawUrl`? Cesta se posuzuje SUROVÁ (tak, jak ji
 * proxy předá dál): procento-kódování ani `..` se nepřipouští, aby gateway a
 * PostgREST nemohly tutéž cestu číst každý jinak.
 */
export function isRestPathAllowed(rawUrl: string, role: string): boolean {
  if (role === 'service_role') return true;
  const path = rawUrl.split('?', 1)[0];
  if (path.includes('%') || path.includes('..') || path.includes('//')) return false;
  return RPC_PATH.test(path) || ROOT_PATH.test(path);
}
