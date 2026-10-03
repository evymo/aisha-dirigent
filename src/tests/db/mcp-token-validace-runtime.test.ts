/**
 * validate_mcp_token na SKUTEČNÉ databázi — tvar výsledku, na kterém stojí PAT lane /mcp.
 *
 * ⛔ NAMĚŘENO 2026-09-14: svc-mcp-knowledge (auth.ts verifyMcpPat) vymáhá
 * tools/list i tools/call podle `allowed_tools` / `denied_tools` z výsledku
 * validate_mcp_token. Jednotkové testy služby RPC podvrhují; tady se ověřuje,
 * že funkce ze SoT (baseline → throwaway DB) klíče opravdu vrací, že odmítá
 * neaktivní a expirovaný token a že usage se počítá JEDNOU za volání.
 *
 * Spouští se přes: npm run test:db (with-throwaway-db)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const VLASTNIK = randomUUID();
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const T_AGENT = `mcp_agent_${RUN}`;
const T_NEAKTIVNI = `mcp_neaktivni_${RUN}`;
const T_EXPIROVANY = `mcp_expirovany_${RUN}`;

function svc(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}

const validuj = (token: string, nastroj: string | null = null) =>
  JSON.parse(svc(`SELECT public.validate_mcp_token('${hash(token)}', ${nastroj ? `'${nastroj}'` : "NULL"}, NULL)::text`));

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${VLASTNIK}', 'mcp-pat-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.mcp_auth_tokens (token_hash, scope, allowed_tools, denied_tools, is_active, created_by, user_id, expires_at)
       VALUES ('${hash(T_AGENT)}', 'global', ARRAY['search_knowledge','get_expertise_areas'], ARRAY['get_expertise_areas'], true, '${VLASTNIK}', '${VLASTNIK}', now() + interval '1 day'),
              ('${hash(T_NEAKTIVNI)}', 'global', ARRAY['search_knowledge'], '{}', false, '${VLASTNIK}', '${VLASTNIK}', NULL),
              ('${hash(T_EXPIROVANY)}', 'global', ARRAY['search_knowledge'], '{}', true, '${VLASTNIK}', '${VLASTNIK}', now() - interval '1 minute')`);
});

describe.skipIf(!dbAvailable)("validate_mcp_token (runtime)", () => {
  it("platný token vrací vlastníka a SEZNAMY nástrojů, které lane čte", () => {
    const r = validuj(T_AGENT);
    expect(r).toMatchObject({ valid: true, user_id: VLASTNIK });
    expect(r.allowed_tools).toEqual(["search_knowledge", "get_expertise_areas"]);
    expect(r.denied_tools).toEqual(["get_expertise_areas"]);
  });

  it("neaktivní i expirovaný token → valid:false", () => {
    expect(validuj(T_NEAKTIVNI).valid).toBe(false);
    expect(validuj(T_EXPIROVANY).valid).toBe(false);
  });

  it("jedno volání bez nástroje = jedno navýšení usage (lane nevolá per nástroj)", () => {
    const pred = Number(svc(`SELECT usage_count FROM public.mcp_auth_tokens WHERE token_hash = '${hash(T_AGENT)}'`));
    validuj(T_AGENT);
    const po = Number(svc(`SELECT usage_count FROM public.mcp_auth_tokens WHERE token_hash = '${hash(T_AGENT)}'`));
    expect(po - pred).toBe(1);
  });
});
