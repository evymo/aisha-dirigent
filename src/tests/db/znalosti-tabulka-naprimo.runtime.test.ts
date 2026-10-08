/**
 * Tabulku znalostí NAPŘÍMO (PostgREST) přečte jen ten, komu položka patří — CHOVÁNÍ přes HTTP.
 *
 * ⛔ ZMĚŘENO 2026-10-04. `knowledge_items` měla dvě politiky SELECT, obě PERMISSIVE a
 * TO public; druhá nesla větev `story_id IS NULL`, takže pouštěla KAŽDOU globální položku
 * bez ohledu na status, viditelnost, úroveň členství i karanténu. Přihlášený tak přes
 * `/rest/v1/knowledge_items` přečetl koncepty, soukromé položky, položky s úrovní
 * i položky v karanténě — mimo všechny filtry funkcí. Anonyma nezastavila politika, ale
 * náhoda: dotaz spadl na funkci, kterou anon nesmí spustit.
 *
 * Měří se skutečným PostgRESTem nad zahazovanou databází: anon bez tokenu, přihlášený
 * a správce s raženým tokenem. Každý negativní případ má v TÉMŽE dotazu kotvu (čistá
 * veřejná položka se vrátit musí) — prázdná odpověď bez kotvy by prošla i nad rozbitou
 * tabulkou. Stav se čte z databáze, ne z návratové hodnoty.
 *
 * Sesterské tabulky `knowledge_chunks` a `knowledge_embeddings` mají RLS zapnuté a žádnou
 * politiku — napřímo z nich nepřečte nikdo. Je to připnutá vlastnost: široká politika
 * „aby šlo číst“ by vydala text úryvků i u položek v karanténě.
 *
 * Spouští se přes: npm run test:db:znalosti-tabulka (throwaway DB + throwaway PostgREST)
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const REST = process.env.POSTGREST_URL ?? "";
const TAJEMSTVI = process.env.POSTGREST_JWT_SECRET ?? "";
/**
 * Test potřebuje PostgREST. `npm run test:db:znalosti-tabulka` ho staví a nastavuje
 * ZNALOSTI_TABULKA_POSTGREST=1 — pak je chybějící DB nebo PostgREST vada harnessu, ne důvod
 * přeskočit. V běhu celé sady bez PostgRESTu se soubor přeskočí (tam ho nemá kdo postavit).
 */
const POVINNE = process.env.ZNALOSTI_TABULKA_POSTGREST === "1";
const MA_POSTGREST = Boolean(REST && TAJEMSTVI);
if (!POVINNE && !MA_POSTGREST) {
  // Přeskočení má být ve výstupu sady VIDĚT, ne jen tichý skip.
  console.info("ℹ️  znalosti-tabulka-naprimo: PŘESKOČENO — potřebuje PostgREST; povinné přes npm run test:db:znalosti-tabulka");
}

const RUN = randomUUID().slice(0, 8);
const P = `ZZ-naprimo-${RUN}`;
const BEZNY = randomUUID();
const CIZI = randomUUID();
const SPRAVCE = randomUUID();
const PRIBEH_VLASTNI = randomUUID();
const PRIBEH_CIZI = randomUUID();

/** Položky přípravku: klíč → co je na ní zvláštní. */
const K = {
  cista: randomUUID(), // kotva: globální, aktivní, veřejná, čistá
  members: randomUUID(),
  guild: randomUUID(),
  koncept: randomUUID(),
  soukroma: randomUUID(),
  uroven: randomUUID(),
  karantena: randomUUID(),
  oznacena: randomUUID(),
  ciziPribeh: randomUUID(),
  ciziHodnota: randomUUID(), // core_value v cizím příběhu
  vlastni: randomUUID(),
  vlastniKarantena: randomUUID(),
} as const;
const jmeno = (id: string) => Object.entries(K).find(([, v]) => v === id)?.[0] ?? id;

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    { input: sql, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function token(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const telo = `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64u(
    JSON.stringify({ role: "authenticated", sub, iss: "aisha", iat: now, exp: now + 600 }),
  )}`;
  return `${telo}.${b64u(createHmac("sha256", TAJEMSTVI).update(telo).digest())}`;
}

type Kdo = "anon" | "bezny" | "spravce";
const hlavicky = (kdo: Kdo): Record<string, string> =>
  kdo === "anon" ? {} : { Authorization: `Bearer ${token(kdo === "bezny" ? BEZNY : SPRAVCE)}` };

async function ctiPolozky(kdo: Kdo): Promise<{ status: number; klice: string[]; telo: string }> {
  const r = await fetch(`${REST}/knowledge_items?select=id&title=like.${P}*`, { headers: hlavicky(kdo) });
  const telo = await r.text();
  const klice = r.ok ? (JSON.parse(telo) as { id: string }[]).map((x) => jmeno(x.id)).sort() : [];
  return { status: r.status, klice, telo };
}

describe.skipIf(!POVINNE && !MA_POSTGREST)("tabulka znalostí napřímo přes PostgREST", () => {
  beforeAll(() => {
    if (!MA_POSTGREST || !isPgReachable()) {
      throw new Error("Test má běžet nad zahazovanou DB s PostgRESTem (POSTGREST_URL, POSTGREST_JWT_SECRET, dosažitelná DB), ale něco chybí — vada harnessu, ne důvod přeskočit.");
    }
    const radek = (id: string, co: string, extra: Record<string, string> = {}) => {
      const s = { item_type: "'domain_doc'", status: "'active'", visibility: "'public'", story_id: "NULL", quarantine_status: "'clear'", minimum_tier: "NULL", ...extra };
      return `('${id}', ${s.item_type}, '${P}-${co}', 'tělo ${co}', ${s.status}, ${s.visibility}, ${s.story_id}, ${s.quarantine_status}, ${s.minimum_tier})`;
    };
    psql(`
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${BEZNY}', 'naprimo-bezny-${RUN}@test.local'), ('${CIZI}', 'naprimo-cizi-${RUN}@test.local'), ('${SPRAVCE}', 'naprimo-spravce-${RUN}@test.local')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.partner_stories (id, title, user_id) VALUES
  ('${PRIBEH_VLASTNI}', '${P} vlastní', '${BEZNY}'), ('${PRIBEH_CIZI}', '${P} cizí', '${CIZI}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, status, visibility, story_id, quarantine_status, minimum_tier) VALUES
  ${radek(K.cista, "cista")},
  ${radek(K.members, "members", { visibility: "'members'" })},
  ${radek(K.guild, "guild", { visibility: "'guild'" })},
  ${radek(K.koncept, "koncept", { status: "'draft'" })},
  ${radek(K.soukroma, "soukroma", { visibility: "'private'" })},
  ${radek(K.uroven, "uroven", { minimum_tier: "'partner'" })},
  ${radek(K.karantena, "karantena", { quarantine_status: "'quarantined'" })},
  ${radek(K.oznacena, "oznacena", { quarantine_status: "'flagged'" })},
  ${radek(K.ciziPribeh, "cizi-pribeh", { story_id: `'${PRIBEH_CIZI}'` })},
  ${radek(K.ciziHodnota, "cizi-hodnota", { story_id: `'${PRIBEH_CIZI}'`, item_type: "'core_value'" })},
  ${radek(K.vlastni, "vlastni", { story_id: `'${PRIBEH_VLASTNI}'` })},
  ${radek(K.vlastniKarantena, "vlastni-karantena", { story_id: `'${PRIBEH_VLASTNI}'`, quarantine_status: "'quarantined'" })};
INSERT INTO public.knowledge_chunks (knowledge_item_id, chunk_index, chunk_text) VALUES
  ('${K.cista}', 0, 'úryvek ${P}'), ('${K.guild}', 0, 'úryvek guild ${P}');`);
  });

  it("anonym dostane odpověď (ne chybu) a v ní jen aktivní globální položky `public` v čitelném stavu", async () => {
    const r = await ctiPolozky("anon");
    expect(r.status, `anonym má být zastaven predikátem, ne chybou: ${r.telo.slice(0, 200)}`).toBe(200);
    // `members` vidí jen přihlášený (rozhodnutí majitele 2026-10-04) — nepřihlášený jen `public`.
    expect(r.klice).toEqual(["cista"]);
  });

  it("přihlášený dostane globální čitelnou vrstvu a své položky příběhu — nic dalšího", async () => {
    const r = await ctiPolozky("bezny");
    expect(r.status).toBe(200);
    // Kotva i zákaz v jednom dotazu: čistá veřejná tam je; koncept, soukromá, guild, s úrovní,
    // v karanténě, označená, cizí příběh ani core_value cizího příběhu tam nejsou.
    expect(r.klice).toEqual(["cista", "members", "vlastni", "vlastniKarantena"]);
  });

  it("správa přečte všechno — i koncept, soukromou a položku v karanténě", async () => {
    const r = await ctiPolozky("spravce");
    expect(r.status).toBe(200);
    expect(r.klice).toEqual(Object.keys(K).sort());
  });

  it("položku `guild` nevydá přihlášenému bez profilu partnera tabulka ani hledání (hledání ji dává jen gildě)", () => {
    const pres = psql(`
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${BEZNY}"}', true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM jsonb_path_query(
  public.mcp_search_knowledge_v2(p_query_text => '${P}-guild', p_story_id => NULL::uuid),
  '$.** ? (@.knowledge_item_id == "${K.guild}")');
ROLLBACK;`);
    expect(Number(pres.split("\n").pop()), "hledání v2 vydalo položku `guild` přihlášenému, který není v gildě").toBe(0);
  });

  it("přihlášený do tabulky nezapíše: vložit, změnit ani smazat nejde", async () => {
    const h = { ...hlavicky("bezny"), "Content-Type": "application/json", Prefer: "return=representation" };
    const vloz = await fetch(`${REST}/knowledge_items`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ item_type: "domain_doc", title: `${P}-podvrh`, body_markdown: "x" }),
    });
    expect(vloz.ok, `vložení mělo být odmítnuto, vrátilo ${vloz.status}`).toBe(false);
    await fetch(`${REST}/knowledge_items?id=eq.${K.cista}`, { method: "PATCH", headers: h, body: JSON.stringify({ body_markdown: "přepsáno" }) });
    await fetch(`${REST}/knowledge_items?id=eq.${K.members}`, { method: "DELETE", headers: h });
    const stav = psql(`SELECT
      (SELECT count(*) FROM public.knowledge_items WHERE title = '${P}-podvrh') || '|' ||
      (SELECT body_markdown FROM public.knowledge_items WHERE id = '${K.cista}') || '|' ||
      (SELECT count(*) FROM public.knowledge_items WHERE id = '${K.members}')`);
    expect(stav, "podvržených řádků | tělo čisté položky | položka members existuje").toBe("0|tělo cista|1");
  });

  it.each(["knowledge_chunks", "knowledge_embeddings"])("%s napřímo nepřečte anonym ani přihlášený", async (tabulka) => {
    // Kontrolní vzorek: úryvek v databázi JE (jinak by prázdná odpověď nic neříkala).
    expect(psql(`SELECT count(*) FROM public.knowledge_chunks WHERE knowledge_item_id = '${K.cista}'`)).toBe("1");
    for (const kdo of ["anon", "bezny"] as const) {
      const r = await fetch(`${REST}/${tabulka}?select=id&limit=5`, { headers: hlavicky(kdo) });
      const radky = r.ok ? ((await r.json()) as unknown[]) : [];
      expect(radky, `${kdo} přečetl ${tabulka} napřímo (status ${r.status})`).toEqual([]);
    }
  });

  it("kotva: k úryvku čisté položky se čtenář dostane přes funkci", async () => {
    const r = await fetch(`${REST}/rpc/mcp_get_knowledge_item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_item_id: K.cista }),
    });
    expect(r.status).toBe(200);
    const polozka = (await r.json()) as { chunks?: { chunk_text: string }[] } | null;
    expect(polozka?.chunks?.map((c) => c.chunk_text)).toEqual([`úryvek ${P}`]);
  });
});
