import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Deklarace zařízení v databázi — RUNTIME proti skutečné DB.
 *
 * Proč runtime: vlastnosti níž jsou o CHOVÁNÍ databáze pod konkrétní identitou.
 *
 *  1. Deklarace určuje, co Kiosk Admin nainstaluje na tablety (otisky balíčků,
 *     výbava s adresou API a dveřmi). Zapisovat ji smí jen hák dat instance
 *     (service role), číst jen storage-auth (service role). Přihlášený účet ani
 *     anonym nesmí ANI JEDNO — zkouší se to jako oni, ne čtením grantů.
 *  2. Hák ji zapisuje DOSLOVNĚ (1:1, commit dat instance) a každé nasazení ji
 *     PŘEPÍŠE — tabulka má právě jeden řádek, žádná historie vedle.
 *  3. Nesmysl (ne-objekt, bez `applicationId`) musí VYHODIT → červená migrace,
 *     ne tichý zápis, který by storage-auth pak četl jako „vypnuto".
 *
 * RAISE uvnitř DO bloku → nenulový exit psql → psqlMultiline vyhodí → pád testu.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("Deklarace zařízení v databázi");
});

describe("deklarace zařízení — přístup a zápis (živá DB)", () => {
  it.skipIf(!dbAvailable)(
    "přihlášený účet ani anonym deklaraci nezapíše ani nepřečte",
    () => {
      const vystup = psqlMultiline(
        HEADER +
          `
begin;
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  do $$
  declare v_chyba text;
  begin
    begin
      perform public.zarizeni_deklarace_zapis('{"applicationId":"com.example.hlidac"}'::jsonb, 'x');
      raise exception 'STRÁŽ NEDRŽÍ: přihlášený účet zapsal deklaraci zařízení';
    exception
      when insufficient_privilege then null;
      when others then
        get stacked diagnostics v_chyba = message_text;
        if v_chyba like '%STRÁŽ NEDRŽÍ%' then raise; end if;
        if v_chyba not like '%Unauthorized%' and v_chyba not like '%permission denied%' then
          raise exception 'jiná chyba než odmítnutí: %', v_chyba;
        end if;
    end;
    begin
      perform public.zarizeni_deklarace_cteni();
      raise exception 'STRÁŽ NEDRŽÍ: přihlášený účet přečetl deklaraci zařízení';
    exception
      when insufficient_privilege then null;
      when others then
        get stacked diagnostics v_chyba = message_text;
        if v_chyba like '%STRÁŽ NEDRŽÍ%' then raise; end if;
        if v_chyba not like '%Unauthorized%' and v_chyba not like '%permission denied%' then
          raise exception 'jiná chyba než odmítnutí: %', v_chyba;
        end if;
    end;
  end $$;
rollback;
begin;
  set local role anon;
  do $$
  begin
    begin
      perform public.zarizeni_deklarace_cteni();
      raise exception 'STRÁŽ NEDRŽÍ: anonym přečetl deklaraci zařízení';
    exception when insufficient_privilege then null;
    end;
  end $$;
rollback;
select 'STRAZ_OK' as vysledek;
`,
      );
      expect(vystup).toContain("STRAZ_OK");
    },
    120_000,
  );

  it.skipIf(!dbAvailable)(
    "hák zapíše doslovně, další nasazení přepíše, nesmysl vyhodí",
    () => {
      const vystup = psqlMultiline(
        HEADER +
          `
begin;
  set local role service_role;
  do $$
  declare
    v_prvni jsonb := '{"applicationId":"com.example.hlidac","kiosk":{"package":"com.example.kiosk"},"appky":[{"balicek":"com.example.kiosk","versionCode":14}]}'::jsonb;
    v_druha jsonb := '{"applicationId":"com.example.hlidac","versionCode":15}'::jsonb;
    v jsonb;
    v_pocet int;
  begin
    perform public.zarizeni_deklarace_zapis(v_prvni, 'commit-1');
    v := public.zarizeni_deklarace_cteni();
    if v -> 'deklarace' is distinct from v_prvni then raise exception 'deklarace NENÍ doslovná: %', v -> 'deklarace'; end if;
    if v ->> 'commit' is distinct from 'commit-1' then raise exception 'commit dat instance se neuložil'; end if;

    perform public.zarizeni_deklarace_zapis(v_druha, 'commit-2');
    select count(*) into v_pocet from public.zarizeni_deklarace;
    if v_pocet <> 1 then raise exception 'deklarace má % řádků, čekám právě 1', v_pocet; end if;
    v := public.zarizeni_deklarace_cteni();
    if v -> 'deklarace' is distinct from v_druha then raise exception 'další nasazení deklaraci NEPŘEPSALO'; end if;

    begin
      perform public.zarizeni_deklarace_zapis('[1,2]'::jsonb, 'x');
      raise exception 'ne-objekt se ZAPSAL';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.zarizeni_deklarace_zapis('{"verze":1}'::jsonb, 'x');
      raise exception 'deklarace bez applicationId se ZAPSALA';
    exception when sqlstate '22023' then null;
    end;
  end $$;
rollback;
select 'ZAPIS_OK' as vysledek;
`,
      );
      expect(vystup).toContain("ZAPIS_OK");
    },
    120_000,
  );

  it.skipIf(!dbAvailable)(
    "mechanismus háku: psql si JSON načte ze souboru dat instance a doručí ho beze změny",
    () => {
      // Týž tvar jako `64_zarizeni_deklarace.sql` v datech instance. JSON záměrně
      // nese apostrof, češtinu a nový řádek — kdyby `:'dekl'` uvozoval špatně,
      // hák by zapsal něco jiného, než stojí v souboru (nebo spadl až v provozu).
      const koren = mkdtempSync(join(tmpdir(), "idata-"));
      mkdirSync(join(koren, "zarizeni"));
      const deklarace = {
        applicationId: "com.example.hlidac",
        label: "Řidičův tablet — O'Brien",
        $note: "víceřádková\npoznámka",
        appky: [{ balicek: "com.example.kiosk", versionCode: 14, sha256: "a".repeat(64) }],
      };
      writeFileSync(join(koren, "zarizeni", "hlidac.json"), JSON.stringify(deklarace, null, 2) + "\n");
      const puvodni = { dir: process.env.AISHA_INSTANCE_DATA_DIR, commit: process.env.AISHA_INSTANCE_DATA_COMMIT };
      process.env.AISHA_INSTANCE_DATA_DIR = koren;
      process.env.AISHA_INSTANCE_DATA_COMMIT = "abc123";
      try {
        const vystup = psqlMultiline(
          HEADER +
            `
begin;
set local role service_role;
\\set dekl \`cat "$AISHA_INSTANCE_DATA_DIR"/zarizeni/hlidac.json\`
\\set commit \`printf '%s' "$AISHA_INSTANCE_DATA_COMMIT"\`
select public.zarizeni_deklarace_zapis(:'dekl'::jsonb, :'commit');
select case
  when public.zarizeni_deklarace_cteni() -> 'deklarace' = '${JSON.stringify(deklarace).replace(/'/g, "''")}'::jsonb
   and public.zarizeni_deklarace_cteni() ->> 'commit' = 'abc123'
  then 'SHODA_OK' else 'SHODA_NESEDI' end as vysledek;
rollback;
`,
        );
        expect(vystup).toContain("SHODA_OK");
      } finally {
        if (puvodni.dir === undefined) delete process.env.AISHA_INSTANCE_DATA_DIR; else process.env.AISHA_INSTANCE_DATA_DIR = puvodni.dir;
        if (puvodni.commit === undefined) delete process.env.AISHA_INSTANCE_DATA_COMMIT; else process.env.AISHA_INSTANCE_DATA_COMMIT = puvodni.commit;
        rmSync(koren, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
