import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { rozeberCredentialsLog, sestavVerdikt } from "./bootstrap-verdikt.mjs";

// Tvar výpisu scripts/n8n/provision-credentials.mjs (řádky skip + závěrečné done).
const VYPIS = `n8n: 3 existing credentials at http://fixture-n8n:5678
✨ created "AISHA PostgREST" [aishaPostgrestApi]
⚠️  skip "GitHub account" [githubApi] — missing env: GITHUB_API_TOKEN
⚠️  skip "AISHA NocoDB" [aishaNocoDbApi] — missing env: NOCODB_URL, NOCODB_API_TOKEN
done: 1 created, 3 already present, 2 skipped (missing env)
`;

describe("verdikt bootstrapu n8n", () => {
  test("výpis credentials → počty a jména přeskočených s chybějícími vstupy", () => {
    const r = rozeberCredentialsLog(VYPIS);
    expect(r.precteno).toBe(true);
    expect([r.zalozeno, r.existovalo, r.preskoceno]).toEqual([1, 3, 2]);
    expect(r.preskocene).toEqual([
      { nazev: "GitHub account", typ: "githubApi", chybi: ["GITHUB_API_TOKEN"] },
      { nazev: "AISHA NocoDB", typ: "aishaNocoDbApi", chybi: ["NOCODB_URL", "NOCODB_API_TOKEN"] },
    ]);
  });

  test("nečitelný výpis NENÍ „nic se nepřeskočilo“ — verdikt je selhání credentials", () => {
    const r = rozeberCredentialsLog("<html>fatal</html>");
    expect(r.precteno).toBe(false);
    const v = sestavVerdikt({ klicRc: 0, typyRc: 0, credentialsRc: 0, workflowsRc: 0, credentials: r });
    expect(v.status).toBe("failure");
    expect(v.detail.selhalo).toEqual(["credentials"]);
  });

  test("chybějící vstupy obsluhy samy verdikt neshodí, ale nesou se v detailu", () => {
    const v = sestavVerdikt({ klicRc: 0, typyRc: 0, credentialsRc: 0, workflowsRc: 0, credentials: rozeberCredentialsLog(VYPIS) });
    expect(v.status).toBe("success");
    expect(v.chyba).toBeNull();
    expect(v.detail.credentials.preskocene).toHaveLength(2);
  });

  test("selhaná pověření nesou v detailu jen jméno a typ, text chyby ne", () => {
    const vypis = `n8n: 0 existing credentials at http://fixture-n8n:5678
❌ "AISHA PostgREST" [aishaPostgrestApi] — POST /credentials → 400: {"message":"fixture-chyba-s-textem"}
❌ "AISHA Webhook Auth" [httpHeaderAuth] — chybí env, které doručuje platforma: N8N_WEBHOOK_AUTH_TOKEN
✨ created "Anthropic API" [httpHeaderAuth]
done: 1 created, 0 already present, 0 skipped (missing env), 2 failed
SELHALO 2 pověření: aishaPostgrestApi::AISHA PostgREST, httpHeaderAuth::AISHA Webhook Auth
`;
    const r = rozeberCredentialsLog(vypis);
    expect(r.precteno).toBe(true);
    expect(r.selhane).toEqual([
      { nazev: "AISHA PostgREST", typ: "aishaPostgrestApi" },
      { nazev: "AISHA Webhook Auth", typ: "httpHeaderAuth" },
    ]);
    const v = sestavVerdikt({ klicRc: 0, typyRc: 0, credentialsRc: 1, workflowsRc: 0, credentials: r });
    expect(v.status).toBe("failure");
    expect(v.detail.credentials.selhane).toHaveLength(2);
    expect(JSON.stringify(v)).not.toContain("fixture-chyba-s-textem");
  });

  test("selhání kteréhokoli kroku = error se jménem kroku", () => {
    const v = sestavVerdikt({ klicRc: 1, typyRc: 1, credentialsRc: 1, workflowsRc: 1, credentials: rozeberCredentialsLog(VYPIS) });
    expect(v.status).toBe("failure");
    expect(v.detail.selhalo).toEqual(["api-klic", "typy", "credentials", "workflows"]);
    expect(v.chyba).toContain("api-klic");
  });

  test("stav verdiktu je vždy z CHECK tabulky integration_service_logs (jinak ho DB odmítne)", () => {
    const sql = readFileSync(new URL("../../aisha/db/sql/tables/integration_service_logs.sql", import.meta.url), "utf8");
    const m = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
    expect(m, "CHECK na status v SoT tabulky nenalezen — měřidlo přestalo vidět").toBeTruthy();
    const povolene = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    for (const kroky of [
      { klicRc: 0, typyRc: 0, credentialsRc: 0, workflowsRc: 0 },
      { klicRc: 1, typyRc: 0, credentialsRc: 0, workflowsRc: 0 },
      { klicRc: 0, typyRc: 1, credentialsRc: 1, workflowsRc: 1 },
    ]) {
      const v = sestavVerdikt({ ...kroky, credentials: rozeberCredentialsLog(VYPIS) });
      expect(povolene, `stav „${v.status}" tabulka odmítne (povoleno: ${povolene.join(", ")})`).toContain(v.status);
    }
  });
});
