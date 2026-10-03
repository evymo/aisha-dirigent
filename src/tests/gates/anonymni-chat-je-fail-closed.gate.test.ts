/**
 * Brána: anonymní chat existuje jen tam, kde ho instance VĚDOMĚ zapnula
 *
 * ⛔ NAMĚŘENO 2026-09-14 (dvě otevřené dveře k robotovi bez přihlášení):
 *   1. WF_DIRIGENT_AGENT měl `chatTrigger` s `public: true` — hostovaný chat
 *      n8n bez ověření, který nevolal žádný klient (rozšíření i gateway volají
 *      webhook `dirigent-agent` s tokenem, workbench `/chat`).
 *   2. svc-ai-chat `/public-chat` ignoroval `{error}` z get_active_channel_config
 *      a četl klíče, které funkce nevrací — přeposílal do n8n i bez AKTIVNÍHO
 *      kanálu, s výchozími limity. Vypnutý kanál nic nezavíral. Navíc posílal
 *      `channel_slug`, zatímco WF_PUBLIC_CHATBOT čte `body.channel` → workflow
 *      použil kanál 'default', ne ten, který route ověřila.
 *   Jednotkové testy route RPC podvrhovaly tvarem, který SQL nikdy nevrací —
 *   proto tu brána čte SQL, route i workflow přímo.
 *
 * CO BRÁNA HLÍDÁ (čtením zdrojů, bez podprocesu):
 *   1. žádný workflow nemá chatTrigger s `public: true` (anonymní vstup vede
 *      jedině přes `/public-chat` s aktivním kanálem)
 *   2. route čte z výsledku get_active_channel_config jen klíče, které SQL vrací
 *   3. limity, které route čte z `guardrails`, jsou ve výchozím tvaru sloupce
 *   4. kanál, který route ověří, je ten, který workflow čte
 *
 * Chování fail-closed (404 / 503, nic se nepřepošle) měří
 * services/svc-ai-chat/src/tests/routes/public-and-models.unit.test.ts.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKFLOW_DIRS = ["n8n/workflows", "packages/n8n-nodes-aisha/workflows"];
const ROUTE = readFileSync(join(ROOT, "services/svc-ai-chat/src/routes/public-chat.ts"), "utf8").replace(/\/\/.*$/gm, "");
const SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/get_active_channel_config.sql"), "utf8");
const TABULKA = readFileSync(join(ROOT, "aisha/db/sql/tables/public_chat_channels.sql"), "utf8");

type Uzel = { name: string; type: string; parameters?: Record<string, unknown> };
const workflowy = WORKFLOW_DIRS.flatMap((d) =>
  readdirSync(join(ROOT, d))
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ soubor: `${d}/${f}`, wf: JSON.parse(readFileSync(join(ROOT, d, f), "utf8")) as { nodes?: Uzel[] } })),
);

describe("anonymní chat je fail-closed", () => {
  test("brána vidí workflow (jinak by měřila prázdnou množinu)", () => {
    expect(workflowy.length).toBeGreaterThan(50);
    expect(workflowy.some((w) => w.soubor.endsWith("WF_DIRIGENT_AGENT.json"))).toBe(true);
  });

  test("žádný chatTrigger není veřejný", () => {
    const verejne = workflowy.flatMap(({ soubor, wf }) =>
      (wf.nodes ?? [])
        .filter((n) => n.type === "@n8n/n8n-nodes-langchain.chatTrigger" && n.parameters?.public === true)
        .map((n) => `${soubor} → ${n.name}`),
    );
    expect(
      verejne,
      "Veřejný chatTrigger = robot bez přihlášení přímo v n8n, mimo kanál, limity i AITG guard.\n" +
        "Přihlášení klienti volají webhook s tokenem; anonymní návštěvník smí jen přes /public-chat\n" +
        "s AKTIVNÍM kanálem. Nastav `public: false`.",
    ).toEqual([]);
  });

  test("route čte z get_active_channel_config jen klíče, které SQL vrací", () => {
    const vracene = new Set([
      ...[...SQL.matchAll(/'([a-z_]+)',\s*v_channel\./g)].map((m) => m[1]),
      ...[...SQL.matchAll(/jsonb_build_object\('([a-z_]+)',\s*'/g)].map((m) => m[1]),
    ]);
    expect(vracene.has("guardrails") && vracene.has("error"), "parser SQL nenašel guardrails/error").toBe(true);
    const ctene = [...new Set([...ROUTE.matchAll(/channelConfig\??\.([a-z_]+)/g)].map((m) => m[1]))];
    expect(ctene.length, "route nečte channelConfig — brána by neměřila nic").toBeGreaterThan(0);
    expect(
      ctene.filter((k) => !vracene.has(k)),
      "Route čte klíč, který get_active_channel_config nevrací → vždy undefined → tichá výchozí hodnota.",
    ).toEqual([]);
  });

  test("limity z guardrails jsou ve výchozím tvaru sloupce", () => {
    const vychozi = TABULKA.match(/guardrails\s+jsonb NOT NULL DEFAULT '(\{[\s\S]*?\})'::jsonb/);
    expect(vychozi, "výchozí guardrails v public_chat_channels.sql nenalezeny").not.toBeNull();
    const klice = Object.keys(JSON.parse(vychozi![1]));
    const ctene = [...new Set([...ROUTE.matchAll(/guardrails\??\.([a-z_]+)/g)].map((m) => m[1]))];
    expect(ctene).toEqual(expect.arrayContaining(["max_message_length", "rate_limit_per_minute"]));
    expect(ctene.filter((k) => !klice.includes(k))).toEqual([]);
  });

  test("ověřený kanál je ten, který WF_PUBLIC_CHATBOT čte", () => {
    const wf = workflowy.find((w) => w.soubor === "n8n/workflows/WF_PUBLIC_CHATBOT.json")!.wf;
    const kod = (wf.nodes ?? []).map((n) => String(n.parameters?.jsCode ?? "")).join("\n");
    expect(kod, "WF_PUBLIC_CHATBOT už nečte body.channel — uprav bránu i route současně").toMatch(/body\.channel\b/);
    expect(ROUTE).toMatch(/JSON\.stringify\(\{[\s\S]*?\bchannel:\s*slug\b/);
    expect(ROUTE).toMatch(/get_active_channel_config',\s*\{\s*p_channel_slug:\s*slug\s*\}/);
  });
});
