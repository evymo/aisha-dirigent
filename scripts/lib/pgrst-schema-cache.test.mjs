import { describe, expect, test } from "vitest";
import { schemaCacheSeNacita, sOpakovanimPriNacitaniSchematu } from "../plugins/pgrst-schema-cache.mjs";

const PGRST002 = JSON.stringify({ code: "PGRST002", details: null, hint: null, message: "Could not query the database for the schema cache. Retrying." });
const odpoved = (status, telo) => new Response(telo, { status, headers: { "Content-Type": "application/json" } });
const bezCekani = { cekej: async () => {} };

describe("schemaCacheSeNacita", () => {
  test("pozná 503 PGRST002", () => {
    expect(schemaCacheSeNacita(503, PGRST002)).toBe(true);
  });
  test("jiná 503 ani jiný status s PGRST002 to nejsou", () => {
    expect(schemaCacheSeNacita(503, '{"message":"upstream down"}')).toBe(false);
    expect(schemaCacheSeNacita(500, PGRST002)).toBe(false);
  });
});

describe("sOpakovanimPriNacitaniSchematu", () => {
  test("PGRST002 zopakuje a vrátí první úspěch", async () => {
    const fronta = [odpoved(503, PGRST002), odpoved(503, PGRST002), odpoved(200, "{}")];
    let volani = 0;
    const r = await sOpakovanimPriNacitaniSchematu(async () => (volani += 1, fronta.shift()), bezCekani);
    expect(r.status).toBe(200);
    expect(volani).toBe(3);
  });

  test("jinou chybu NEopakuje — vrátí ji hned i s čitelným tělem", async () => {
    let volani = 0;
    const r = await sOpakovanimPriNacitaniSchematu(async () => (volani += 1, odpoved(401, '{"message":"Not authenticated"}')), bezCekani);
    expect(volani).toBe(1);
    expect(await r.text()).toContain("Not authenticated");
  });

  test("po vyčerpání pokusů vrátí poslední odpověď (selhání zůstane vidět)", async () => {
    let volani = 0;
    const r = await sOpakovanimPriNacitaniSchematu(async () => (volani += 1, odpoved(503, PGRST002)), { ...bezCekani, pokusu: 3 });
    expect(volani).toBe(3);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("PGRST002");
  });
});
