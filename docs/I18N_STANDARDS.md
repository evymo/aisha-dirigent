# i18n standardy (Platform)

Tento repozitář je produkční aplikace a UI texty musí být konzistentní a auditovatelné.

## Základní pravidla

- **Žádné hardcoded UI texty** – vše přes `react-i18next` (`t("...")`).
- **EN je kanonická sada klíčů** – `src/i18n/locales/en.json` je superset.
- **Ostatní jazyky musí mít skutečné překlady** – nepoužívej angličtinu jako „placeholder“.
- **Žádné maskování chybějících překladů**:
  - Nepoužívej `t("key", "fallback text")`.
  - Nepoužívej `defaultValue` v `t(...)`.
  - Nepoužívej `i18n.exists(...) ? ... : ...` pro obcházení fallback řetězce.

## Očekávané fallback chování

- Runtime musí fungovat takto:
  1) **aktuální locale**
  2) fallback do **EN**
  3) pokud klíč neexistuje ani v EN, může se zobrazit **název klíče**

Tohle funguje jen tehdy, když UI volá **přímo `t("some.key")`** a klíče nejsou „schované“ fallback stringy.

## Lokalizační soubory

## Segmentované slovníky (nový workflow)

Aby byly jazykové soubory přehledné a rychle se opravovaly, jsou slovníky rozdělené do menších segmentů podle top-level prefixů.


### Volitelné: doplnění chybějících překladů přes DeepL (jen „missing keys“)

Pokud přidáš nové EN klíče a chceš ostatní jazyky posunout dopředu bez přepisování existujících překladů,
použij nástroj, který **doplní pouze chybějící stringy** v segmentech.

- Report (bez zápisu): `npm run i18n:segments:report-missing`
- Překlad + zápis (vyžaduje API key): `DEEPL_AUTH_KEY=... npm run i18n:segments:translate-missing`

Env:
- `DEEPL_AUTH_KEY` (nebo alias `DEEPL_API_KEY`) — DeepL API key
- `DEEPL_API_URL` (volitelně) — default `https://api-free.deepl.com/v2/translate`

Poznámky:
- Nástroj nikdy nepřepisuje existující překlady, pouze doplňuje chybějící.
- Všechny placeholdery `{{...}}` a trans tagy `<0>` se zachovávají.
- Po doplnění vždy spusť: `npm run i18n:segments:build && npm run i18n:check`
Generátor je fail-closed:
- spadne, pokud se stejný top-level klíč objeví ve více segmentech,
- spadne, pokud je klíč ve „špatném“ segmentu,
- v režimu `--check` spadne, pokud by lokální `src/i18n/locales/*.json` byly přepsány (tzn. někdo je ručně upravil).

- `src/i18n/locales/en.json` (kanonický)
- `src/i18n/locales/cs.json`
- `src/i18n/locales/de.json`
- `src/i18n/locales/fr.json`
- `src/i18n/locales/ru.json`
- `src/i18n/locales/th.json`

Poznámka: v JSON nesmí být duplicitní klíče ve stejné větvi – pozdější blok přepíše předchozí a překlady se „ztratí“.

## Jak přidat nový UI text

1) Přidej klíč do EN segmentu (EN je zdroj pravdy), typicky do `src/i18n/segments/en/<segment>.json`.
2) Doplň překlady do všech ostatních jazykových segmentů (`src/i18n/segments/<lng>/<segment>.json`).
3) Ověř generování + paritu/validitu:

```bash
npm run i18n:check
```

Pokud validátor hlásí missing keys nebo type mismatch, fixni to před mergem.

## Troubleshooting (rychlý debug)

### 1) i18n gates failují (segments/locales/policy)

- Spusť: `npm run i18n:check`
- Typické příčiny:
  - klíč existuje v `src/i18n/locales/*.json`, ale chybí v `src/i18n/segments/**` (locales jsou generované; opravuje se v segmentech)
  - rozbitý JSON v segmentech (nevalidní struktura / trailing commas)
  - hardcoded fallbacky (`t("key", "Human text")` nebo `defaultValue`) – politika vyžaduje čisté `t("key")`

### 2) V UI chybí překlady, ale `i18n:check` prochází

Některé UI používá **dynamicky skládáné klíče** (např. `t(\`admin.auditJournal.areas.${value}\`)`) a hodnoty přichází z DB enumů nebo DB dat. Statická kontrola klíčů tyto runtime hodnoty neumí sama odvodit.

- `npm run i18n:check` obsahuje i runtime DB validaci, ale **bez DB připojení se bezpečně přeskočí**.
- Pro plnou kontrolu (lokálně/CI s DB) nastav `AISHA_DB_URL` (nebo `DATABASE_URL`) a spusť:

```bash
AISHA_DB_URL=postgresql://... npm run i18n:runtime:db-check
```

Pokud to selže, výstup vypíše přesné chybějící klíče (např. `admin.auditJournal.areas.<enum_value>`) a krátký návod na fix.

### 3) Testy spadnou na React Query ("No QueryClient set")

- Řešení: v testech obalit `render`/`renderHook` přes `QueryClientProvider`.
- Preferuj QueryClient s vypnutými retry (sníží flaky testy).

### 4) Build failuje na chybějící deps / rozbitém souboru po mergi

- Nejprve ověř čistou instalaci: `rm -rf node_modules && npm ci`
- Pak build: `npm run build`
- Pokud je to syntax error v TS, často jde o konfliktní merge.

### 5) Kompletní ověření před PR

- Doporučený one-liner: `npm run debug:verify`

## Otevřené migrace

### `products.{origin,benefits,substances,usage}_content` → `<name>_key` + translations

Stav: **otevřená**. Tabulka `products` má čtyři `jsonb` sloupce, kde je
strukturovaný obsah uložen jako `{ cs: {...}, en: {...}, … }` a RPC funkce
(`get_public_product_by_slug`, `get_products_admin`, …) si vybírá větev
podle `p_locale`. Tento pattern předchází zavedení `<name>_key` +
`translations` tabulky.

Cílový stav: ploché překládací klíče (jeden řádek v `translations` per
locale per nested key), aby přehled pokrytí byl měřitelný a aby
export/import přes `translations` shodil i tento obsah.

Migrace je vlastní PR, ne side-fix — vyžaduje:
1. Rozhodnout o tvaru klíčů (např. `products.{slug}.benefits.title`).
2. Backfill rows do `translations` z existujícího JSON na všech existujících produktech (`origin_content`, `benefits_content`, `substances_content`, `usage_content`).
3. RPC update: nahradit `content -> p_locale` lookupy přes `get_translation_value_with_fallback`.
4. Frontend types + admin formuláře: přepnout z JSON struktury na ploché klíče.
5. Drop sloupce + RPC return-type cleanup.

`hardcoded-text-detection.gate.test.ts` má regression guard pro `<name>_(cs|en)` plain-text sloupce. Pro `*_content jsonb` se nepoužívá allowlist — až bude migrace hotová, guard rozšíříme.

---

## Tři zdroje pravdy překladů (i18n SoT systémy)

V repu jsou **tři** oddělené překladové systémy. Všechny jsou file-based a gated — žádné ruční editování generovaných výstupů, žádný „auto-generated from database" anti-pattern.

| # | Systém | SoT | Generuje | Gate |
|---|--------|-----|----------|------|
| 1 | **Statické app i18n** | `src/i18n/segments/{locale}/*.json` | → `src/i18n/locales/{locale}.json` (`i18n:segments:build`) | `i18n:segments:check`, `i18nKeysExist` |
| 2 | **Web/GrapeJS DB i18n** | `src/i18n/segments/{locale}/web.json` | → `aisha/db/migrations/*_web_i18n_seed.sql` | `i18n:sql:check` |
| 3 | **DB content/CMS i18n** | `src/i18n/content/{locale}/{namespace}.json` | → `aisha/db/seed/translations/{namespace}.sql` (`i18n:content:build`) | `content-translations-sot.gate.test.ts` |

### Systém 3 — DB content překlady (hero, products, questionnaires, …)

Runtime/CMS obsah v tabulce `translations` (14 namespaces: `hero, products, questionnaires, tests, achievements, archive, consents, featured, issue_catalog, kpis, product_catalog, rewards, studies, subscription_packages`). **Není** to statické app i18n — frontend ho čte z DB za běhu.

**SoT:** `src/i18n/content/{locale}/{namespace}.json` — **ploché** klíče `{ "full.key": "value" }`. (i18n klíč ≠ namespace — např. klíč `community-program.consent.x` patří do namespace `consents` — proto ploché, ne nested.) Dedikovaný strom **mimo** `src/i18n/segments/`, aby neznečistil frontend `locales/`.

**Obousměrný tok — záleží na fázi životního cyklu:**

```
  v0 / base seed (init nového systému)         produkce (běžící instance)
  ────────────────────────────────────        ────────────────────────────
  src/i18n/content/  ──build──▶  DB seed        DB  ──dump──▶  src/i18n/content/
  (opravujeme tady)              (.sql)         (admin/user edituje)  (commit → další deploy)
        i18n:content:build                            i18n:content:dump
```

- **v0 / base seed (teď):** soubory jsou zdroj. Překlad opravuj v `src/i18n/content/`, pak `npm run i18n:content:build`. Tohle je absolutní init nového systému — myslíme na něj v prvé řadě.
- **Produkce (pak):** DB je zdroj, protože admini/uživatelé tam překlady upravují a vylepšují. `npm run i18n:content:dump` (`--local` / `AISHA_DB_URL`) stáhne živou DB zpět do file SoT → commitneš → **nepřijdeš o user data**. Další deploy nese vylepšení v base seedu.

**Pravidla:**
- NIKDY needituj `aisha/db/seed/translations/*.sql` ani staré dump soubory ručně — edituj `src/i18n/content/` + `npm run i18n:content:build`.
- Round-trip fidelita: jakákoli reorganizace musí zachovat **efektivní** DB stav (po `ON CONFLICT (key,namespace,locale) DO UPDATE` dedup), ne syrový seznam řádků.
- `aisha/db/seed/translations/13_archive_documents.sql` NENÍ translation dump (je to `UPDATE archive_documents SET *_key`) — generátor ho nechává být (retiruje jen soubory s translation řádky).

## Skupiny seed obsahu (kdo co dostane)

| Skupina | Kde | Komu | Příklad |
|---------|-----|------|---------|
| **Base seed** (v0 init) | `aisha/db/seed/core/` + `aisha/db/seed/translations/` (ze systému 3) | každý deploy | core backbone, knowledge, content překlady |
| **„Specific" = installation / demo** | `aisha/db/seed.instance.sql` | jen **hosted instance** (`db:seed:instance`) | test user/partner/story, 27 instance expert rules, project presets |
| **Migrace** | `aisha/db/migrations/` | každý (schema + default data) | tabulky, funkce, 16 default rules |

„Specific" obsah (`seed.instance.sql`) je **zvláštní skupina** — installation/demo data pro hostované instance, mimo migrace; lokální/community instalace ho nedostávají.
