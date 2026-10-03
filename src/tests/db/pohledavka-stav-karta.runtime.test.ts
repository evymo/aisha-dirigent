import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

/**
 * Stav pohledávky a identita protistrany — RUNTIME proti čerstvé DB.
 *
 * ⭐ PROČ: karta protistrany (Inspirace, IČO 09519696, naměřeno 2026-09-25)
 * hlásila dluh 588 383 Kč, přestože vystaveno a nezaplaceno bylo 259 597 Kč:
 * faktury VYSTAVENÉ DOPŘEDU (85 ks / 6,2 mil. Kč napříč instancí) se sčítaly
 * jako dluh, okno „12 měsíců" nemělo horní mez a každá čtečka si stav dokladu
 * počítala po svém — karta dobropis nepočítala, tabulka dlužníků ano
 * (rozhodnutí majitele 2026-08-05), storno nepočítal nikdo. Druhý twin téže
 * firmy (bez IČO, klíčovaný jménem) karta neviděla, a s ním ani smlouvu, kterou
 * k němu ingest navrhl — „Smluv: 0", „Twinů: 1 · automaticky".
 *
 * Pinuje: jeden stavový slovník dokladu (invoice_state) pro všechny čtečky,
 *   · předepsáno (datum vzniku pohledávky v budoucnu) NENÍ dluh, je `scheduled`;
 *   · storno není dluh, ani vyfakturováno, ani nejstarší dluh;
 *   · dobropis odečítá i na kartě (jako v tabulce dlužníků) a má svůj stav;
 *   · okno 12 m je [dnes − 365, dnes], ne „od dnes − 365 do nekonečna";
 *   · twin bez IČO se jménem, které nese JEN tahle firma, je jejím twinem
 *     (odvozeno); jméno sdílené s jiným IČO nic nepřipojí;
 *   · smlouva navržená k twinu (`identified_tenant`) se na kartě počítá.
 *
 * Každé tvrzení selhalo na čtečkách z riq main 4b12de0a4 (kontrolní vzorek:
 * brána musí selhat na originálu).
 *
 * Spouští se přes: npm run test:db:pohledavka (throwaway DB z baseline + seed)
 */

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const HEADER = "\\set ON_ERROR_STOP on\n";

const ICO = "90000001";
const ICO_JINY = "90000002";
const JMENO = "ALFA TEST s.r.o.";
const SDILENE = "SPOLEČNÉ TEST s.r.o.";

/**
 * Doklady v registru ve tvaru, jaký píše ingest ({value}). Data jsou relativní
 * k dnešku, aby stav „po splatnosti / předepsáno" nestárnul s kalendářem.
 */
const seed = `
  CREATE OR REPLACE FUNCTION pg_temp.fa(
    p_sha text, p_ico text, p_jmeno text, p_vystaveno int, p_splatnost int,
    p_celkem text, p_zbyva text, p_storno text DEFAULT '0', p_druh text DEFAULT 'issued'
  ) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.li_source_registry
      (source_sha256, doc_slug, doc_type, filename, status, fields)
    VALUES (p_sha, 'slug-'||p_sha, 'invoice', 'fa-'||p_sha||'.json', 'AUTO_PASS',
      jsonb_strip_nulls(jsonb_build_object(
        'counterparty_id',  jsonb_build_object('value', p_ico),
        'counterparty',     jsonb_build_object('value', p_jmeno),
        'document_subtype', jsonb_build_object('value', p_druh),
        'owner_company',    jsonb_build_object('value', 'Naše firma'),
        'issue_date',       jsonb_build_object('value', (current_date + p_vystaveno)::text),
        'due_date',         jsonb_build_object('value', (current_date + p_splatnost)::text),
        'total_amount',     jsonb_build_object('value', p_celkem),
        'amount_unpaid',    jsonb_build_object('value', p_zbyva),
        'storno',           jsonb_build_object('value', p_storno))));
  $f$;

  CREATE OR REPLACE FUNCTION pg_temp.twin(p_label text) RETURNS uuid LANGUAGE sql AS $f$
    INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', p_label) RETURNING id;
  $f$;

  CREATE OR REPLACE FUNCTION pg_temp.ref(p_twin uuid, p_kind text, p_key text) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, proposed_by)
    VALUES (p_twin, 'test', p_key, p_kind, 'test');
  $f$;

  -- Protistrana ALFA (vydané faktury, dnes = 0):
  PERFORM pg_temp.fa('ps-1', '${ICO}', '${JMENO}', -40, -10, '1000', '1000');           -- po splatnosti
  PERFORM pg_temp.fa('ps-2', '${ICO}', '${JMENO}',  -5,  10,  '500',  '500');           -- vystaveno, ve splatnosti
  PERFORM pg_temp.fa('ps-3', '${ICO}', '${JMENO}',  10,  24,  '300',  '300');           -- PŘEDEPSÁNO (vystavení za 10 dní)
  PERFORM pg_temp.fa('ps-4', '${ICO}', '${JMENO}',-100, -80,  '800',    '0');           -- uhrazeno
  -- STORNO: hodnoty jako v Money (naměřeno 2026-09-26): 1 = stornovaný doklad,
  -- 2 = stornovací doklad s TOUŽ kladnou částkou. ps-5 nese zbytek schválně —
  -- storno nesmí být dluh ani kdyby zdroj zůstatek nevynuloval.
  PERFORM pg_temp.fa('ps-5', '${ICO}', '${JMENO}', -90, -60,  '200',  '200', '1');
  PERFORM pg_temp.fa('ps-5s','${ICO}', '${JMENO}', -85, -70,  '200',    '0', '2');   -- stornovací doklad
  PERFORM pg_temp.fa('ps-6', '${ICO}', '${JMENO}',  -3,  -3, '-100', '-100');           -- dobropis
  PERFORM pg_temp.fa('ps-7', '${ICO}', '${JMENO}', -50, -20, '5000', '5000', '0', 'received'); -- NÁŠ závazek, ne jeho dluh
`;

/** Twiny: ALFA s IČO, ALFA bez IČO (jménem), SPOLEČNÉ bez IČO (jméno nesou dvě IČO). */
const twiny = `
  v_t1 := pg_temp.twin('${JMENO}');
  PERFORM pg_temp.ref(v_t1, 'company_ico', '${ICO}');
  v_t2 := pg_temp.twin('${JMENO}');                    -- druhý twin téže firmy, BEZ IČO
  v_t3 := pg_temp.twin('${SDILENE}');                  -- jméno sdílené dvěma IČO → nepřipojit
  PERFORM pg_temp.fa('ps-8', '${ICO}',      '${SDILENE}', -400, -380, '10', '0');
  PERFORM pg_temp.fa('ps-9', '${ICO_JINY}', '${SDILENE}', -400, -380, '10', '0');
  -- smlouva bez stran v polích, navržená ingestem k twinu BEZ IČO
  INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, filename, status, fields)
  VALUES ('ps-sm', 'slug-ps-sm', 'contract', 'smlouva.pdf', 'AUTO_PASS', '{}'::jsonb);
  PERFORM pg_temp.ref(v_t2, 'identified_tenant', 'ps-sm');
`;

/**
 * Otázku, kterou karta předvyplňuje do Asku, bere test ze ZDROJE překladu —
 * ne opsanou. Kdo změní formulaci, změní i to, co se tu měří.
 */
const PREFILL_CS: string = JSON.parse(
  readFileSync(join(process.cwd(), "src/i18n/content/cs/extranet.json"), "utf-8"),
)["app.cp.ask.prefill"];

/**
 * Parametry, které deklaruje INSTANCE (source_params bloku): od kdy je faktura
 * pohledávkou a kterými kódy zdroj značí storno. Platforma kódy Money nezná.
 */
const P = `"receivable_from":"issue_date","storno_values":["1","2"]`;

const metrika = (m: string) =>
  `(public.get_counterparty_metric('{"debtor":"${ICO}","metric":"${m}",${P}}'::jsonb)->'data'->>'value')`;

function spust(telo: string): () => string {
  return () =>
    psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v jsonb; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_tb uuid; n numeric; t text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
${seed}
${telo}
END $$;
ROLLBACK;
`);
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("stav pohledávky — jeden slovník pro všechny čtečky", () => {
  it("karta: dluží = vystaveno − dobropis; předepsáno a storno mimo; nová metrika scheduled", () => {
    expect(
      spust(`
  n := ${metrika("receivable_open")};
  IF n IS DISTINCT FROM 1400 THEN RAISE 'dluží: čekáno 1400 (1000 + 500 − 100), je %', n; END IF;
  n := ${metrika("receivable_overdue")};
  IF n IS DISTINCT FROM 900 THEN RAISE 'po splatnosti: čekáno 900 (1000 − dobropis 100, bez storna), je %', n; END IF;
  n := ${metrika("oldest_overdue_days")};
  IF n IS DISTINCT FROM 10 THEN RAISE 'nejstarší dluh: čekáno 10 dní (storno 60 dní se nepočítá), je %', n; END IF;
  n := ${metrika("scheduled")};
  IF n IS DISTINCT FROM 300 THEN RAISE 'předepsáno: čekáno 300, je %', n; END IF;
  n := ${metrika("invoiced_12m")};
  IF n IS DISTINCT FROM 2200 THEN RAISE 'vyfakturováno 12 m: čekáno 2200 (bez budoucích a bez OBOU dokladů storna), je %', n; END IF;
`),
    ).not.toThrow();
  });

  it("kódy storna jsou DATA instance: bez deklarace platforma storno nerozpozná", () => {
    expect(
      spust(`
  n := (public.get_counterparty_metric('{"debtor":"${ICO}","metric":"oldest_overdue_days","receivable_from":"issue_date"}'::jsonb)->'data'->>'value')::numeric;
  IF n IS DISTINCT FROM 60 THEN RAISE 'bez storno_values má být storno obyčejný doklad (nejstarší 60 dní), je %', n; END IF;
  BEGIN
    PERFORM public.get_counterparty_metric('{"debtor":"${ICO}","metric":"scheduled","storno_values":"1"}'::jsonb);
    RAISE 'storno_values jako řetězec prošlo — čekána chyba konfigurace';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
`),
    ).not.toThrow();
  });

  it("stáří dluhu: předepsané ani storno nejsou v žádném pásmu", () => {
    expect(
      spust(`
  v := public.get_counterparty_aging('{"debtor":"${ICO}",${P}}'::jsonb)->'data'->'points';
  SELECT sum((p->>'value')::numeric) INTO n FROM jsonb_array_elements(v) p;
  IF n IS DISTINCT FROM 1500 THEN RAISE 'součet pásem: čekáno 1500 (1000 po splatnosti + 500 ve splatnosti), je %: %', n, v; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) p WHERE p->>'label' = '31–90') THEN
    RAISE 'storno se dostalo do pásma 31–90: %', v;
  END IF;
`),
    ).not.toThrow();
  });

  it("faktury odběratele: stav nese předepsáno, storno i dobropis — dobropis není „uhrazeno“", () => {
    expect(
      spust(`
  v := public.get_debtor_invoices('{"debtor":"${ICO}","only_open":"false",${P}}'::jsonb)->'data'->'rows';
  IF (SELECT r->>'stav' FROM jsonb_array_elements(v) r WHERE r->>'id' = 'slug-ps-3') IS DISTINCT FROM 'app.inv.state.scheduled' THEN
    RAISE 'předepsaná faktura: %', v; END IF;
  IF (SELECT r->>'stav' FROM jsonb_array_elements(v) r WHERE r->>'id' = 'slug-ps-5') IS DISTINCT FROM 'app.inv.state.storno' THEN
    RAISE 'stornovaná faktura: %', v; END IF;
  IF (SELECT r->>'stav' FROM jsonb_array_elements(v) r WHERE r->>'id' = 'slug-ps-6') IS DISTINCT FROM 'app.inv.state.correction' THEN
    RAISE 'dobropis: %', v; END IF;
  IF (SELECT r->>'stav' FROM jsonb_array_elements(v) r WHERE r->>'id' = 'slug-ps-1') IS DISTINCT FROM 'app.inv.state.overdue' THEN
    RAISE 'kontrolní vzorek — faktura po splatnosti: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("tabulka dlužníků: storno a přijatá faktura nejsou dluh; dobropis dál odečítá", () => {
    expect(
      spust(`
  v := public.get_receivables_overdue('{${P}}'::jsonb)->'data'->'rows';
  SELECT r INTO v FROM jsonb_array_elements(v) r WHERE r->>'id' = '${ICO}';
  IF v IS NULL THEN RAISE 'kontrolní vzorek — dlužník ${ICO} chybí'; END IF;
  IF (v->>'castka')::numeric IS DISTINCT FROM 900 THEN
    RAISE 'po splatnosti: čekáno 900 (1000 − 100; storno 200 a přijatá 5000 mimo), je %', v; END IF;
  IF (v->>'dni')::int IS DISTINCT FROM 10 THEN RAISE 'dní: čekáno 10 (storno 60 mimo), je %', v; END IF;
`),
    ).not.toThrow();
  });
});

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("identita protistrany — twiny podle jmen v čase", () => {
  it("twin bez IČO s jednoznačným jménem je twinem firmy; sdílené jméno nic nepřipojí", () => {
    expect(
      spust(`${twiny}
  v := (SELECT twins FROM public.counterparty_resolve('{"debtor":"${ICO}"}'::jsonb));
  IF NOT v @> jsonb_build_array(jsonb_build_object('id', v_t1)) THEN RAISE 'kontrolní vzorek — twin s IČO chybí: %', v; END IF;
  IF NOT v @> jsonb_build_array(jsonb_build_object('id', v_t2, 'certainty', 'derived')) THEN
    RAISE 'twin bez IČO (jméno nese jen tahle firma) chybí nebo nemá jistotu derived: %', v; END IF;
  IF v @> jsonb_build_array(jsonb_build_object('id', v_t3)) THEN
    RAISE 'twin se jménem sdíleným s jiným IČO se připojil: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("karta: dva twiny = roztříštěná identita; smlouva navržená k twinu se počítá", () => {
    expect(
      spust(`${twiny}
  v := public.get_counterparty_card('{"debtor":"${ICO}"}'::jsonb)->'data';
  IF (SELECT f->>'value' FROM jsonb_array_elements(v->'fields') f WHERE f->>'key' = 'identita') IS DISTINCT FROM '2' THEN
    RAISE 'twinů v modelu: čekáno 2, je %', v->'fields'; END IF;
  IF NOT (v->'badges') ? 'app.cp.badge.identity_split' THEN RAISE 'chybí odznak roztříštěné identity: %', v->'badges'; END IF;
  IF (SELECT f->>'value' FROM jsonb_array_elements(v->'fields') f WHERE f->>'key' = 'smlouvy') IS DISTINCT FROM '1' THEN
    RAISE 'smluv: čekána 1 (navržená k twinu bez IČO), je %', v->'fields'; END IF;
`),
    ).not.toThrow();
  });
});

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("Ask — otázka z karty dostane odpověď o dluhu z týchž čteček", () => {
  it("předvyplněná otázka karty je záměr `debt`, čísla sedí s kartou, smlouva se přizná jako navržená", () => {
    expect(PREFILL_CS, "app.cp.ask.prefill chybí v cs/extranet.json").toContain("{name}");
    const otazka = PREFILL_CS.replace("{name}", JMENO).replace(/'/g, "''");
    expect(
      spust(`${twiny}
  v := public.answer_verified_facts('${otazka}', 'strucny',
         jsonb_build_array(jsonb_build_object('dim','company','value',v_t1::text,'resolver','twin')),
         '{"receivables":{${P}}}'::jsonb);
  IF v->>'intent' IS DISTINCT FROM 'debt' THEN RAISE 'záměr: čekán debt, je % (%)', v->>'intent', v->>'answer'; END IF;
  -- dluh = PO SPLATNOSTI (majitel 2026-09-26); k úhradě = vše vystavené nezaplacené
  IF (v->'data'->>'dluh')::numeric IS DISTINCT FROM 900 THEN RAISE 'dluh po splatnosti v odpovědi ≠ karta (900): %', v->'data'; END IF;
  IF (v->'data'->>'k_uhrade')::numeric IS DISTINCT FROM 1400 THEN RAISE 'k úhradě v odpovědi ≠ karta (1400): %', v->'data'; END IF;
  IF (v->'data'->>'predepsano')::numeric IS DISTINCT FROM 300 THEN RAISE 'předepsáno ≠ karta (300): %', v->'data'; END IF;
  IF (v->'data'->>'smluv_navrzeno')::int IS DISTINCT FROM 1 THEN RAISE 'navržená smlouva chybí: %', v->'data'; END IF;
  IF v->>'coverage' IS DISTINCT FROM 'partial' THEN RAISE 'pokrytí: čekáno partial, je %', v->>'coverage'; END IF;
  IF v->>'answer' !~ 'dluh po splatnosti 900' OR v->>'answer' !~ 'k úhradě celkem 1 ?400' OR v->>'answer' !~ 'navržené' THEN
    RAISE 'text odpovědi (dluh = po splatnosti, k úhradě zvlášť): %', v->>'answer'; END IF;
`),
    ).not.toThrow();
  });

  it("twin bez IČO dojde k týmž fakturám jako twin s IČO (jméno nese jediné IČO)", () => {
    expect(
      spust(`${twiny}
  IF (SELECT icos FROM public.counterparty_resolve(jsonb_build_object('twin_id', v_t2::text))) IS DISTINCT FROM ARRAY['${ICO}'] THEN
    RAISE 'twin bez IČO nerozřešil IČO z jednoznačného jména: %',
      (SELECT icos FROM public.counterparty_resolve(jsonb_build_object('twin_id', v_t2::text)));
  END IF;
  -- jméno sdílené dvěma IČO: twin_t3 IČO NEDOSTANE (kontrolní vzorek „jméno není identita")
  IF cardinality((SELECT icos FROM public.counterparty_resolve(jsonb_build_object('twin_id', v_t3::text)))) <> 0 THEN
    RAISE 'twin se sdíleným jménem dostal IČO: %',
      (SELECT icos FROM public.counterparty_resolve(jsonb_build_object('twin_id', v_t3::text)));
  END IF;
`),
    ).not.toThrow();
  });
});

/**
 * ČAS PLATNOSTI ZÁZNAMU — současnost první, neznámé ≠ 0 (majitel 2026-09-28).
 *
 * ⭐ PROČ: protistrana, která byla odběratelem před čtyřmi lety (16 vydaných
 * faktur 2021–22, od té doby nic), měla na kartě „K úhradě 0 Kč", v síti vazeb
 * „bez dluhu" a Ask odpověděl „dluh po splatnosti 0 Kč; k úhradě 0 Kč" — přestože
 * ŽÁDNÁ z jejích faktur stav úhrady nenesla (export ERP bez zůstatku). Graf
 * trendu tytéž faktury kreslil jako PLNĚ UHRAZENÉ (celkem − zbývá s „zbývá = 0").
 * Otázky „je náš zákazník?" a „jaké je IČO?" nedostaly odpověď vůbec, ačkoli
 * data v evidenci jsou. Naměřeno 2026-09-28: 929 protistran / 5 104 faktur
 * bez jediného stavu úhrady.
 *
 * Pinuje:
 *   · metriky úhrady bez jediného známého stavu = NEMĚŘENO (null), vyfakturováno
 *     za 12 m zůstává číslem; smíšený stav počítá jen známé;
 *   · síť vazeb: firma bez stavu úhrady = „stav úhrady neznámý", ne „bez dluhu";
 *   · karta: vztah v čase (odběratel · dodavatel · faktury bez stavu) HNED pod
 *     identitou, předpis vztah neprodlužuje;
 *   · trend: neznámý stav v okně → žádná řada „z toho uhrazeno";
 *   · Ask: dluh rozliší „nemáme faktury" od „neznáme stav úhrady", záměr
 *     `relationship` začíná současností, IČO a adresa z hlavičky karty;
 *   · čerstvost všech šesti čteček karty = příchod posledního dokladu té
 *     protistrany (brána cerstvost-z-dat), ne čas zavolání.
 */
const ICO_B = "90000003";
const JMENO_B = "BETA TEST s.r.o.";
const ICO_G = "90000004";
const JMENO_G = "GAMA TEST s.r.o.";

const casy = `
  -- BETA: odběratel PŘED LETY, stav úhrady ve zdroji NENÍ (export bez zůstatku)
  PERFORM pg_temp.fa('cp-b1', '${ICO_B}', '${JMENO_B}', -1500, -1480, '1000', NULL);
  PERFORM pg_temp.fa('cp-b2', '${ICO_B}', '${JMENO_B}', -1400, -1380, '2000', NULL);
  PERFORM pg_temp.fa('cp-b3', '${ICO_B}', '${JMENO_B}', -1300, -1280, '3000', NULL);
  -- … a později DODAVATEL (přijatá faktura, se stavem)
  PERFORM pg_temp.fa('cp-b4', '${ICO_B}', '${JMENO_B}',  -200,  -180,  '500',  '0', '0', 'received');
  v_tb := pg_temp.twin('${JMENO_B}');
  PERFORM pg_temp.ref(v_tb, 'company_ico', '${ICO_B}');
  -- GAMA: smíšeně — jedna faktura se stavem (po splatnosti), jedna bez
  PERFORM pg_temp.fa('cp-g1', '${ICO_G}', '${JMENO_G}',   -40,   -10, '1000', '1000');
  PERFORM pg_temp.fa('cp-g2', '${ICO_G}', '${JMENO_G}',   -20,     5,  '700', NULL);
  PERFORM pg_temp.ref(pg_temp.twin('${JMENO_G}'), 'company_ico', '${ICO_G}');
`;

const metrikaZ = (ico: string, m: string) =>
  `(public.get_counterparty_metric('{"debtor":"${ico}","metric":"${m}",${P}}'::jsonb)->'data'->>'value')`;
const pole = (ico: string, klic: string) =>
  `(SELECT f->>'value' FROM jsonb_array_elements(public.get_counterparty_card('{"debtor":"${ico}"}'::jsonb)->'data'->'fields') f WHERE f->>'key' = '${klic}')`;
const den = (posun: number) => `to_char(current_date + (${posun}), 'YYYY-MM-DD')`;
const denCs = (posun: number) => `to_char(current_date + (${posun}), 'FMDD. FMMM. YYYY')`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("čas platnosti záznamu — současnost první, neznámé ≠ 0", () => {
  it("metriky úhrady bez jediného známého stavu jsou NEMĚŘENO; vyfakturováno 12 m zůstává číslem", () => {
    expect(
      spust(`${casy}
  IF ${metrikaZ(ICO_B, "receivable_open")} IS NOT NULL THEN
    RAISE 'k úhradě bez stavu úhrady: čekáno NEMĚŘENO (null), je %', ${metrikaZ(ICO_B, "receivable_open")}; END IF;
  IF ${metrikaZ(ICO_B, "receivable_overdue")} IS NOT NULL THEN
    RAISE 'dluh bez stavu úhrady: čekáno null, je %', ${metrikaZ(ICO_B, "receivable_overdue")}; END IF;
  IF ${metrikaZ(ICO_B, "oldest_overdue_days")} IS NOT NULL THEN
    RAISE 'nejstarší dluh bez stavu úhrady: čekáno null, je %', ${metrikaZ(ICO_B, "oldest_overdue_days")}; END IF;
  IF ${metrikaZ(ICO_B, "invoiced_12m")} IS DISTINCT FROM '0' THEN
    RAISE 'vyfakturováno 12 m je známé i bez stavu úhrady: čekáno 0, je %', ${metrikaZ(ICO_B, "invoiced_12m")}; END IF;
  -- smíšený stav: počítá se jen známé (kontrolní vzorek, že null není plošný)
  IF ${metrikaZ(ICO_G, "receivable_open")} IS DISTINCT FROM '1000' THEN
    RAISE 'k úhradě se smíšeným stavem: čekáno 1000 (jen známé), je %', ${metrikaZ(ICO_G, "receivable_open")}; END IF;
`),
    ).not.toThrow();
  });

  it("síť vazeb: naše firma bez stavu úhrady je „stav úhrady neznámý“, ne „bez dluhu“", () => {
    expect(
      spust(`${casy}
  SELECT u INTO v FROM jsonb_array_elements(public.get_counterparty_web('{"debtor":"${ICO_B}"}'::jsonb)->'data'->'groups') g,
         jsonb_array_elements(g->'nodes') u WHERE g->>'key' = 'companies';
  IF v->>'state_key' IS DISTINCT FROM 'app.cp.state.payment_unknown' OR v ? 'value' THEN
    RAISE 'uzel firmy bez stavu úhrady: %', v; END IF;
  SELECT u INTO v FROM jsonb_array_elements(public.get_counterparty_web('{"debtor":"${ICO}"}'::jsonb)->'data'->'groups') g,
         jsonb_array_elements(g->'nodes') u WHERE g->>'key' = 'companies';
  IF v->>'state_key' IS DISTINCT FROM 'app.cp.state.overdue' THEN
    RAISE 'kontrolní vzorek — firma se známým dluhem po splatnosti: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("karta: vztah v čase hned pod identitou; předpis vztah neprodlužuje; faktury bez stavu se přiznají", () => {
    expect(
      spust(`${casy}
  t := ${pole(ICO_B, "odberatel")};
  IF t IS DISTINCT FROM ${den(-1500)} || ' → ' || ${den(-1300)} THEN RAISE 'odběratel BETA: %', t; END IF;
  t := ${pole(ICO_B, "dodavatel")};
  IF t IS DISTINCT FROM ${den(-200)} || ' → ' || ${den(-200)} THEN RAISE 'dodavatel BETA: %', t; END IF;
  t := ${pole(ICO_B, "bez_stavu")};
  IF t IS DISTINCT FROM '3 (' || ${den(-1500)} || ' → ' || ${den(-1300)} || ')' THEN RAISE 'faktury bez stavu BETA: %', t; END IF;
  -- ALFA: předepsaná faktura (+10 dní) konec vztahu NEposouvá; všechny faktury stav nesou
  t := ${pole(ICO, "odberatel")};
  IF t IS DISTINCT FROM ${den(-100)} || ' → ' || ${den(-3)} THEN RAISE 'odběratel ALFA (bez předpisu): %', t; END IF;
  IF ${pole(ICO, "bez_stavu")} IS NOT NULL THEN RAISE 'ALFA nemá faktury bez stavu, pole se nemá kreslit'; END IF;
  -- SOUČASNOST PRVNÍ: vztah stojí před jmény v dokladech
  SELECT jsonb_agg(f->>'key') INTO v FROM jsonb_array_elements(public.get_counterparty_card('{"debtor":"${ICO_B}"}'::jsonb)->'data'->'fields') f;
  IF (SELECT min(i) FROM jsonb_array_elements_text(v) WITH ORDINALITY x(k, i) WHERE k = 'odberatel')
     > (SELECT min(i) FROM jsonb_array_elements_text(v) WITH ORDINALITY x(k, i) WHERE k = 'jmena') THEN
    RAISE 'vztah v čase musí stát před jmény v dokladech: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("trend: neznámý stav v okně → žádná řada „z toho uhrazeno“ (neznámé by vyšlo jako zaplacené)", () => {
    expect(
      spust(`${casy}
  v := public.get_counterparty_trend('{"debtor":"${ICO_G}","months":24,${P}}'::jsonb)->'data';
  IF jsonb_array_length(v->'points') = 0 THEN RAISE 'kontrolní vzorek — vyfakturováno GAMA chybí: %', v; END IF;
  IF jsonb_array_length(v->'compare') <> 0 OR jsonb_array_length(v->'legend_keys') <> 1 THEN
    RAISE 'řada „uhrazeno" nad neznámým stavem: %', v; END IF;
  v := public.get_counterparty_trend('{"debtor":"${ICO}","months":24,${P}}'::jsonb)->'data';
  IF jsonb_array_length(v->'compare') = 0 THEN RAISE 'kontrolní vzorek — známý stav řadu „uhrazeno" MÁ: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("Ask dluh: faktury bez stavu úhrady = „neznáme“, ne „0 Kč“; smíšený stav přizná doklady mimo čísla", () => {
    expect(PREFILL_CS, "app.cp.ask.prefill chybí v cs/extranet.json").toContain("{name}");
    const otazka = (jmeno: string) => PREFILL_CS.replace("{name}", jmeno).replace(/'/g, "''");
    expect(
      spust(`${casy}
  v := public.answer_verified_facts('${otazka(JMENO_B)}', 'strucny',
         jsonb_build_array(jsonb_build_object('dim','company','value',v_tb::text,'resolver','twin')),
         '{"receivables":{${P}}}'::jsonb);
  IF v->>'intent' IS DISTINCT FROM 'debt' THEN RAISE 'záměr: čekán debt, je % (%)', v->>'intent', v->>'answer'; END IF;
  IF v->'data'->>'dluh' IS NOT NULL OR v->>'coverage' IS DISTINCT FROM 'none' THEN
    RAISE 'dluh bez stavu úhrady musí být NEMĚŘENO s pokrytím none: % / %', v->'data', v->>'coverage'; END IF;
  IF v->>'answer' !~ 'stav úhrady neznáme' OR v->>'answer' ~ 'dluh po splatnosti 0'
     OR strpos(v->>'answer', ${denCs(-1300)}) = 0 THEN
    RAISE 'text: neznámý stav + poslední vydaná faktura, ne „0 Kč": %', v->>'answer'; END IF;
  -- GAMA: dluh ze známého stavu (1000), doklad bez stavu PŘIZNANÝ, ne tiše vynechaný
  v := public.answer_verified_facts('${otazka(JMENO_G)}', 'strucny',
         jsonb_build_array(jsonb_build_object('dim','company','value',(SELECT id FROM public.twin_entities WHERE label = '${JMENO_G}' LIMIT 1)::text,'resolver','twin')),
         '{"receivables":{${P}}}'::jsonb);
  IF (v->'data'->>'dluh')::numeric IS DISTINCT FROM 1000 OR strpos(v->>'answer', 'U 1 vydaných faktur') = 0 THEN
    RAISE 'smíšený stav: dluh 1000 a přiznaný doklad bez stavu: % / %', v->'data', v->>'answer'; END IF;
`),
    ).not.toThrow();
  });

  it("čerstvost karty = příchod posledního dokladu protistrany, ne čas zavolání; bez dokladů `:no_data`", () => {
    const cerstvost = (rpc: string, params: string) =>
      `(public.${rpc}('${params}'::jsonb)->'provenance')`;
    const karta = [
      ["get_counterparty_card", `{"debtor":"${ICO_B}"}`],
      ["get_counterparty_metric", `{"debtor":"${ICO_B}","metric":"invoiced_12m",${P}}`],
      ["get_counterparty_web", `{"debtor":"${ICO_B}"}`],
      ["get_counterparty_trend", `{"debtor":"${ICO_B}","months":24,${P}}`],
      ["get_counterparty_aging", `{"debtor":"${ICO_B}",${P}}`],
      ["get_debtor_invoices", `{"debtor":"${ICO_B}","only_open":"false",${P}}`],
    ];
    expect(
      spust(`${casy}
  -- doklady BETA dorazily před 40 dny (backfill i živý tah nesou čas příchodu)
  UPDATE public.li_source_registry SET created_at = now() - interval '40 days' WHERE source_sha256 LIKE 'cp-b%';
${karta.map(([rpc, par]) => `
  v := ${cerstvost(rpc, par)};
  IF left(v->>'freshness_at', 10) IS DISTINCT FROM to_char((now() - interval '40 days') at time zone 'UTC', 'YYYY-MM-DD')
     OR v->>'trace_id' ~ ':no_data$' THEN
    RAISE '${rpc}: čerstvost má být příchod posledního dokladu (před 40 dny), je %', v; END IF;`).join("")}
  -- protistrana bez jediného dokladu: přizná prázdné univerzum
  v := ${cerstvost("get_counterparty_card", '{"debtor":"99999999"}')};
  IF v->>'trace_id' !~ ':no_data$' THEN RAISE 'karta bez dokladů musí nést :no_data, je %', v; END IF;
`),
    ).not.toThrow();
  });

  it("Ask vztah: „je náš zákazník?“ začíná současností, historie až za ní; IČO z hlavičky karty", () => {
    expect(
      spust(`${casy}
  v := public.answer_verified_facts('Je ${JMENO_B} náš zákazník?', 'strucny',
         jsonb_build_array(jsonb_build_object('dim','company','value',v_tb::text,'resolver','twin')), '{}'::jsonb);
  IF v->>'intent' IS DISTINCT FROM 'relationship' THEN RAISE 'záměr: čekán relationship, je % (%)', v->>'intent', v->>'answer'; END IF;
  -- současnost: poslední doklad (přijatá faktura před 200 dny) a 12 m PŘED obdobím odběratele
  IF strpos(v->>'answer', 'poslední doklad ' || ${denCs(-200)}) = 0
     OR strpos(v->>'answer', 'vyfakturováno 0 Kč') = 0
     OR strpos(v->>'answer', 'Odběratel') = 0
     OR strpos(v->>'answer', 'poslední doklad') > strpos(v->>'answer', 'Odběratel')
     OR strpos(v->>'answer', ${denCs(-1500)} || ' → ' || ${denCs(-1300)}) = 0
     OR strpos(v->>'answer', 'Dodavatel') = 0 THEN
    RAISE 'vztah v čase (současnost první): %', v->>'answer'; END IF;
  v := public.answer_verified_facts('Jaké je IČO ${JMENO_B}?', 'strucny',
         jsonb_build_array(jsonb_build_object('dim','company','value',v_tb::text,'resolver','twin')), '{}'::jsonb);
  IF v->>'intent' IS DISTINCT FROM 'tenant_seat' OR strpos(v->>'answer', '${ICO_B}') = 0 THEN
    RAISE 'IČO z hlavičky karty: % / %', v->>'intent', v->>'answer'; END IF;
`),
    ).not.toThrow();
  });
});
