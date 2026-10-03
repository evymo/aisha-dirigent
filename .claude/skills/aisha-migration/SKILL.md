---
name: aisha-migration
description: Change the AISHA database schema the way this repo actually deploys it — SoT files under aisha/db/sql/ are the source of truth, heals.sql is HOW the change reaches a running database, and the baseline is a generated artifact for cold start only. Use when adding or modifying tables, RPC functions, indexes, RLS policies, triggers, or grants. Triggers on "create migration", "add table", "new RPC", "schema change", "add column", "alter table", "new index", "new policy", "RLS". Critical: do NOT create timestamped migration files — the baseline-only-release gate rejects them; and a SoT file with no \ir in heals.sql never reaches an existing database.
---

# AISHA Migration Skill

Změna schématu má v tomhle repu **jednu pravdu, jeden způsob a jeden generovaný
artefakt** — a ty se nesmí plést:

| co | k čemu je | kdo to přehraje |
|---|---|---|
| `aisha/db/sql/{tables,functions,policies,indexes,…}/*.sql` | **SOURCE OF TRUTH** — vždy popisuje CÍLOVÝ stav | nikdo přímo; je to předloha |
| `aisha/db/heals.sql` | **ZPŮSOB MIGRACE** — `\ir` na SoT soubory | **každý `db:migrate`**, tedy i běžící produkce |
| `aisha/db/migrations/00000000000000_baseline.sql` | generovaný artefakt: celé schéma složené ze SoT | **jen COLD START** čisté DB |

## Kritická pravidla — NIKDY NEPORUŠOVAT

1. **NEVYTVÁŘEJ timestampované migrace** (`aisha/db/migrations/20260730…_neco.sql`).
   Repo je *wipe-first*: brána `src/tests/gates/baseline-only-release.gate.test.ts`
   vyžaduje, aby v `aisha/db/migrations/` byl **JEN** generovaný baseline. Nová
   migrace shodí i `migration-safety` a `no-instance-data-in-public`.
   Historii schématu nese git nad SoT soubory, ne řada delta-skriptů.

2. **NIKDY needituj `00000000000000_baseline.sql` přímo** — je auto-generován
   z `aisha/db/sql/` přes `npm run db:init:generate`. Ruční edit zmizí při příští
   regeneraci.

3. **NIKDY needituj `aisha/db/seed.sql` přímo** — je compiled z `aisha/db/seed/`
   přes `npm run db:seed:compile`.

4. ⛔ **SoT soubor bez `\ir` v `heals.sql` se na EXISTUJÍCÍ databázi NEPŘEHRAJE.**
   Baseline běží jen při cold startu. Tohle je nejčastější způsob, jak „hotová"
   oprava nikdy nedoteče do produkce: soubor je v repu, brány zelené, baseline
   správný — a živá DB má pořád starou verzi. Hlídá to brána
   `src/tests/gates/rls-predikat-a-indexy.gate.test.ts` (sekce „Co není v heals").

## Postup (jediný správný)

```
 1. napiš/uprav SoT soubor      aisha/db/sql/{kind}/{name}.sql   (cílový stav, idempotentní)
 2. zapoj ho do heals.sql       \ir sql/{kind}/{name}.sql        ← BEZ TOHO TO NEDOTEČE
 3. regeneruj baseline          npm run db:init:generate
 4. zkontroluj diff baseline    git diff aisha/db/migrations/00000000000000_baseline.sql
 5. brány                       npm run test:gates
 6. cold start je jediný důkaz  čistá DB musí projít od nuly
```

### 1. SoT soubor — vždy idempotentní

Funkce `CREATE OR REPLACE`, tabulka `CREATE TABLE IF NOT EXISTS`, index
`CREATE INDEX IF NOT EXISTS`, policy/trigger `DROP … IF EXISTS` + `CREATE …`.
Heals se přehrává při **každém** migrate, takže neidempotentní soubor rozbije
každý druhý deploy.

Když soubor NAHRAZUJE starší objekt (sloučení policies, přejmenování), patří
`DROP … IF EXISTS` starých jmen **do nového souboru** — včetně jmen, která žijí
jen v produkci a v SoT nikdy nebyla. Jinak zůstanou vedle nové verze; u
permisivních policies se OR-ují a novou verzi znegují.

### 2. Zapojení do heals.sql — na pořadí ZÁLEŽÍ

Vykonává se shora dolů, takže závislosti musí být dřív:
`tabulka` → její `indexy`/`policies`/`triggery`; `funkce` → `policy`, která ji volá.

Po skupině změn dej `NOTIFY pgrst, 'reload schema';` — PostgREST jinak nové nebo
změněné RPC neuvidí.

Ke každému `\ir` bloku napiš **proč** — co se měřilo, co se zjistilo. `heals.sql`
je jediné místo, kde je vidět chronologie zásahů; SoT ukazuje jen aktuální stav.

### 3–4. Regenerace a kontrola baseline

```bash
npm run db:init:generate
git diff aisha/db/migrations/00000000000000_baseline.sql
```

V diffu **nesmí být nic, co jsi nezměnil**. Když tam je, někdo před tebou upravil
živou DB nebo baseline mimo SoT — a ten drift se právě teď zapíše do repa jako
tvoje změna.

### 5. Brány + typy

```bash
npm run test:gates                 # celé; padne i na cizí drift, čti pozorně
npm run func:validate              # validace SQL funkcí
npm run db-mgr:source              # SoT audit
npm run db:types:gen:local && npx tsc --noEmit   # když se mění tvar dat pro app
```

## RLS policy — predikát nároku patří do InitPlanu

**Predikát RLS se vyhodnocuje PER ŘÁDEK.** Authz pomocník, který na řádku
nezávisí, se proto musí obalit do poddotazu, aby ho plánovač vyhodnotil jednou:

```sql
-- ⛔ ŠPATNĚ: is_admin_or_staff() proběhne pro KAŽDÝ řádek
CREATE POLICY t_read ON public.t FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

-- ✅ SPRÁVNĚ: poddotaz → InitPlan, jedno vyhodnocení za dotaz
CREATE POLICY t_read ON public.t FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
```

Změřeno na produkci 2026-07-30 (`li_source_registry`, 43 157 řádků):

| varianta | admin | identita BEZ nároku |
|---|---|---|
| per-row predikát | 10 405 ms | **41 252 ms** (a vrátí 0 řádků) |
| poddotaz → InitPlan | **27 ms** | **42 ms** |

Neoprávněný platil nejvíc — jedním requestem vytížil DB na 41 s. Není to tedy jen
latence, je to **DoS páka**.

Dvě pasti, obě změřené:
- **`STABLE` samo NESTAČÍ** (10 509 ms). Postgres STABLE funkci z RLS `qual`
  nevytáhne; vytáhne jen poddotaz. `STABLE` deklaruj proto, že je pravdivá.
- **Neuklízej „duplicitní" policy podle vzhledu.** Zrušení identické policy dalo
  30 419 ms (3× horší): zmizel člen, který OR zkracoval. Ochranu musí nést
  **množinový** první konjunkt (`x IN (SELECT …)`), ne pořadí v OR — Postgres
  zkratku negarantuje (viz komentář v `is_admin_or_staff.sql`).

Per-row je naopak **správně** u predikátu závislého na řádku — korelovaný
`EXISTS (… WHERE ps.story_id = tabulka.story_id …)` je semi-join, ne režie.

### Změna policy = doložit, že nárok zůstal

Před/po porovnej **množinu viditelných řádků** pro každou třídu identity, ne čas:

```sql
begin;
select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}', true);
set local role authenticated;
select count(*), md5(string_agg(id::text, ',' order by id)) from public.t;
rollback;
```

Shodný `md5` před i po = nárok se nezměnil ani o řádek.

Dvě věci, které měření kazí:
- **`service_role` má RLS bypass** — pod ním měření o RLS neřekne NIC (týž registr:
  855 ms pod service_role vs 13 119 ms pod reálnou identitou). Měř pod
  `authenticated` se `request.jwt.claims`.
- **A/B se dá měřit bez nasazení**: `ALTER`/`CREATE POLICY` jsou v Postgresu
  transakční, takže variantu lze změřit v `begin; … rollback;` i na produkci.

## Index — cast v joinu potřebuje funkční index

Cast na straně **naší** tabulky zahodí index → Seq Scan:

```sql
-- generický blok: source_key je TEXT (cizí klíč), id je uuid
left join li_source_registry li on li.id::text = r.source_key   -- Seq Scan 43 157×
```

**Neopravuj to přepsáním castu na druhou stranu** (`r.source_key::uuid`) — cizí
klíč nemusí mít náš typ a rozbiješ genericitu. Změřeno: `li-contracts` 14/14 UUID,
ale `jiný zdroj` 0/37 (klíče jsou názvy firem a lokalit), webdispecink
0/1. Cast by spadl, jakmile někdo blok přesměruje na jiný zdroj. Rychlejší
mikro-benchmark tu vede ke špatné opravě.

Správně je **funkční index na tom výrazu**:

```sql
CREATE INDEX IF NOT EXISTS idx_li_source_registry_id_text
  ON public.li_source_registry (((id)::text));
```

Změřeno: join 886 ms → 0,55 ms; blok `pd_review` 673 → 5,1 ms; `pd_recommend`
576 → 3,1 ms. Hlídá brána `rls-predikat-a-indexy` (sekce „Cast v join podmínce").

## Ostatní patterny

### RPC: SECURITY DEFINER + REVOKE/GRANT

```sql
CREATE OR REPLACE FUNCTION public.{name}(p_arg type)
RETURNS {type}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- SECURITY DEFINER pomocník MUSÍ autorizovat sám sebe. „Volá se to jen
  -- zevnitř" NENÍ autorizace — bez tohohle je funkce orákulum pro každého
  -- přihlášeného.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  ...
END;
$$;

REVOKE ALL ON FUNCTION public.{name}(type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.{name}(type) TO authenticated, service_role;
```

Pomocník přijímající `p_uid` od volajícího musí mít **oracle guard** —
`p_uid IS NOT DISTINCT FROM auth.uid() OR is_service_role() OR is_admin_or_staff()`
— jinak predikát prozradí stav cizích účtů.

### Grant pro `authenticated` je součást API

Funkce volaná z policy se vyhodnocuje **jako volající**, takže potřebuje
`GRANT EXECUTE` pro `authenticated`, i když se „volá jen zevnitř". Projeví se to
jako `ERROR: permission denied for function …` až v RLS predikátu — daleko od
místa, kde grant chybí.

### Audit u mutací

```sql
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (auth.uid(), '{action}', jsonb_build_object('key', value));
```

Nikdy PII (e-mail, tajemství, celé tělo requestu) — jen ID a metadata. A **nikdy
zápis na čtecí cestě**: audit per čtený request je RW transakce per request, tedy
právě to zdržení, které tenhle skill jinde odstraňuje.

### Složky garantují pořadí

`tables/` → `functions/` → `triggers/` → `policies/` → `indexes/`. Trigger
v souboru tabulky shodí cold start (`set_updated_at()` ještě neexistuje). Jedna
tabulka = jeden soubor, policies do `policies/`.

## Anti-patterny

| ❌ | proč |
|---|---|
| timestampovaná migrace | `baseline-only-release` gate ji zamítne; repo je wipe-first |
| edit `baseline.sql` | zmizí při `db:init:generate` |
| SoT soubor bez `\ir` v heals | na běžící DB se nikdy nepřehraje |
| neidempotentní SoT | heals běží při každém migrate → rozbije druhý deploy |
| nový objekt bez `DROP` starých jmen | staré policies se OR-ují k nové a znegují ji |
| `is_admin_or_staff()` v policy bez `(select …)` | per-row: 43 157 volání na jeden dotaz |
| přepsat cast na `::uuid` | rozbije genericitu (cizí klíč nemusí být UUID) |
| „uklidit" duplicitní policy | 3× horší (změřeno) — zmizí zkratka OR |
| měřit RLS pod `service_role` | má bypass → měříš jiný svět |
| `SELECT *` | explicitní sloupce |
| `.from('tabulka')` v app kódu | CLAUDE.md: jen RPC |
| tajemství v SQL | `pgsodium` / env |

## Quick reference

| akce | příkaz |
|---|---|
| regenerovat baseline ze SoT | `npm run db:init:generate` |
| brány | `npm run test:gates` |
| jedna brána | `npm run test:gates -- src/tests/gates/{name}.gate.test.ts` |
| validovat funkce | `npm run func:validate` |
| lint SQL | `npm run db-mgr:lint` |
| SoT audit | `npm run db-mgr:source` |
| aplikovat lokálně | `npm run db:migrate:local` |
| TS typy z DB | `npm run db:types:gen:local` |

## Reference

- `CLAUDE.md` — absolutní pravidla (RPC-only, žádné `.from()` v app kódu)
- `aisha/db/heals.sql` — způsob migrace + chronologie zásahů s důvody
- `aisha/db/baseline-meta.json` — stav baseline
- `src/tests/gates/baseline-only-release.gate.test.ts` — proč žádné timestampované migrace
- `src/tests/gates/rls-predikat-a-indexy.gate.test.ts` — per-row predikát, dosažitelnost z heals, cast v joinu
- `scripts/db/audit-sot-vs-migrations.py` — detektor driftu SoT vs. schéma
