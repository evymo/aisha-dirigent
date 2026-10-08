/**
 * Brána: stráž story u pěti RPC nemá obchvat přes service klíč
 *
 * ⛔ NAMĚŘENO 2026-09-14: transition_story_delivery_status, get_allowed_transitions,
 * moderate_development_flow, mcp_get_compliance_context a generate_copilot_instructions
 * nekontrolovaly story; teď je hlídá `can_access_story`. Ten ale service_role
 * pouští VŽDY (strojová lane). Kdo tyto funkce zavolá service klíčem jménem
 * uživatele, stráž obejde — a uživatel přes něj dostane cizí story.
 *
 * Nástroje nad těmito RPC se do svc-mcp-knowledge teprve portují (krok 3b plánu
 * MCP Client Tool). Tahle brána tomu dává hranici předem:
 *   1. služby volají tyto RPC JEN identitou uživatele (rpcUserClaims), nikdy rpcService
 *   2. n8n workflow je nevolá přímo přes /rest/v1/rpc (service klíč v prostředí n8n)
 *   3. volající se service credential jsou známý výčet — přibýt smí jen vědomě
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FUNKCE = [
  "transition_story_delivery_status",
  "get_allowed_transitions",
  "moderate_development_flow",
  "mcp_get_compliance_context",
  "generate_copilot_instructions",
];
const JMENO = FUNKCE.join("|");

/**
 * Volající se service credential, o kterých se ví (stav 2026-09-14):
 * n8n uzly berou `serviceRoleKey` z credential aishaPostgrestApi; skript je
 * operátorský smoke test nad DB. Přesun na identitu uživatele = krok 5 plánu.
 */
const ZNAMI_SLUZEBNI_VOLAJICI = [
  "packages/n8n-nodes-aisha/nodes/AishaRpc/AishaRpc.node.ts",
  "packages/n8n-nodes-aisha/nodes/AishaStoryManager/AishaStoryManager.node.ts",
  "scripts/finalize-production-kb.mjs",
];

function soubory(adresar: string, pripony: RegExp): string[] {
  const abs = join(ROOT, adresar);
  if (!existsSync(abs)) return [];
  const ven: string[] = [];
  const projdi = (d: string) => {
    for (const jmeno of readdirSync(d)) {
      if (jmeno === "node_modules" || jmeno === "dist" || jmeno === "__tests__" || jmeno === "tests") continue;
      const cesta = join(d, jmeno);
      if (statSync(cesta).isDirectory()) projdi(cesta);
      else if (pripony.test(jmeno) && !/\.test\.[cm]?[jt]s$/.test(jmeno)) ven.push(relative(ROOT, cesta));
    }
  };
  projdi(abs);
  return ven;
}

const bezKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Zmínka jména v KATALOGOVÉM dotazu nad pg_proc (`proname IN ('…', …)` / `proname = '…'`) není volání:
 * skript se ptá, jak funkce VYPADÁ (prosrc, signatura), nespouští ji — žádná identita, žádný příběh.
 * NAMĚŘENO 2026-10-05 (dávka 4b): scripts/db/verify-upgrade-apply.sh má v katalogovém dotazu výčet
 * čtenářů expertních pravidel (kontrola, že všichni volají expert_rule_visible_to) a brána ho hlásila
 * jako služebního volajícího. Přidat ho do výčtu by bránu pro CELÝ soubor oslepilo; proto se odečte jen
 * katalogová zmínka — volání v témže souboru (`SELECT public.x(…)`, `rpc/x`, `'x'` mimo katalog) vidí dál.
 */
// Odečítá se JEN výčet řetězcových literálů — výraz v závorce (poddotaz, volání) zůstává vidět.
const bezKatalogu = (s: string) =>
  s.replace(/\bproname\s*(?:=\s*'[^']*'|IN\s*\(\s*'[^']*'(?:\s*,\s*'[^']*')*\s*\))/gi, " ");
/** Volání (nebo předání jména k volání) hlídané RPC: jméno v uvozovkách, `jméno(` nebo cesta PostgREST `rpc/jméno`. */
const VOLANI = new RegExp(`['"\`](${JMENO})['"\`]|\\b(${JMENO})\\s*\\(|\\brpc/(${JMENO})\\b`);
const jeVolani = (text: string) => VOLANI.test(bezKatalogu(bezKomentaru(text)));

describe("stráž story nemá obchvat přes service klíč", () => {
  test("služby tyto RPC nevolají přes rpcService", () => {
    const sluzby = soubory("services", /\.[cm]?[jt]s$/);
    expect(sluzby.length, "brána nevidí zdroje služeb — měřila by prázdno").toBeGreaterThan(100);
    const nalez = sluzby.filter((f) =>
      new RegExp(`rpcService\\s*(<[^>]*>)?\\s*\\(\\s*['"\`](${JMENO})['"\`]`).test(bezKomentaru(readFileSync(join(ROOT, f), "utf8"))),
    );
    expect(
      nalez,
      "rpcService běží jako service_role → can_access_story ho pustí ke KAŽDÉ story.\n" +
        "Nástroj jménem uživatele musí volat rpcUserClaims (identita volajícího nebo PAT).",
    ).toEqual([]);
  });

  test("n8n workflow je nevolají přímo přes /rest/v1/rpc", () => {
    const workflowy = ["n8n/workflows", "packages/n8n-nodes-aisha/workflows"].flatMap((d) => soubory(d, /\.json$/));
    expect(workflowy.length).toBeGreaterThan(50);
    const nalez = workflowy.filter((f) => new RegExp(`rpc/(${JMENO})\\b`).test(readFileSync(join(ROOT, f), "utf8")));
    expect(nalez, "Workflow s service klíčem by stráž obešel — volej nástroj přes /mcp s PAT agenta.").toEqual([]);
  });

  test("volající se service credential jsou jen známý výčet", () => {
    const kandidati = [
      ...soubory("packages/n8n-nodes-aisha/nodes", /\.ts$/),
      ...soubory("scripts", /\.(mjs|js|ts|sh|py)$/),
    ];
    const nalez = kandidati.filter((f) => jeVolani(readFileSync(join(ROOT, f), "utf8")));
    // Generátor nástrojů a most nesou jména jako MCP nástroje v textu pro LLM (ne volání RPC)
    // a jsou určené k vyřazení (krok 6 plánu MCP Client Tool).
    const MCP_TEXTY = ["scripts/deploy-individual-tools.mjs", "scripts/deploy-mcp-bridge.mjs"];
    const bezGeneratoru = nalez.filter((f) => !MCP_TEXTY.includes(f)).sort();
    expect(
      bezGeneratoru,
      "Nový volající těchto RPC mimo identitu uživatele. Service klíč obchází can_access_story —\n" +
        "buď volej identitou uživatele, nebo ho sem přidej s odůvodněním (a hlídej story sám).",
    ).toEqual([...ZNAMI_SLUZEBNI_VOLAJICI].sort());
  });

  test("měřidlo: katalogový dotaz volání není, volání ano — i v témže souboru (kotva)", () => {
    // Kontrolní vzorky tvarů.
    expect(jeVolani("SELECT public.moderate_development_flow('a'::uuid)")).toBe(true);
    expect(jeVolani("curl -s \"$API/rest/v1/rpc/get_allowed_transitions\" -H \"apikey: $K\"")).toBe(true);
    expect(jeVolani("await rpc('generate_copilot_instructions', { p_story_id })")).toBe(true);
    expect(jeVolani("SELECT 1 FROM pg_proc WHERE proname IN ('assess_code_quality', 'mcp_get_compliance_context') AND prosrc LIKE '%x%'")).toBe(false);
    expect(jeVolani("SELECT oid FROM pg_proc WHERE proname = 'transition_story_delivery_status'")).toBe(false);
    expect(jeVolani("WHERE proname IN ('moderate_development_flow'); SELECT public.moderate_development_flow(NULL)")).toBe(true);
    // Odečet nesmí spolknout výraz v závorce: poddotaz s voláním za `proname IN (` je volání.
    expect(jeVolani("WHERE proname IN ((SELECT public.moderate_development_flow(NULL)))")).toBe(true);
    expect(jeVolani("WHERE proname IN ('a', public.moderate_development_flow(NULL))")).toBe(true);
    // Skutečný soubor, kvůli kterému odečet vznikl: katalog ho nehlásí, přidané volání ano —
    // soubor tedy NENÍ vyjmutý, jen jeho katalogová zmínka.
    const overeni = readFileSync(join(ROOT, "scripts/db/verify-upgrade-apply.sh"), "utf8");
    expect(overeni, "kotva: soubor jmenuje hlídanou RPC v katalogovém dotazu").toMatch(/proname IN \([^)]*'moderate_development_flow'/);
    expect(new RegExp(`['"\`](${JMENO})['"\`]`).test(bezKomentaru(overeni)), "kontrolní vzorek: bez odečtu katalogu by ho brána hlásila").toBe(true);
    expect(jeVolani(overeni)).toBe(false);
    expect(jeVolani(`${overeni}\nn=$(scalar "SELECT public.moderate_development_flow('x'::uuid)")\n`)).toBe(true);
    expect(jeVolani(`${overeni}\ncurl -s "$API/rest/v1/rpc/mcp_get_compliance_context"\n`)).toBe(true);
  });
});
