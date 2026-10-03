/**
 * Brána: executor akcí po události (F3a) je napojený a jeho kanály sedí se schématem.
 *
 * ⛔ PROČ (naměřeno 2026-09-26): dispečer ai_proactive_trigger_definitions budil
 * `ai_proactive_dispatch`, ale nikdo neposlouchal — běhy ležely pending napořád a nikdo
 * si toho nevšiml, protože „dispečer funguje“. Tahle brána drží tři vlastnosti:
 *
 *  1. event-worker kanál POSLOUCHÁ (jinak budík zase zvoní do prázdna);
 *  2. kanál se v handleNotification odbočí do executoru DŘÍV, než cokoli publikuje
 *     do Redisu (ws-gateway → prohlížeče) nebo projde branou ACS — běh nese data
 *     zdrojového řádku a enforce ACS by budík zahodil;
 *  3. výčet kanálů executoru (jadro.ts KANALY_EXECUTORU) = výčet v SQL CHECK
 *     ai_proactive_defs_executor_principal_check (tabulka i heals) — jinak by nový
 *     kanál šel zapsat bez principála a dispečer by ho tiše přeskakoval.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KANALY_EXECUTORU } from "../../../services/event-worker/src/proaktivni/jadro.js";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");

function kanalyVCheck(sql: string): string[] {
  const i = sql.indexOf("ai_proactive_defs_executor_principal_check");
  expect(i, "CHECK ai_proactive_defs_executor_principal_check chybí").toBeGreaterThanOrEqual(0);
  const m = /ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]/.exec(sql.slice(i));
  expect(m, "CHECK nemá výčet ARRAY[…]").not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe("executor akcí po události — kontrakt", () => {
  it("ai_proactive_dispatch je v registru budíků a budíky jdou do LISTEN", () => {
    const c = cti("services/event-worker/src/config.ts");
    expect(c).toMatch(/\{\s*kanal:\s*'ai_proactive_dispatch',\s*cil:\s*\{\s*druh:\s*'executor'\s*\}\s*\}/);
    expect(c, "pgChannels musí nést kanály z registru budíků").toMatch(/\.\.\.budiky\.map\(\(b\) => b\.kanal\)/);
  });

  it("budíky se odbočí PŘED Redisem, webhooky i branou ACS", () => {
    const w = cti("services/event-worker/src/worker.ts");
    const telo = w.slice(w.indexOf("async function handleNotification"));
    const odbocka = telo.indexOf("config.budiky.find(");
    expect(odbocka, "handleNotification budíky neodbočuje").toBeGreaterThan(0);
    for (const dalsi of ["acsInbound(", "redis.publish(", "config.webhookRoutes", "n8nWebhookUrl"]) {
      const i = telo.indexOf(dalsi);
      expect(i, `${dalsi} v handleNotification nenalezen`).toBeGreaterThan(0);
      expect(odbocka, `odbočka musí být před ${dalsi}`).toBeLessThan(i);
    }
  });

  it("výčet kanálů = SQL CHECK v tabulce i v heals (parita)", () => {
    const ts = [...KANALY_EXECUTORU].sort();
    expect(kanalyVCheck(cti("aisha/db/sql/tables/ai_proactive_trigger_definitions.sql")).sort()).toEqual(ts);
    expect(kanalyVCheck(cti("aisha/db/heals.sql")).sort()).toEqual(ts);
  });

  it("proměnné executoru i adresy budíků jsou v compose event-workeru", () => {
    const c = cti("docker-compose.coolify-realtime.yml");
    const cfg = cti("services/event-worker/src/config.ts");
    const registr = cfg.slice(cfg.indexOf("const budiky"), cfg.indexOf("export const config"));
    const adresy = [...registr.matchAll(/process\.env\['([A-Z0-9_]+)'\]/g)].map((m) => m[1]);
    for (const k of ["PUSH_SERVICE_URL", "PROACTIVE_EXECUTOR", ...adresy]) {
      expect(c, `${k} chybí v compose event-workeru`).toContain(`${k}: \${${k}:-}`);
    }
  });
});
