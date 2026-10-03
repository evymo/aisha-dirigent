/**
 * Ask: KTEROU firmu otázka myslí, když ji jmenuje textem.
 *
 * ⛔ NAMĚŘENO 2026-09-28 (produkce RIQ, správa): „Co víme o firmě SFR Motor s.r.o.?
 * Kolik dluží…" odpověděla o „SFR Motor SERVIS s.r.o." — jiné firmě (jen přijaté
 * faktury), takže „vydané faktury nemáme", ač SFR Motor s.r.o. má 60 vydaných.
 * Dohad bral nejdelší shodné slovo názvu („motor", obě firmy) a při shodě DELŠÍ
 * název, i když jeho slovo „servis" v otázce není.
 *
 * ⭐ CO SE MĚŘÍ: přednost má firma, jejíž celý název otázka nese; jinak ta, které
 * v otázce chybí nejméně slov názvu. Delší název vyhraje jen tehdy, když ho otázka
 * opravdu jmenuje.
 *
 * ⭐ A PŘESNOST ODPOVĚDI (2026-09-28): dvojče firmy bývá pojmenované adresou nebo IČO
 * (z 1 518 firem s IČO 53 adresou, 28 IČO). Odpověď proto jmenuje firmu AKTUÁLNÍM
 * jménem z dokladů, nájem páruje jmény v čase (ne názvem dvojčete), bez vzorů nájmu
 * přizná, že se nederivuje, a dluh říká „od kdy" a „na jakých smlouvách".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().replace(/-/g, "").replace(/[0-9]/g, "").slice(0, 6) || "abcdef";
const SLOVO = `Qqmotor${RUN}`;
const KRATKA = randomUUID();
const DLOUHA = randomUUID();
const JMENO_KRATKA = `${SLOVO} s.r.o.`;
const JMENO_DLOUHA = `${SLOVO} servis s.r.o.`;

const ADRESA = randomUUID();
const NAZEV_ADRESOU = `Qqulice${RUN} 12/3`;
const JMENO = `Qqfirma${RUN} s.r.o.`;
const ICO = String(Date.now() % 100000000).padStart(8, "0");
const SMLOUVA = `Najemni smlouva Qqfirma${RUN}.pdf`;
const DOKLADY = [`ask-fa-${RUN}`, `ask-sm-${RUN}`];
const SCOPE = JSON.stringify([{ dim: "company", value: ADRESA }]);
const odpoved = (otazka: string, config: object) =>
  psql(`SELECT public.answer_verified_facts('${otazka.replace(/'/g, "''")}', 'strucny',
          '${SCOPE}'::jsonb, '${JSON.stringify(config)}'::jsonb)->>'answer'`);

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
/** Kterou firmu dohad z textu vybral (scope s origin guessed_from_text). */
const firma = (otazka: string) => {
  const id = psql(`SELECT coalesce((SELECT c->>'value' FROM jsonb_array_elements(
                     public.answer_verified_facts('${otazka.replace(/'/g, "''")}', 'strucny')->'scope') c
                    WHERE c->>'dim' = 'company' AND c->>'origin' = 'guessed_from_text' LIMIT 1), '')`);
  return id === KRATKA ? "kratka" : id === DLOUHA ? "dlouha" : id ? "jina" : "";
};

beforeAll(() => {
  if (!dbAvailable) return;
  psql(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES
          ('${KRATKA}','company','${JMENO_KRATKA}'), ('${DLOUHA}','company','${JMENO_DLOUHA}'),
          ('${ADRESA}','company','${NAZEV_ADRESOU}')`);
  psql(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, proposed_by)
          VALUES ('${ADRESA}', 'test', '${ICO}', 'company_ico', 'test')`);
  const pole = (o: Record<string, string>) =>
    JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }])));
  psql(`INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, filename, status, fields, line_items) VALUES
          ('sha-${DOKLADY[0]}', '${DOKLADY[0]}', 'invoice', 'fa-${RUN}.json', 'AUTO_PASS',
           '${pole({ counterparty: JMENO, counterparty_id: ICO, document_subtype: "issued", owner_company: "Naše firma",
                     total_amount: "25000", amount_unpaid: "25000", storno: "0" })}'::jsonb
             || jsonb_build_object('issue_date', jsonb_build_object('value', (current_date - 40)::text),
                                   'due_date',   jsonb_build_object('value', (current_date - 30)::text)),
           '[{"fields":{"item_name":{"value":"Nájemné"},"line_total":{"value":"25000"}}}]'::jsonb),
          ('sha-${DOKLADY[1]}', '${DOKLADY[1]}', 'contract', '${SMLOUVA}', 'AUTO_PASS',
           '${pole({ counterparty: JMENO, counterparty_id: ICO })}'::jsonb, '[]'::jsonb)`);
});
afterAll(() => {
  if (!dbAvailable) return;
  psql(`DELETE FROM public.li_source_registry WHERE doc_slug IN ('${DOKLADY[0]}','${DOKLADY[1]}')`);
  psql(`DELETE FROM public.twin_entities WHERE id IN ('${KRATKA}','${DLOUHA}','${ADRESA}')`);
});

describe.skipIf(!dbAvailable)("Ask — firma z textu otázky", () => {
  it("⭐ otázka jmenuje kratší název celý → kratší firma, ne delší s navíc slovem", () => {
    expect(firma(`Co víme o firmě ${JMENO_KRATKA}? Kolik dluží, od kdy a na jakých smlouvách?`)).toBe("kratka");
  });

  it("⭐ otázka jmenuje delší název celý → delší firma", () => {
    expect(firma(`Co víme o firmě ${JMENO_DLOUHA}? Kolik dluží?`)).toBe("dlouha");
  });

  it("bez právní formy: vyhraje firma, které v otázce chybí méně slov názvu", () => {
    expect(firma(`Kolik dluží ${SLOVO}?`)).toBe("kratka");
    expect(firma(`Kolik dluží ${SLOVO} servis?`)).toBe("dlouha");
  });

  it("⛔ otázka bez jména firmy žádnou firmu nedohaduje", () => {
    expect(firma("Kolik dluží nájemníci celkem?")).not.toBe("kratka");
    expect(firma("Kolik dluží nájemníci celkem?")).not.toBe("dlouha");
  });
});

describe.skipIf(!dbAvailable)("Ask — přesnost odpovědi u firmy s dvojčetem pojmenovaným adresou", () => {
  it("⭐ nájem: páruje se jmény z dokladů a odpověď jmenuje aktuální jméno, ne adresu", () => {
    const a = odpoved("Kolik platí nájem?", { rent: { rent_patterns: ["nájem"] } });
    expect(a).toContain(`${JMENO}: nájem se fakturuje`);
    expect(a).not.toContain(NAZEV_ADRESOU);
  });

  it("⛔ bez vzorů nájmu odpověď přizná, že se nederivuje — a řekne, o které firmě mluví", () => {
    const a = odpoved("Kolik platí nájem?", {});
    expect(a).toContain(`${JMENO}: nájem se nederivuje`);
  });

  it("⭐ dluh: od kdy a na jakých smlouvách, pod aktuálním jménem", () => {
    const a = odpoved("Kolik dluží, od kdy a na jakých smlouvách?", { receivables: { receivable_from: "issue_date" } });
    expect(a).toContain(`${JMENO}: dluh po splatnosti`);
    expect(a).toContain("splatný od");
    expect(a).toContain(SMLOUVA);
    expect(a).not.toContain(NAZEV_ADRESOU);
  });

  it("karta protistrany ukazuje jako název aktuální jméno z dokladů (counterparty_resolve.label)", () => {
    expect(psql(`SELECT label FROM public.counterparty_resolve('{"twin_id":"${ADRESA}"}'::jsonb)`)).toBe(JMENO);
  });

  it("⭐ schválený název má přednost před jménem z faktury; karta upozorní, když se doklady liší", () => {
    const STARE = `Qqstare${RUN} a.s.`;
    const nazev = () => JSON.parse(psql(`SELECT f::text FROM jsonb_array_elements(
                       public.get_counterparty_card('{"twin_id":"${ADRESA}"}'::jsonb)->'data'->'fields') f
                      WHERE f->>'key' = 'nazev'`));
    // bez schválení: dočasně jméno z dokladu, pole ke kontrole
    expect(nazev()).toMatchObject({ value: JMENO, state: "needs_review" });
    psql(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, proposed_by, state, confirmed_by, confirmed_at)
            VALUES ('${ADRESA}', 'hr', '${STARE}', 'company_name', 'test', 'confirmed', gen_random_uuid(), now())`);
    try {
      // schválený (starší) název platí; doklady nesou jiné jméno → ke kontrole (přejmenování čeká na schválení)
      expect(psql(`SELECT label FROM public.counterparty_resolve('{"twin_id":"${ADRESA}"}'::jsonb)`)).toBe(STARE);
      expect(nazev()).toMatchObject({ value: STARE, state: "needs_review" });
      // schválí se nové jméno → souhlasí s doklady → bez upozornění
      psql(`UPDATE public.twin_external_refs SET source_key = '${JMENO}' WHERE twin_id = '${ADRESA}' AND ref_kind = 'company_name'`);
      expect(nazev()).toMatchObject({ value: JMENO, state: "auto_pass" });
    } finally {
      psql(`DELETE FROM public.twin_external_refs WHERE twin_id = '${ADRESA}' AND ref_kind = 'company_name'`);
    }
  });
});

