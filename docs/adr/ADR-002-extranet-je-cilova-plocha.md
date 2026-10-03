# ADR-002: Extranet je cílová plocha, Appsmith je nástroj uvnitř ní

> **Status:** Accepted
> **Datum:** 2026-09-01
> **Kontext:** [CONNECT-AND-THRIVE-EXTRANET-VERIFICATION-2026-07-25.md](../../../CONNECT-AND-THRIVE-EXTRANET-VERIFICATION-2026-07-25.md),
> `<fork>-instance-data/43_audience_surface.sql`, [EXTRANET-FOUNDATION-PLAN-2026-07-19.md](../../../EXTRANET-FOUNDATION-PLAN-2026-07-19.md)

## Rozhodnutí

**Extranet je finální řešení.** Cockpit se nestaví ve dvou paralelních produktech —
plocha extranetu (surface bloky nad `surface_blocks` + `surface_data_rpcs`) je cíl,
kam patří všechno, co má tým denně používat.

**Appsmith zůstává, ale mění roli:** není to druhá cesta k témuž, je to **dílna na
ad-hoc dotazy** dostupná Z extranetu. Kdo si potřebuje složit vlastní pohled, otevře ji
odtud; co se osvědčí, se překlopí do surface bloku.

## Co to řeší

Dva dokumenty si odporovaly a rozpor nikdo nezapsal:

- `CONNECT-AND-THRIVE-…-2026-07-25.md`, krok **CT-1.4**: „Appsmith „Audience CRM" app
  (cockpit plane) — rebuild nad gateway."
- `43_audience_surface.sql` (2026-08-25): „**Přenáší Appsmith cockpit
  (`appsmith-templates/audience/`) na plochu extranetu.** Datová vrstva už existovala —
  chyběla jen obálka, kterou renderer umí přečíst."

Podle data vyhrál seed, ale plán zůstal v repu jako platný. Tohle ADR ten rozpor uzavírá
ve prospěch seedu: **CT-1.4 se ruší jako cíl** a zbývá z něj jen požadavek na funkce
(Contacts, Accounts, Teachers, Activities, Tasks, Dashboard), které se plní na ploše.

## Stav v době rozhodnutí (naměřeno 2026-09-01 ze seedů)

| namespace | blok | typ |
|---|---|---|
| `<fork>` | `<fork>_oznameni` | timeline |
| | `<fork>_moje_kroky` | review_queue |
| | `<fork>_muj_postup` | goal_progress |
| | `<fork>_vez` | timing_tower |
| | `<fork>_udalosti` | table |
| `<fork>_audience` | `<fork>_kontakty` | table |
| | `<fork>_skupiny` | table |
| | `<fork>_followupy` | table |
| | `<fork>_trychtyr` | chart |

Proti matici makety chybí **Accounts** (organizace instance), **Teachers** a **kampaně**;
fronta follow-upů je zatím jen ke čtení.

## Důsledky, které se musí respektovat

### 1. Allowlist je bezpečnostní vlastnost, ne formalita

`get_block_data` (ověřeno v `aisha/db/sql/functions/get_block_data.sql`):

- pouští jen `source_rpc`, který má aktivní řádek v `surface_data_rpcs`
- volá ho přes `format('select public.%I($1)', …)` — identifikátor, žádný passthrough
- je `SECURITY INVOKER`, takže platí RLS volajícího

„Skládat si vlastní dotazy" proto **nesmí** znamenat spuštění libovolného SQL s právy
platformy. Volnost patří do PARAMETRŮ bloku (který pohled, jaké sloupce, jak řadit),
ne do jména funkce. Appsmith jako dílna má vlastní, oddělené připojení a vlastní
oprávnění — nesmí se stát zadními vrátky do surface roviny.

### 2. Autorská plocha bez cesty zpět do gitu je past, kterou už známe

Dnes se `surface_blocks` seedují ze SQL v `<fork>-instance-data`. Jakmile vznikne
UI, které je píše do živé databáze, git a DB se rozejdou.

To není hypotéza — **stalo se to už u `01_web.sql`.** Jeho hlavička dnes hlásí:

> „TENHLE SOUBOR SE UŽ NEGENERUJE — udržuje se ručně. Seed se od zdroje ROZEŠEL
> a regenerace by byla ZTRÁTOVÁ. Kdo spustí `export-web-seed`, přijde o 8 stránek."

Pro autorskou plochu nad bloky proto platí: **export zpět do seedu je součást zadání,
ne navazující úkol.** Bez něj se pravda přestěhuje do databáze a v gitu zůstane lež.

### 3. Ne všechno je řádek v datech

`review_queue` má uzavřenou množinu `ReviewEntityKind`
(`extraction | obligation | document | workflow_step | twin_identity`) a zápis vede
jedním pevným auditovaným RPC („no dynamic RPC name",
`packages/surface-blocks/src/types.ts`). Follow-up mezi ně nepatří.

Blok postavený na `review_queue` pro follow-up by se schématu nezapsal a **tiše by
zmizel** — klient neshodu obálky nehlásí, jen blok přeskočí. Odklikávání follow-upů je
tedy změna v KLIENTOVI, ne seed.

Obecně: než se nová schopnost slíbí jako „řádek v konfiguraci", ať se ověří, že ji
renderer umí. Tichý výpadek je horší než chyba.

## Zamítnuté alternativy

**Dva plnohodnotné cockpity vedle sebe** (Appsmith i plocha) — zdvojená údržba, dvě
pravdy o tomtéž a jistota, že se rozejdou; přesně to, co se právě stalo v dokumentech.

**Zrušit Appsmith úplně** — ad-hoc dotaz, který ještě nemá tvar bloku, je legitimní
potřeba a plocha na něj není stavěná. Dílna se hodí; jen nesmí být produkt.
