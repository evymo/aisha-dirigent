/**
 * Detail příběhu (get_story_detail_audited, za ním MCP get_story_context) i pro výchozí story
 * stacku — na skutečné databázi, pod rolí API (SET ROLE + značky JWT jako PostgREST).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (F9, tři lidé ve třech IDE): get_story_context z IDE padal na výchozí
 *    story stacku. Funkce poznávala existenci příběhu podle partner_id, takže KAŽDÝ příběh bez
 *    partnera (výchozí story i příběh člena bez partnera) hlásila jako 'Story not found'.
 *
 * Očekávání (pravidlo psané nezávisle na SQL):
 *   - výchozí story čte každý přihlášený (politika „Stack default story visible to all
 *     authenticated“), ale nejvýš tolik, kolik dává RLS: bez interních poznámek, bez štítků,
 *     připomínek, jména vlastníka a náhledu dokumentu;
 *   - správa čte výchozí story celou (interní poznámky i štítky);
 *   - příběh bez partnera čte vlastník a účastník, cizí přihlášený ne (42501);
 *   - neexistující příběh = P0002, nepřihlášený nic.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { psql, psqlOk, relace, vytvorIdentity, type Kdo } from "./viditelnost-matice";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const dbDostupna = isPgReachable();

const BEH = randomUUID().replace(/-/g, "").slice(0, 10);
const I = vytvorIdentity(BEH);
const ZNACKA = { verejny: `pvs-verejny-${BEH}`, interni: `pvs-interni-${BEH}`, stitek: `pvs-stitek-${BEH}`, pripominka: `pvs-pripominka-${BEH}` };
const NEEXISTUJICI = randomUUID();
let VYCHOZI = "";
const ZALOZENY_VYCHOZI = randomUUID();
let vychoziZalozenTestem = false;
/** Původní vlastník výchozí story — test ji dočasně přiřadí vlastníkovi se jménem (kotva jména). */
let puvodniVlastnik = "NULL";
const JMENO_VLASTNIKA = { krestni: `Pvs${BEH}`, prijmeni: "Vlastník" };

type Detail = {
  id: string;
  user_display_name: string | null;
  entries: Array<{ content: string; is_internal: boolean; document_preview: unknown }>;
  labels: Array<{ label: string }>;
  reminders: Array<{ message: string }>;
};

/** Detail příběhu očima identity: data, nebo SQLSTATE chyby. */
function detail(kdo: Kdo, pribeh: string): { data?: Detail; kod?: string } {
  const r = psql(`\\set VERBOSITY verbose
${relace(kdo, I.U)}
SELECT row_to_json(t)::text FROM public.get_story_detail_audited('${pribeh}') t;`);
  if (r.kod !== 0) return { kod: /ERROR:\s+([0-9A-Z]{5}):/.exec(r.chyba)?.[1] ?? `?${r.chyba.slice(0, 200)}` };
  // relace() vypíše i výsledky set_config — detail je poslední řádek.
  return { data: JSON.parse(r.vystup.split("\n").at(-1) ?? "") as Detail };
}

beforeAll(() => {
  if (!dbDostupna) return;
  psqlOk(I.sql);
  VYCHOZI = psqlOk("SELECT id FROM public.partner_stories WHERE is_stack_default = true ORDER BY created_at LIMIT 1");
  if (!VYCHOZI) {
    // Čistá DB bez výchozí story: test si ji založí (singleton) a po sobě ji zase smaže.
    psqlOk(`INSERT INTO public.partner_stories (id, title, is_stack_default) VALUES ('${ZALOZENY_VYCHOZI}', 'PVS výchozí ${BEH}', true)`);
    VYCHOZI = ZALOZENY_VYCHOZI;
    vychoziZalozenTestem = true;
  }
  // Kotva: výchozí story má vlastníka se jménem — jinak by „jméno vlastníka se nevydá“ neměřilo nic.
  const puvodni = psqlOk(`SELECT coalesce(user_id::text, '') FROM public.partner_stories WHERE id = '${VYCHOZI}'`);
  puvodniVlastnik = puvodni ? `'${puvodni}'` : "NULL";
  psqlOk(`
UPDATE public.profiles SET first_name = '${JMENO_VLASTNIKA.krestni}', last_name = '${JMENO_VLASTNIKA.prijmeni}' WHERE id = '${I.U.vlastnik}';
UPDATE public.partner_stories SET user_id = '${I.U.vlastnik}' WHERE id = '${VYCHOZI}';`);
  const autor = I.U.sprava;
  psqlOk(`
INSERT INTO public.story_entries (story_id, subject_type, subject_id, entry_type, content, is_internal, created_by) VALUES
  ('${VYCHOZI}', 'story', '${VYCHOZI}', 'note', '${ZNACKA.verejny}', false, '${autor}'),
  ('${VYCHOZI}', 'story', '${VYCHOZI}', 'note', '${ZNACKA.interni}', true, '${autor}'),
  ('${I.pribeh}', 'story', '${I.pribeh}', 'note', '${ZNACKA.verejny}', false, '${I.U.vlastnik}');
INSERT INTO public.story_labels (partner_id, story_id, label) VALUES ('${I.autorPartner}', '${VYCHOZI}', '${ZNACKA.stitek}');
INSERT INTO public.story_reminders (story_id, partner_id, remind_at, message)
  VALUES ('${VYCHOZI}', '${I.autorPartner}', now() + interval '1 day', '${ZNACKA.pripominka}');`);
});

afterAll(() => {
  if (!dbDostupna) return;
  psqlOk(`
DELETE FROM public.story_reminders WHERE message = '${ZNACKA.pripominka}';
DELETE FROM public.story_labels WHERE label = '${ZNACKA.stitek}';
DELETE FROM public.story_entries WHERE content IN ('${ZNACKA.verejny}', '${ZNACKA.interni}');
UPDATE public.partner_stories SET user_id = ${puvodniVlastnik} WHERE id = '${VYCHOZI}';
${vychoziZalozenTestem ? `DELETE FROM public.partner_stories WHERE id = '${ZALOZENY_VYCHOZI}';` : ""}
${I.uklid}`);
});

describe.skipIf(!dbDostupna && !DB_SLIBENA)("detail příběhu — výchozí story stacku a příběh bez partnera", () => {
  it("kotva: databáze je dosažitelná, když ji wrapper slíbil", () => {
    expect(dbDostupna).toBe(true);
  });

  it("přihlášený bez vztahu čte výchozí story — jen to, co dává RLS, a ještě méně", () => {
    const { data, kod } = detail("prihlaseny", VYCHOZI);
    expect(kod, "výchozí story nesmí být 'Story not found'").toBeUndefined();
    const obsah = data!.entries.map((e) => e.content);
    expect(obsah).toContain(ZNACKA.verejny);
    expect(obsah, "interní poznámka jen správě").not.toContain(ZNACKA.interni);
    expect(data!.labels).toEqual([]);
    expect(data!.reminders).toEqual([]);
    expect(data!.user_display_name).toBeNull();
    for (const e of data!.entries) expect(e.document_preview).toBeNull();
  });

  it("správa čte výchozí story celou — interní poznámky, štítky i připomínky", () => {
    const { data, kod } = detail("sprava", VYCHOZI);
    expect(kod).toBeUndefined();
    expect(data!.entries.map((e) => e.content)).toEqual(expect.arrayContaining([ZNACKA.verejny, ZNACKA.interni]));
    expect(data!.labels.map((l) => l.label)).toContain(ZNACKA.stitek);
    // Kotva k testu výš: jméno vlastníka v datech JE — přihlášenému bez vztahu se jen nevydá.
    expect(data!.user_display_name).toBe(`${JMENO_VLASTNIKA.krestni} V.`);
    expect(data!.reminders.map((r) => r.message)).toContain(ZNACKA.pripominka);
  });

  it("příběh bez partnera: vlastník a účastník čtou, cizí přihlášený 42501", () => {
    expect(detail("vlastnik", I.pribeh).data?.entries.map((e) => e.content)).toContain(ZNACKA.verejny);
    expect(detail("ucastnik", I.pribeh).data?.id).toBe(I.pribeh);
    expect(detail("prihlaseny", I.pribeh).kod).toBe("42501");
  });

  it("neexistující příběh P0002; nepřihlášený nedostane nic", () => {
    expect(detail("prihlaseny", NEEXISTUJICI).kod).toBe("P0002");
    // anon nemá EXECUTE (42501 z oprávnění funkce) — výchozí story mu tím nezačne patřit.
    expect(detail("anon", VYCHOZI).kod).toBe("42501");
  });
});
