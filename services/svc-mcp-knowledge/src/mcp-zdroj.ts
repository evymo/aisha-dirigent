/**
 * Token z IDE patří JEN serveru MCP (revize Guru 2026-10-07, OAuth dodělat — ne odstranit).
 *
 * ⛔ NAMĚŘENO 2026-10-07: klient `aisha-mcp-client` neměl audience mapper a `/mcp` věřil `azp`/`aud`
 *    ze sdíleného seznamu KC_ALLOWED_CLIENTS. Do téhož seznamu ho zařadilo odvození veřejných
 *    klientů realmu, takže token z IDE přijala i gateway a vyměnila ho za JWT PostgRESTu — tedy
 *    přístup k celému API pod identitou uživatele, ne jen k nástrojům MCP.
 *
 * Teď:
 *   - realm klientovi `aisha-mcp-client` přidá audience `AUDIENCE_SERVERU_ZNALOSTI`
 *     (oidc-audience-mapper v keycloak/aisha-realm.json);
 *   - `/mcp` token Keycloaku BEZ té audience odmítne (403);
 *   - ostatní routy této služby i gateway token vydaný klientem `KLIENT_MCP` odmítnou.
 * Shodu hodnot s realmem a s gateway drží brána mcp-token-patri-jen-serveru-mcp.
 *
 * @module
 */

/** Identifikátor zdroje MCP v `aud` (stálý, nezávislý na doméně instance). */
export const AUDIENCE_SERVERU_ZNALOSTI = 'aisha-mcp-knowledge';

/** Veřejný klient realmu pro přihlášení klientů MCP (IDE, CLI). */
export const KLIENT_MCP = 'aisha-mcp-client';

function seznam(hodnota: unknown): string[] {
  if (typeof hodnota === 'string') return [hodnota];
  return Array.isArray(hodnota) ? hodnota.filter((x): x is string => typeof x === 'string') : [];
}

/** Token nese audience serveru MCP. */
export function maAudienceServeruZnalosti(claims: Record<string, unknown>): boolean {
  return seznam(claims.aud).includes(AUDIENCE_SERVERU_ZNALOSTI);
}

/** Token vydal klient určený jen pro MCP. */
export function jeTokenKlientaMcp(claims: Record<string, unknown>): boolean {
  return claims.azp === KLIENT_MCP;
}
