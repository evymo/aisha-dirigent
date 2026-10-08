/**
 * Brána: token klienta MCP (přihlášení z IDE) patří jen serveru MCP a nese jen role, které /mcp
 * vyhodnocuje (revize Guru 2026-10-07 nad WP-B — OAuth dodělat, ne odstranit).
 *
 * ⛔ NAMĚŘENO 2026-10-07: `aisha-mcp-client` neměl audience mapper, `fullScopeAllowed: true`
 *    a sdílený KC_ALLOWED_CLIENTS ho pouštěl i do gateway → token z IDE šel vyměnit za JWT
 *    PostgRESTu (celé API pod identitou uživatele) a nesl všechny role realmu.
 *
 * Měří se nad zdrojem (chování obou služeb drží jejich unit testy):
 *   1. klient má oidc-audience-mapper s audience, kterou vyžaduje svc-mcp-knowledge
 *      (src/mcp-zdroj.ts) a kterou zná gateway (lib/chraneny-zdroj.ts) — jedna hodnota ve třech;
 *   2. `fullScopeAllowed: false` a výslovné `optionalClientScopes: []` (jinak import přidá
 *      volitelné scopy realmu včetně offline_access);
 *   3. `scopeMappings` klienta nese každou roli, kterou /mcp čte (isAdminOrStaff), a každá
 *      z nich je role realmu — bez toho admin v tokenu ztratí admin nástroje;
 *   4. živý realm: configure-realms.sh po založení klienta doplní mapování rolí ze `scopeMappings`;
 *   5. gateway klienta MCP za JWT PostgRESTu nevymění, služba mimo /mcp ho odmítne.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Mapper = { protocolMapper?: string; config?: Record<string, string> };
type Klient = { clientId: string; fullScopeAllowed?: boolean; optionalClientScopes?: string[]; protocolMappers?: Mapper[] };
const REALM = JSON.parse(cti("keycloak/aisha-realm.json")) as {
  clients: Klient[];
  roles?: { realm?: Array<{ name: string }> };
  scopeMappings?: Array<{ client?: string; roles?: string[] }>;
};

const konst = (rel: string, jmeno: string): string => {
  const m = new RegExp(`export const ${jmeno} = '([^']+)'`).exec(cti(rel));
  if (!m) throw new Error(`${jmeno} v ${rel} nenalezena — měřidlo slepé`);
  return m[1];
};
const SVC = "services/svc-mcp-knowledge/src/mcp-zdroj.ts";
const GW = "services/gateway/src/lib/chraneny-zdroj.ts";
const KLIENT = konst(SVC, "KLIENT_MCP");
const AUDIENCE = konst(SVC, "AUDIENCE_SERVERU_ZNALOSTI");
const klient = REALM.clients.find((c) => c.clientId === KLIENT);

describe("token klienta MCP patří jen serveru MCP", () => {
  it("kotva: klient je v deklaraci a obě služby znají TÉŽ jméno a audience", () => {
    expect(klient, `${KLIENT} v keycloak/aisha-realm.json`).toBeDefined();
    expect(konst(GW, "KLIENT_MCP")).toBe(KLIENT);
    expect(konst(GW, "AUDIENCE_SERVERU_ZNALOSTI")).toBe(AUDIENCE);
  });

  it("audience mapper nese audience serveru MCP v přístupovém tokenu", () => {
    const aud = (klient!.protocolMappers ?? []).filter((m) => m.protocolMapper === "oidc-audience-mapper");
    expect(aud.map((m) => m.config?.["included.custom.audience"])).toEqual([AUDIENCE]);
    expect(aud[0]!.config?.["access.token.claim"]).toBe("true");
  });

  it("nejmenší oprávnění: fullScopeAllowed false, žádné volitelné scopy", () => {
    expect(klient!.fullScopeAllowed).toBe(false);
    expect(klient!.optionalClientScopes).toEqual([]);
  });

  it("scopeMappings nesou každou roli, kterou /mcp vyhodnocuje, a jsou to role realmu", () => {
    const auth = cti("services/svc-mcp-knowledge/src/auth.ts");
    const teloAdmin = /export function isAdminOrStaff[\s\S]*?\n}/.exec(auth)?.[0] ?? "";
    const cteneRole = [...teloAdmin.matchAll(/roles\.includes\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(cteneRole.length, "měřidlo nenašlo role v isAdminOrStaff").toBeGreaterThan(0);
    const mapovane = (REALM.scopeMappings ?? []).filter((m) => m.client === KLIENT).flatMap((m) => m.roles ?? []);
    expect(mapovane).toEqual(expect.arrayContaining(cteneRole));
    const roleRealmu = new Set((REALM.roles?.realm ?? []).map((r) => r.name));
    expect(mapovane.filter((r) => !roleRealmu.has(r)), "mapovaná role, která v realmu není").toEqual([]);
  });

  it("živý realm: založení klienta doplní mapování rolí ze scopeMappings", () => {
    const skript = cti("keycloak/configure-realms.sh");
    const blok = skript.slice(skript.indexOf("# ── Platform clients: doplnit CHYBĚJÍCÍ"), skript.indexOf("# ── Instance clients"));
    expect(blok).toContain("scopeMappings");
    expect(blok).toContain("/scope-mappings/realm");
    expect(blok, "chybějící role = chyba nasazení").toMatch(/neexistuje"; exit 1/);
  });

  it("gateway token klienta MCP nevymění; služba ho mimo /mcp odmítne", () => {
    expect(cti("services/gateway/src/auth/postgrest-jwt.ts")).toMatch(/payload\.azp === KLIENT_MCP\) return false/);
    expect(cti("services/svc-mcp-knowledge/src/auth.ts")).toMatch(/jeTokenKlientaMcp\(/);
    expect(cti("services/svc-mcp-knowledge/src/auth.ts")).toMatch(/maAudienceServeruZnalosti\(/);
  });
});
