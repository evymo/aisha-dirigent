/**
 * Položky dokladu jako tabulka (get_document_lines) — RUNTIME.
 *
 * ⭐ Majitel 2026-09-29: u faktury po prokliku „detail POLOŽEK, ne co je ke schválení".
 * Měří se: položky jako řádky (čísla česky, množství bez koncových nul), třída z katalogu
 * (přímo `classes` i `tridy_z_bloku` = katalog knihy faktur, jedna pravda), a pravdivost
 * v provenienci: součet položek = / ≠ základ bez DPH, položky zdroj nedodal, doklad neexistuje.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const A = `faktura-a-${RUN}`;
const B = `faktura-b-${RUN}`;
const C = `faktura-c-${RUN}`;
const D = `faktura-d-${RUN}`; // haléřové zaokrouhlení
const E = `faktura-e-${RUN}`; // položky včetně DPH
const BLOK = `test-kniha-${RUN}`;
const KATALOG = '[{"key":"N","pattern":"nájem"},{"key":"E","pattern":"elektř|energie"}]';

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const radky = (params: string) => JSON.parse(psql(`SELECT public.get_document_lines('${params}'::jsonb)::text`));
const pol = (i: number, nazev: string, mn: string, mj: string, cena: string, celkem: string) =>
  `{"line_index":${i},"fields":{"item_name":{"value":"${nazev}"},"quantity":{"value":"${mn}"},` +
  `"unit":{"value":"${mj}"},"unit_price":{"value":"${cena}"},"line_total":{"value":"${celkem}"}}}`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("položky dokladu: tabulka se třídou a kontrolou součtu", () => {
  it("příprava: tři faktury a blok knihy s katalogem", () => {
    const polozky = `[${pol(0, "Nájemné za 09/2026", "1", "ks", "1000", "1000")},${pol(1, "Záloha elektřina", "2.5", "kWh", "100", "250")}]`;
    const doc = (slug: string, items: string, zaklad: string) =>
      `('sha-${slug}', '${slug}', 'invoice', '${items}'::jsonb, '{"amount_without_vat":{"value":"${zaklad}"}}'::jsonb)`;
    psql(`INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, line_items, fields) VALUES
          ${doc(A, polozky, "1250")}, ${doc(B, polozky, "999")}, ${doc(C, "[]", "500")},
          ${doc(D, polozky, "1249.60")},
          ('sha-${E}', '${E}', 'invoice', '${polozky}'::jsonb,
           '{"amount_without_vat":{"value":"1033.06"},"total_amount":{"value":"1250"}}'::jsonb)`);
    psql(`INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active) VALUES ('get_document_lines', 'test', true)
          ON CONFLICT (rpc_name) DO NOTHING`);
    psql(`INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active)
          VALUES ('${BLOK}', 'table', 'app.test', 'get_document_lines', '{"classes":${KATALOG}}'::jsonb, 'test', 'internal', true)`);
  });

  it("řádky: text, česká čísla, množství bez koncových nul, třída z katalogu", () => {
    const r = radky(`{"doc_slug":"${A}","classes":${KATALOG}}`);
    expect(r.data.rows).toEqual([
      { poradi: "1", polozka: "Nájemné za 09/2026", mnozstvi: "1", jednotka: "ks", cena: "1 000,00", celkem: "1 000,00", trida: "app.cols.class.N" },
      { poradi: "2", polozka: "Záloha elektřina", mnozstvi: "2,5", jednotka: "kWh", cena: "100,00", celkem: "250,00", trida: "app.cols.class.E" },
    ]);
    expect(r.data.columns.map((c: { key: string }) => c.key)).toEqual(["poradi", "polozka", "mnozstvi", "jednotka", "cena", "celkem", "trida"]);
    expect(r.provenance.coverage).toEqual({ n: 2, m: 2, label_key: "app.prov.coverage.lines_sum_ok" });
  });

  it("katalog z bloku knihy (tridy_z_bloku) = týž výsledek; bez katalogu žádná třída", () => {
    const zBloku = radky(`{"doc_slug":"${A}","tridy_z_bloku":"${BLOK}"}`);
    expect(zBloku.data.rows.map((x: { trida: string }) => x.trida)).toEqual(["app.cols.class.N", "app.cols.class.E"]);
    const bez = radky(`{"doc_slug":"${A}"}`);
    expect(bez.data.columns.map((c: { key: string }) => c.key)).not.toContain("trida");
  });

  it("nezařazená položka = „neurčeno“, ne tiché zmizení", () => {
    const r = radky(`{"doc_slug":"${A}","classes":[{"key":"N","pattern":"nájem"}]}`);
    expect(r.data.rows[1].trida).toBe("app.cols.class.none");
  });

  it("pravdivost: součet nesedí / položky chybí / doklad neexistuje — řečeno, ne ticho", () => {
    expect(radky(`{"doc_slug":"${B}"}`).provenance.coverage.label_key).toBe("app.prov.coverage.lines_sum_mismatch");
    const c = radky(`{"doc_slug":"${C}"}`);
    expect(c.data.rows).toEqual([]);
    expect(c.provenance.coverage).toEqual({ n: 0, m: 0, label_key: "app.prov.coverage.lines_missing" });
    expect(radky(`{"doc_slug":"neni-${RUN}"}`).provenance.trace_id).toBe("doc-lines:not_found");
    // ⛔ riq 2026-09-29: 2 375 faktur do 1 Kč a 190 s hrubými položkami — NEJSOU chyba dokladu
    expect(radky(`{"doc_slug":"${D}"}`).provenance.coverage.label_key).toBe("app.prov.coverage.lines_sum_rounding");
    expect(radky(`{"doc_slug":"${E}"}`).provenance.coverage.label_key).toBe("app.prov.coverage.lines_sum_gross");
  });
});
