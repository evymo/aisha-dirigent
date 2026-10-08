/**
 * Brána: KB hledání s příběhem neběží pod službou se story z požadavku ani z claimu (B8).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: `mcp_search_knowledge_v2/v3` ověřují přístup
 * k `p_story_id` jen pro authenticated — pod service_role kontrolu PŘESKAKUJÍ. svc-mcp-knowledge
 * je volal přes rpcService se story z claimu tokenu a /v1 do claimu dával story z těla
 * požadavku bez ověření → kdo znal UUID cizího příběhu, dostal jeho KB.
 *
 * Co brána drží (vzor story-straz-nema-obchvat):
 *   1. svc-mcp-knowledge volá v2/v3 v searchKnowledgeProd JEN identitou uživatele
 *      (rpcUserClaims s auth.user.claims) — stráž příběhu v RPC pak platí i pro špatný claim.
 *   2. Volající v2/v3 v kódu (služby, balíčky, n8n, skripty) jsou známý výčet s důvodem;
 *      nový služební volající přibýt smí jen vědomě, zastaralá položka se musí smazat.
 *   3. SQL funkce, která v2/v3 volá uvnitř (pod definerem), ověří žadatele PŘED voláním.
 *   4. /v1 (authenticateOmni) i /chat ověří story z požadavku přes can_access_story pod
 *      uživatelem dřív, než ho použijí.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const RPC = /mcp_search_knowledge_v[23]\b/;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const bezKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Známí volající v2/v3 mimo uživatelskou cestu (stav 2026-10-01). Každý s důvodem, proč
 * nevezme story z požadavku ani z claimu. Přesun na identitu uživatele = vědomé rozhodnutí.
 */
const ZNAMI_VOLAJICI: Record<string, string> = {
  "services/svc-mcp-knowledge/src/routes/mcp.ts": "searchKnowledgeProd — identitou uživatele (bod 1)",
  "services/svc-mcp-knowledge/src/routes/rag-eval.ts": "jen služební routa (verifyServiceRole), story ze zlaté sady v DB",
  "packages/n8n-nodes-aisha/nodes/AishaRpc/AishaRpc.node.ts": "obecný uzel n8n se service credential — workflow píše operátor",
  "n8n/workflows/WF_GUILD_MATCH.json": "globální hledání bez p_story_id",
  "packages/n8n-nodes-aisha/workflows/WF_GUILD_MATCH.json": "kopie téhož workflow, bez p_story_id",
  "scripts/test-brain-wiring.sh": "operátorský smoke test (ověřuje, že anon dostane 42501)",
  "scripts/db/verify-upgrade-apply.sh": "DB nástroj: kouřový běh funkce bez příběhu",
};

const KOREN = ["services", "packages", "n8n", "scripts"];
const PRIPONY = /\.(ts|mts|js|mjs|cjs|json|sh)$/;

function soubory(): string[] {
  const ven: string[] = [];
  const projdi = (d: string) => {
    for (const jmeno of readdirSync(d)) {
      if (["node_modules", "dist", "tests", "__tests__", "coverage"].includes(jmeno)) continue;
      const cesta = join(d, jmeno);
      if (statSync(cesta).isDirectory()) projdi(cesta);
      else if (PRIPONY.test(jmeno) && !/\.(test|spec)\.[cm]?[jt]s$/.test(jmeno)) ven.push(relative(ROOT, cesta));
    }
  };
  for (const k of KOREN) if (existsSync(join(ROOT, k))) projdi(join(ROOT, k));
  return ven;
}

/** Soubory, které v2/v3 skutečně jmenují (v kódu, ne v komentáři TS/JS). */
function volajici(): string[] {
  return soubory().filter((rel) => {
    const src = read(rel);
    if (!RPC.test(src)) return false;
    return /\.(json|sh)$/.test(rel) ? true : RPC.test(bezKomentaru(src));
  });
}

describe("KB hledání s příběhem jen pod uživatelem (B8)", () => {
  it("searchKnowledgeProd volá v3 identitou uživatele, nikdy rpcService (a v2 vůbec — P2 bez textové zálohy)", () => {
    const src = read("services/svc-mcp-knowledge/src/routes/mcp.ts");
    const start = src.indexOf("async function searchKnowledgeProd");
    const telo = src.slice(start, src.indexOf("async function callTool", start));
    expect(start, "searchKnowledgeProd nenalezen — měřidlo slepé").toBeGreaterThan(0);
    expect(telo, "mcp_search_knowledge_v3 musí jít přes rpcUserClaims").toMatch(/rpcUserClaims\(\s*'mcp_search_knowledge_v3'/);
    expect(telo, "mcp_search_knowledge_v3 nesmí jít přes rpcService").not.toMatch(/rpcService\(\s*'mcp_search_knowledge_v3'/);
    // P2 (2026-10-06): textová záloha v2 při výpadku embeddingu je zrušená — hledání selže nahlas.
    expect(bezKomentaru(telo), "searchKnowledgeProd nesmí volat textové hledání v2 (tichá záloha)").not.toMatch(/mcp_search_knowledge_v2/);
    expect((telo.match(/},\s*auth\.user\.claims\)/g) ?? []).length, "volání v3 nese claims ověřeného tokenu").toBe(1);
    expect(bezKomentaru(src), "v mcp.ts nikde rpcService na v2/v3").not.toMatch(/rpcService\(\s*'mcp_search_knowledge_v[23]'/);
  });

  it("volající v2/v3 jsou známý výčet — nový přibýt smí jen vědomě", () => {
    const nalezeni = volajici();
    expect(nalezeni.length, "měřidlo musí vidět aspoň mcp.ts a rag-eval.ts (kontrolní vzorek)").toBeGreaterThanOrEqual(2);
    expect(nalezeni.filter((rel) => !(rel in ZNAMI_VOLAJICI)), "nový volající KB RPC — jen identitou uživatele, nebo do výčtu s důvodem").toEqual([]);
    expect(Object.keys(ZNAMI_VOLAJICI).filter((rel) => !nalezeni.includes(rel)), "zastaralá položka — smaž ji z výčtu").toEqual([]);
  });

  it("SQL volající v2/v3 ověří žadatele PŘED voláním", () => {
    const adresar = join(ROOT, "aisha/db/sql/functions");
    const sqlVolajici = readdirSync(adresar)
      .filter((f) => f.endsWith(".sql") && !/^mcp_search_knowledge_v[23]\.sql$/.test(f))
      .filter((f) => /mcp_search_knowledge_v[23]\s*\(/.test(readFileSync(join(adresar, f), "utf-8").replace(/--.*$/gm, "")));
    expect(sqlVolajici, "nový SQL volající — přidej sem jeho stráž").toEqual(["compose_context.sql"]);
    const cc = readFileSync(join(adresar, "compose_context.sql"), "utf-8").replace(/--.*$/gm, "");
    // Tvar stráže z mainu 2026-10-05 (přísnější než při vzniku brány): žadatele jmenuje jen služba,
    // přihlášený je připnutý na sebe; s příběhem bez žadatele nebo bez přístupu = 42501.
    const pripnuti = cc.search(/v_requester := CASE\s+WHEN public\.get_jwt_role\(\) = 'service_role' THEN COALESCE\(p_requester_id, auth\.uid\(\)\)\s+ELSE auth\.uid\(\)/);
    expect(pripnuti, "compose_context: žadatel musí být pro přihlášeného připnutý na auth.uid()").toBeGreaterThan(0);
    const straz = cc.search(/IF p_story_id IS NOT NULL THEN\s+IF v_requester IS NULL THEN[\s\S]{0,200}?42501[\s\S]{0,400}?partner_stories[\s\S]{0,300}?Access denied to story/);
    const volani = cc.search(/mcp_search_knowledge_v2\s*\(/);
    expect(straz, "compose_context: stráž žadatele chybí").toBeGreaterThan(0);
    expect(straz, "compose_context: stráž musí být před voláním v2").toBeLessThan(volani);
  });

  it("/v1 i /chat ověří story z požadavku přes can_access_story dřív, než ho použijí", () => {
    const omni = bezKomentaru(read("services/svc-ai-chat/src/routes/omniAuth.ts"));
    expect(omni).toMatch(/userCanAccessStory\(identity\.userId,\s*bodyStory\)[\s\S]{0,80}story_forbidden/);
    const chat = bezKomentaru(read("services/svc-ai-chat/src/routes/chat.ts"));
    const overeni = chat.search(/canAccessStory\(pgrestUser,\s*explicitStoryId\.trim\(\)\)/);
    expect(overeni, "chat.ts: story z požadavku se neověřuje").toBeGreaterThan(0);
    // první uložení i první použití příběhu přijdou až po ověření
    for (const pouziti of [
      /rpc\('create_chat_conversation_audited'/,
      /rpc\('save_chat_message_audited'/,
      /resolveChatStoryId\(pgrestUser,\s*explicitStoryId\)/,
    ]) {
      const i = chat.search(pouziti);
      expect(i, `chat.ts: ${pouziti} nenalezeno — měřidlo slepé`).toBeGreaterThan(0);
      expect(overeni, `ověření musí předcházet ${pouziti}`).toBeLessThan(i);
    }
    const access = read("services/svc-ai-chat/src/lib/storyAccess.ts");
    expect(access).toMatch(/rpc<boolean>\("can_access_story"/);
  });
});
