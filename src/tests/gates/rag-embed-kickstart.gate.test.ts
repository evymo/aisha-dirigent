/**
 * Gate: RAG embed kickstart wired into the cold-start
 *
 * The instance-data overlay (00_kb.sql) loads knowledge_items + expert_rules as
 * TEXT, but their vector embeddings are produced by svc-mcp-knowledge's
 * /embeddings/* routes (normally a weekly n8n cron) — NOT by the seed/overlay. On
 * a fresh stack that means the RAG support content exists but semantic search
 * returns nothing until embeddings are generated. The cold-start now drives both
 * corpora (knowledge + rules) through the gateway /functions/v1 facade as a
 * post-deploy step (idempotent + fail-loud). This gate locks that wiring, the
 * gateway route mappings it depends on, and the rules-embed RPCs it needs.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("RAG embed kickstart — cold-start wiring", () => {
  const coldStart = read("scripts/aisha-cold-start.sh");
  const functionsRoute = read("services/gateway/src/routes/functions.ts");

  test("cold-start posts BOTH corpora to the gateway facade with the service token", () => {
    expect(coldStart).toContain('step "6b. EMBED KICKSTART');
    expect(coldStart).toContain("generate-knowledge-embeddings"); // knowledge_items
    expect(coldStart).toContain("generate-embeddings"); // expert_rules
    expect(coldStart).toMatch(/\/functions\/v1\/\$\{fn\}/);
    expect(coldStart).toMatch(/Authorization: Bearer \$\{SVC_TOKEN\}/);
  });

  test("embed kickstart is idempotent (loop until processed:0) + fail-loud", () => {
    const block = coldStart.slice(
      coldStart.indexOf('step "6b. EMBED'),
      coldStart.indexOf('step "7.'),
    );
    // loops batches until .processed === 0 (drain the corpus)
    expect(block).toMatch(/jq -r '\.processed/);
    expect(block).toMatch(/\[ "\$processed" = "0" \] && break/);
    // Ne-JSON odpověď 2xx NENÍ „nic nezbývá" (dřív `jq … || echo 0`).
    expect(block).toMatch(/jq -e 'type == "object" and \(\.processed \| type == "number"\)/);
    expect(block, "fronta nevyprázdněná ani po stropu dávek musí být nález").toMatch(/fronta NEVYPRÁZDNĚNA/);
    // fail-loud: HTTP/timeout failure → exit 1
    // Fail-loud = zapsat do NEDOKONCENO (konec běhu nenulou), ne `exit 1`, které
    // by přeskočilo úklid warmupu a restart validaci (2026-09-13).
    expect(block).toMatch(/nedokonceno "Embed kickstart \$\{fn\}: HTTP chyba nebo timeout/);
    // fail-loud: any failed item → exit 1
    expect(block).toMatch(/nedokonceno "Embed kickstart \$\{fn\}: \$\{failed\} položek se nepodařilo zaembedovat/);
    // only runs on a real, healthy deploy
    expect(block).toMatch(/\$SKIP_DEPLOY"? = "1"[\s\S]{0,40}\$DRY_RUN/);
  });

  test("kickstart čeká na SVŮJ VSTUP — embedding model prostoru v1 z resolveru, ne na čas", () => {
    // 2026-09-13: svc-model se nasazuje až po ai-chat a stahuje váhy; discovery ho
    // zaregistruje až v další periodě. Kickstart hned po nasazení dostal 503 a skončil
    // „HTTP chyba" u instance, které nic nechybělo.
    const block = coldStart.slice(
      coldStart.indexOf('step "6b. EMBED'),
      coldStart.indexOf('step "7.'),
    );
    const iResolver = block.indexOf("/rest/v1/rpc/fn_resolve_embedding_model_for_space");
    const iKickstart = block.indexOf("for fn in generate-knowledge-embeddings generate-embeddings");
    expect(iResolver, "kickstart se neptá resolveru prostoru").toBeGreaterThan(-1);
    expect(iResolver, "dotaz na model musí předcházet volání embed funkcí").toBeLessThan(iKickstart);
    expect(block).toMatch(/"p_rag_space":"v1"/);
    expect(block, "strop čekání patří do config/cold-start-timeouts.env").toMatch(
      /\$\{AISHA_EMBED_MODEL_TIMEOUT_S:\?config\/cold-start-timeouts\.env\}/,
    );
    expect(read("config/cold-start-timeouts.env")).toMatch(/^AISHA_EMBED_MODEL_TIMEOUT_S=\d+$/m);
    expect(block, "nedorazivší model je NEDOKONČENO s důvodem, ne tiché pokračování").toMatch(
      /nedokonceno "Embed kickstart: embedding model prostoru v1 do/,
    );
  });

  test("gateway ROUTE_TABLE maps the two function-names the kickstart calls", () => {
    // a facade rename would break the kickstart — fail here (offline), not on a wipe
    // ⛔ 2026-08-25: hranice je KONEC ŘÁDKU, ne první `}`. Položky tabulky jsou
    // jednořádkové, takže `[^\n]*` drží stejný záměr (stejný řádek = stejná
    // položka), ale přežije `get upstream() { ... }` — getter dovnitř položky
    // přidal závorku a `[^}]*` se o ni zastavilo dřív než o cestu.
    expect(functionsRoute).toMatch(/'generate-knowledge-embeddings':\s*\{[^\n]*embeddings\/knowledge/);
    expect(functionsRoute).toMatch(/'generate-embeddings':\s*\{[^\n]*embeddings\/rules/);
  });

  test("the rules-embed RPCs now exist as SoT (else /embeddings/rules 500s)", () => {
    expect(existsSync(join(ROOT, "aisha/db/sql/functions/get_rules_for_embedding.sql"))).toBe(true);
    expect(existsSync(join(ROOT, "aisha/db/sql/functions/update_rule_embedding.sql"))).toBe(true);
    // and they are in the regenerated baseline (so a cold-start actually creates them)
    const baseline = read("aisha/db/migrations/00000000000000_baseline.sql");
    expect(baseline).toContain("get_rules_for_embedding");
    expect(baseline).toContain("update_rule_embedding");
  });
});
