import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Nárok na povrchových RPC — RUNTIME měření pod DVĚMA identitami.
 *
 * PROČ TAHLE BRÁNA EXISTUJE
 * -------------------------
 * Tři čtvrtiny funkcí v `public` jsou SECURITY DEFINER (naměřeno 2026-08-02:
 * 1 470 DEFINER × 463 INVOKER; 1 287 DEFINER smí zavolat kdokoli přihlášený,
 * 1 252 z nich sahá na tabulku s RLS). U DEFINER se RLS volajícího NEPOUŽIJE —
 * pravidlo se z jednoho deklarativního místa (politika u tabulky) rozpadne do
 * N imperativních kopií a ochrana je pak tak silná jako nejslabší z nich.
 * Poznat, která to je, jde jedině spuštěním pod dvěma identitami.
 *
 * ⭐ CO SE MĚŘÍ A PROČ PRÁVĚ TAKHLE
 * Tuhle otázku jsem 2026-08-02 zodpověděl třikrát špatně, pokaždé jiným
 * měřidlem. Brána nese všechny tři opravy, protože bez nich měří něco jiného,
 * než si myslí:
 *
 *   1. `auth.uid() is null` NENÍ nárok. Je to ověření, že je někdo přihlášený.
 *      Grep na jméno pomocníka proto nestačí — musí se volat.
 *   2. md5 celé odpovědi lže. Funkce, která si do payloadu razítkuje `now()`,
 *      vyjde jako „liší se" i sama proti sobě. Proto KONTROLNÍ SKUPINA: totéž
 *      volání dvakrát pod TOUŽ identitou, a nedeterministická pole se před
 *      porovnáním odstraní.
 *   3. „Shodné" ještě neznamená „uniká". Devět funkcí vyšlo shodně proto, že
 *      jsou PRÁZDNÉ pro všechny. Prázdno se proto počítá zvlášť.
 *
 * UNIVERZUM SI BRÁNA HLEDÁ
 * Nezná žádný seznam funkcí. Bere `surface_blocks.source_rpc` — tedy to, na co
 * uživatel přes rozhraní SKUTEČNĚ dosáhne, deklarované daty. Nový blok je
 * pokrytý bez sahání do brány; blok, který zmizí, univerzum zmenší a to je
 * vidět v tvrzení o netriviálnosti níž.
 *
 * ⛔ NEMĚŘÍ nad prázdnem: pokud pro privilegovanou identitu nevrátí data ANI
 * JEDNA funkce, brána SELŽE. Zelená nad nulou je horší než žádná brána.
 *
 * BEZPEČNOST ZÁPISU
 * Měření běží v transakci, která se na konci VŽDY vrátí. Část povrchových RPC
 * je VOLATILE (20 z 36 naměřeno — výchozí volatilita v PL/pgSQL), takže by
 * teoreticky mohla zapisovat; rollback to pokrývá. Funkce uvnitř transakčního
 * bloku commitnout nemůže (to umí jen procedura), takže z transakce neuteče.
 *
 * RATCHET, NE ABSOLUTNÍ PRAVIDLO
 * Shodná odpověď pro obě identity je u číselníku SPRÁVNĚ (měna, jazyky, katalog
 * fází). Brána proto nezakazuje shodu — zakazuje NOVOU shodu: co je v baseline,
 * je vědomě povolené i s důvodem; cokoli dalšího musí projít rozhodnutím.
 */

const dbAvailable = isPgReachable();
const BASELINE = path.join(process.cwd(), "src/tests/db/surface-rpc-entitlement.baseline.json");

/**
 * ⛔ TŘI HODNOTY, NE DVĚ (2026-10-04). Univerzum jsou INSTANČNÍ surface_blocks —
 * sekce a bloky jsou data instance, generický strom (upstream, throwaway DB
 * z core seedu) je nemá. Tam brána NEMÁ CO MĚŘIT a v `test:db` padala na
 * „univerzum je prázdné". Prohlásit to za zelené by byl fail-open; padat by
 * blokovalo upstream za něco, co není vada. SKIPPED s důvodem v názvu je
 * poctivá třetí odpověď (`skipped ≠ success`).
 *
 * Proč ne univerzum ze SoT (jako patro 1 surface-block-contract): ověřeno
 * 2026-10-04 — nad core seedem to dalo 31 „shodných" producentů a VŠECHNY
 * byly prázdné obálky (`rows: []`, `value: 0`, popisky sloupců). Bez dat, která
 * privilegovaná identita smí vidět a bezrolová ne, se shoda od úniku odlišit
 * nedá; „chytřejší" detekce obsahu by bránu oslepila právě na únik jmen.
 */
function katalogBloku(): number {
  try {
    return Number(psqlQuery("SELECT count(*) FROM public.surface_blocks WHERE source_rpc IS NOT NULL")) || 0;
  } catch {
    return 0;
  }
}
const NEZMERENO = !dbAvailable
  ? "DB nedostupná"
  : katalogBloku() === 0
    ? "bez instančního katalogu surface_blocks (generický strom)"
    : null;
const pozn = NEZMERENO ? ` — NEZMĚŘENO: ${NEZMERENO}` : "";

/** Klíče, které nesou čas běhu, ne obsah — před porovnáním se odstraní. */
const VOLATILE_KEYS = [
  "freshness_at",
  "generated_at",
  "created_at",
  "updated_at",
  "as_of",
  "measured_at",
  "trace_id",
];

/**
 * Jedno SQL, které založí dvě identity, projde univerzum a vydá klasifikaci.
 * Vrací řádky `fn|verdikt` — TS strana jen porovnává s baseline.
 */
function measurementSql(): string {
  return `\\set ON_ERROR_STOP on
BEGIN;

-- Dvě identity, obě jen pro tenhle běh; rollback je uklidí.
-- A = privilegovaná (role), B = bez jediné role. Nic instančního: uid jsou
-- náhodná, role se berou z enumu, takže to platí v každé instanci.
CREATE TEMP TABLE ident(tag text primary key, uid uuid) ON COMMIT DROP;
INSERT INTO ident VALUES ('A', gen_random_uuid()), ('B', gen_random_uuid());

INSERT INTO aisha_auth.users (id, email)
SELECT uid, tag || '-narok-test@example.invalid' FROM ident;

-- Role jen pro A. Bere se PRVNÍ hodnota enumu, aby brána nezávisela na tom,
-- jak se ta konkrétní role v instanci jmenuje.
INSERT INTO public.user_roles (user_id, role)
SELECT uid, (SELECT e.enumlabel::text::public.app_role
             FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'app_role' ORDER BY e.enumsortorder LIMIT 1)
FROM ident WHERE tag = 'A';

-- Odstranění nedeterministických klíčů: bez toho porovnáváme razítka, ne obsah.
CREATE FUNCTION pg_temp.scrub(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE jsonb_typeof(v)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(k, pg_temp.scrub(val))
      FROM jsonb_each(v) AS e(k, val)
      WHERE k <> ALL (ARRAY[${VOLATILE_KEYS.map((k) => `'${k}'`).join(",")}])
    ), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(pg_temp.scrub(x)) FROM jsonb_array_elements(v) AS a(x)
    ), '[]'::jsonb)
    ELSE v END;
$fn$;

-- Prázdno se pozná podle OBSAHU, ne podle jednoho jména pole. Bloky mají různé
-- tvary (rows, items, runs, fields, points…) a kdyby brána znala jen dva z nich,
-- prázdná odpověď v jiném tvaru by jí propadla jako „shodná = uniká". Naměřeno
-- 2026-08-02: get_document_detail bez document_id vrací {record_id: null,
-- fields: []} a spadl přesně do téhle pasti.
--
-- OBÁLKOVÉ klíče se NEPOČÍTAJÍ jako obsah — jsou dané kontraktem bloku a jsou
-- tam i když data nejsou: "columns"/"actions" je schéma tabulky a nabídka
-- rozhodnutí, "entity_kind"/"unit_key"/"*_key" je popis, ne hodnota. Tabulka bez
-- řádků má sloupce pořád; fronta bez položek má pořád tlačítka. Kdyby se
-- počítaly, nebyl by prázdný nikdy nikdo. (Naměřeno 2026-08-02 na
-- get_workflow_my_steps_block: samotné "entity_kind" ho vydávalo za neprázdný.)
-- Skalár JINDE než v obálce se počítá — kpi_tile nese svou hodnotu právě tak.
CREATE FUNCTION pg_temp.has_content(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE jsonb_typeof(v)
    WHEN 'array'  THEN jsonb_array_length(v) > 0
    WHEN 'object' THEN coalesce((
      SELECT bool_or(pg_temp.has_content(val))
      FROM jsonb_each(v) AS e(k, val)
      WHERE k <> ALL (ARRAY['columns','actions','entity_kind','unit_key'])
        AND k NOT LIKE '%_key'
    ), false)
    WHEN 'null'   THEN false
    WHEN 'string' THEN v #>> '{}' <> ''
    ELSE true END;
$fn$;

CREATE TEMP TABLE result(fn text primary key, verdict text) ON COMMIT DROP;
GRANT SELECT, INSERT ON result TO PUBLIC;
GRANT SELECT ON ident TO PUBLIC;

-- ⭐⛔ ROLE, NE JEN CLAIMS. Nastavit request.jwt.claims a nepřepnout roli znamená
-- měřit jako superuser: RLS se na něj nevztahuje, takže OBĚ „identity" dostanou
-- všechno a brána projde zeleně nad nesmyslem. Naměřeno 2026-08-02 přesně takhle
-- — chybu odhalilo až křížové ověření proti známé odpovědi (skutečný bezrolový
-- účet dostal 0 řádků tam, kde syntetický dostal 50).
SET LOCAL ROLE authenticated;

DO $do$
DECLARE
  r record; a1 jsonb; a2 jsonb; b jsonb; uid_a uuid; uid_b uuid;
BEGIN
  SELECT uid INTO uid_a FROM ident WHERE tag = 'A';
  SELECT uid INTO uid_b FROM ident WHERE tag = 'B';

  -- KANÁRCI na obě věci, které se dají tiše pokazit. Netýkají se žádné konkrétní
  -- funkce (na jejím tvaru by kanárek zvětral), ale samotného měřidla:
  --
  --  1) ROLE. Superuser RLS obchází, takže by obě identity dostaly všechno
  --     a brána by zezelenala nad nesmyslem. Přesně tohle se 2026-08-02 stalo.
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'KANAREK SELHAL: měření běží jako %, ne jako authenticated — RLS by se neuplatnila a obě identity by dostaly všechno.', current_user;
  END IF;
  --  2) CLAIMS. Když se "sub" nepřepne, měříme dvakrát touž identitu a každá
  --     shoda je pak triviální.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM uid_a THEN
    RAISE EXCEPTION 'KANAREK SELHAL: po nastavení claims pro A vrací auth.uid() % místo %.', auth.uid(), uid_a;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM uid_b THEN
    RAISE EXCEPTION 'KANAREK SELHAL: po nastavení claims pro B vrací auth.uid() % místo %.', auth.uid(), uid_b;
  END IF;

  FOR r IN
    -- univerzum = co povrch deklaruje jako svůj zdroj, ne můj seznam
    SELECT DISTINCT b.source_rpc AS fn,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM public.surface_blocks b
    JOIN pg_proc p ON p.proname = b.source_rpc
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE b.source_rpc IS NOT NULL
      AND NOT p.proretset
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND pg_get_function_identity_arguments(p.oid) IN ('', 'p_params jsonb')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', uid_a, 'role', 'authenticated')::text, true);
      EXECUTE format('SELECT pg_temp.scrub(public.%I(%s))', r.fn,
                     CASE WHEN r.args = '' THEN '' ELSE '''{}''::jsonb' END) INTO a1;
      -- kontrolní skupina: TÁŽ identita podruhé
      EXECUTE format('SELECT pg_temp.scrub(public.%I(%s))', r.fn,
                     CASE WHEN r.args = '' THEN '' ELSE '''{}''::jsonb' END) INTO a2;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', uid_b, 'role', 'authenticated')::text, true);
      EXECUTE format('SELECT pg_temp.scrub(public.%I(%s))', r.fn,
                     CASE WHEN r.args = '' THEN '' ELSE '''{}''::jsonb' END) INTO b;

      INSERT INTO result VALUES (r.fn, CASE
        WHEN a1 IS DISTINCT FROM a2 THEN 'NEDETERMINISTICKA'
        WHEN a1 IS NULL OR NOT pg_temp.has_content(a1->'data') THEN 'PRAZDNA'
        WHEN a1 IS NOT DISTINCT FROM b THEN 'SHODNA'
        ELSE 'LISI_SE' END);
    EXCEPTION WHEN OTHERS THEN
      -- chyba se NESMÍ tvářit jako „v pořádku"; zaznamená se jako neměřeno
      INSERT INTO result VALUES (r.fn, 'CHYBA:' || replace(SQLERRM, '|', ' '));
    END;
  END LOOP;
END $do$;

SELECT fn || '|' || verdict FROM result ORDER BY fn;
ROLLBACK;
`;
}

interface Baseline {
  /** Funkce, u kterých je shoda pro obě identity VĚDOMÁ — s důvodem. */
  shodne_vedome: Record<string, string>;
}

beforeAll(async () => {
  await reportTestCapabilities("nárok povrchových RPC pod dvěma identitami");
});

describe("povrchová RPC rozlišují nárok podle identity", () => {
  const rows: Array<{ fn: string; verdict: string }> = [];

  it.skipIf(NEZMERENO !== null)(`měření proběhne a univerzum není prázdné${pozn}`, () => {
    const out = psqlMultiline(measurementSql());
    for (const line of out.split("\n")) {
      const m = /^([a-z0-9_]+)\|(.+)$/.exec(line.trim());
      if (m && m[1] && m[2]) rows.push({ fn: m[1], verdict: m[2] });
    }

    expect(rows.length, "univerzum je surface_blocks.source_rpc — prázdné znamená, že brána měří nad ničím").toBeGreaterThan(0);

    // ⭐ Zelená nad nulou je horší než žádná brána: aspoň jedna funkce musí
    // privilegované identitě něco VRÁTIT, jinak se shoda nedá odlišit od ticha.
    const withData = rows.filter((r) => r.verdict === "SHODNA" || r.verdict === "LISI_SE");
    expect(
      withData.length,
      `žádná z ${rows.length} funkcí nevrátila privilegované identitě data — ` +
        "měření by bylo vakuové (verdikty: " +
        [...new Set(rows.map((r) => r.verdict.split(":")[0]))].join(", ") +
        ")",
    ).toBeGreaterThan(0);
  });

  it.skipIf(NEZMERENO !== null)(`žádná NOVÁ funkce nevrací oběma identitám totéž${pozn}`, () => {
    const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    const known = new Set(Object.keys(baseline.shodne_vedome));
    const offenders = rows.filter((r) => r.verdict === "SHODNA" && !known.has(r.fn)).map((r) => r.fn);

    expect(
      offenders,
      "tyhle RPC vracejí neprivilegované identitě TOTÉŽ co privilegované. " +
        "Buď jim doplň nárok, nebo — je-li shoda správná (číselník, konfigurace) — " +
        "zapiš je do surface-rpc-entitlement.baseline.json S DŮVODEM.",
    ).toEqual([]);
  });

  it.skipIf(NEZMERENO !== null)(`baseline nezvětrala — co v ní je, pořád existuje a pořád je shodné${pozn}`, () => {
    const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    const byFn = new Map(rows.map((r) => [r.fn, r.verdict]));
    const stale: string[] = [];
    for (const fn of Object.keys(baseline.shodne_vedome)) {
      const v = byFn.get(fn);
      // Funkce, která se mezitím naučila nárok, nebo z povrchu zmizela, nemá
      // v baseline co dělat — jinak by ta výjimka kryla i její návrat.
      if (v === undefined || v === "LISI_SE") stale.push(`${fn} (${v ?? "už není v univerzu"})`);
    }
    expect(stale, "vyřaď je z baseline — výjimka bez důvodu je jen díra s razítkem").toEqual([]);
  });

  it.skipIf(NEZMERENO !== null)(`nic nezůstalo neměřené potichu${pozn}`, () => {
    const unmeasured = rows.filter(
      (r) => r.verdict === "NEDETERMINISTICKA" || r.verdict.startsWith("CHYBA:"),
    );
    // Nedeterministická funkce po odstranění razítek znamená, že nese další
    // proměnlivé pole — patří do VOLATILE_KEYS, ne pod koberec.
    expect(
      unmeasured.map((r) => `${r.fn} → ${r.verdict}`),
      "tyhle funkce se nepodařilo změřit; doplň klíč do VOLATILE_KEYS nebo oprav volání",
    ).toEqual([]);
  });
});
