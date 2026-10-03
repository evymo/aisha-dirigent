# Commit & Push Workflow

> **Verze:** 1.1 | **Datum:** 2026-03-02

Tento dokument popisuje automatizované kontroly, které probíhají při commitu a pushi, a jak řešit jejich selhání.

---

## Přehled pipeline

```
git commit
  └─ pre-commit hook (<30s)
       ├── 1. TypeScript (npx tsc --noEmit)
       ├── 2. ESLint (npm run lint)
       └── 3. i18n segmenty (npm run i18n:segments:check)

git push
  └─ pre-push hook (<3min)
       ├── 1. Gate testy (npx vitest run --config vitest.gates.config.ts src/tests/gates/)
       ├── 2. SQL funkce validace (npm run func:validate)
       ├── 3. i18n kontrola (npm run i18n:check)
       ├── 4. Unit testy (npm run test:run)
       └── 5. Build (npm run build)
```

---

## Pre-commit kontroly

### 1. TypeScript (`npx tsc --noEmit`)

Kontroluje typovou korektnost bez generování výstupu.

**Časté chyby:**
- Chybějící typy po změně DB schématu → `npm run db:types:gen:local`
- Nesprávné import typy → zkontrolovat `src/integrations/supabase/types.ts`

### 2. ESLint (`npm run lint`)

Kontrola kvality kódu s `--max-warnings 0` (žádné warningy povoleny).

**Pravidla:**
- Žádné `console.log()` — použít `safeError()` pro error logging
- Žádné `any` typy — použít `unknown` + type guard
- Žádné `@ts-ignore` — použít `@ts-expect-error` s komentářem

### 3. i18n segmenty (`npm run i18n:segments:check`)

Ověřuje, že kompilované locale soubory (`src/i18n/locales/*.json`) odpovídají segmentům (`src/i18n/segments/{lang}/*.json`).

**Řešení:**
```bash
# Pokud jsi přidal klíče do segmentů:
npm run i18n:segments:build

# Pokud jsi editoval locales přímo (NEDĚLÁNO):
# Přesuň změny do segmentů a spusť build
```

---

## Pre-push kontroly

### 1. Gate testy (`npx vitest run --config vitest.gates.config.ts src/tests/gates/`)

31 testovacích souborů (405+ testů) kontrolujících:

| Kategorie | Co kontroluje |
|-----------|---------------|
| `i18nKeysExist` | Každý `t("key")` v kódu existuje ve všech 6 locale souborech |
| `pagesNoHardcodedUiStrings` | Non-admin stránky neobsahují hardcoded texty |
| `noEmojiInComponents` | Komponenty nepoužívají Unicode emoji (jen lucide-react) |
| `rpcOnlyDataAccess` | Žádné přímé `.from()` dotazy na tabulky |
| `hookCoverage` | Hooks pokrývají RPC funkce, schema validace |
| `designTokens` | Konzistence design tokenů |
| `security` | OWASP patterns, data protection |
| `architecture` | Import pořadí, barrel exporty |

**Časté chyby a řešení:**

```bash
# Chybějící i18n klíč
# → Přidej do src/i18n/segments/{lang}/*.json + npm run i18n:segments:build

# Hardcoded string v page
# → Nahraď za t("section.key") z useTranslation()

# Pluralizace (dayCount vs dayCount_one/dayCount_other)
# → Gate test podporuje i18next plural suffixes (_one, _other, _few, _many, _zero, _two)
```

### 2. SQL funkce validace (`npm run func:validate`)

- 768+ funkcí v `supabase/sql/functions/`
- Kontroluje: SECURITY DEFINER/INVOKER, search_path, GRANT/REVOKE, audit_journal, role checks
- **ANON_ACCESS_FORBIDDEN**: Funkce s `GRANT TO anon` musí být v `publicPatterns` v `scripts/db/func-manager/lib/rules.mjs`
- **MISSING_AUDIT**: Admin funkce bez audit logu (warning, neblokuje)

### 3. i18n kontrola (`npm run i18n:check`)

Rozšířená kontrola oproti pre-commit:
- Parita segmentů vs locales
- Chybějící překlady mezi jazyky
- Bracket placeholders (`[English text]`)

### 4. Unit testy (`npm run test:run`)

Kompletní test suite (3000+ testů, 200+ souborů).

### 5. Build (`npm run build`)

Produkční build včetně TypeDoc generování.

---

## Workflow pro běžnou změnu

### Změna v React kódu (hook/komponenta)

```bash
# 1. Implementuj změnu
# 2. Spusť relevantní test
npm run test:run -- src/tests/hooks/useMyHook.test.ts

# 3. Commit (proběhne tsc + eslint + i18n check)
git add -A && git commit -m "feat: popis změny"

# 4. Push (proběhne 6 kontrol)
git push origin main
```

### Změna v DB (migrace)

```bash
# 1. Vytvoř migraci
# supabase/migrations/YYYYMMDDHHMMSS_popis.sql

# 2. Zaregistruj + aplikuj + generuj typy
npm run db:migration:register
npm run db:migrate:local
npm run db:types:gen:local

# 3. Aktualizuj hook/schéma pokud třeba
# 4. Spusť relevantní testy
npm run test:run -- src/tests/hooks/useAffectedHook.test.ts

# 5. Commit + push
git add -A && git commit -m "feat: db change description"
git push origin main
```

### Změna v i18n

```bash
# 1. Edituj segmenty (NIKDY locales přímo!)
# src/i18n/segments/{lang}/{section}.json

# 2. Rebuild locales
npm run i18n:segments:build

# 3. Ověř
npm run i18n:check

# 4. Commit + push
git add -A && git commit -m "i18n: add missing translations"
git push origin main
```

### Změna v SQL funkci (source of truth)

```bash
# 1. Edituj SQL soubor
# supabase/sql/functions/my_function.sql

# 2. Validuj
npm run func:validate

# 3. Pokud je potřeba anon přístup — přidej pattern do rules.mjs
# scripts/db/func-manager/lib/rules.mjs → publicPatterns[]

# 4. Commit + push
git add -A && git commit -m "fix: update SQL function"
git push origin main
```

---

## Bypass (pouze v nouzi)

```bash
# Skip pre-commit
git commit --no-verify -m "wip: emergency fix"

# Skip pre-push
git push --no-verify origin main

# Skip oboje přes env
HUSKY=0 git commit -m "..." && HUSKY=0 git push origin main
```

**Nikdy nepoužívat na main větvi v produkci bez důvodu!**

---

## Rychlá diagnostika selhání

| Selhání | Diagnostický příkaz | Řešení |
|---------|---------------------|--------|
| TypeScript | `npx tsc --noEmit` | Oprav typy, případně `npm run db:types:gen:local` |
| ESLint | `npm run lint` | Oprav warnings/errors |
| i18n segmenty | `npm run i18n:segments:check` | `npm run i18n:segments:build` |
| Gate testy | `npx vitest run --config vitest.gates.config.ts src/tests/gates/` | Viz konkrétní test output |
| func:validate | `npm run func:validate` | Přidej pattern do rules.mjs nebo audit do SQL |
| Unit testy | `npm run test:run` | Oprav selhávající testy |
| Build | `npm run build` | Oprav build errory |

---

## Souhrn kontrol

| Fáze | Kontrola | Čas | Bloky |
|------|----------|-----|-------|
| **commit** | TypeScript | ~10s | commit |
| **commit** | ESLint | ~5s | commit |
| **commit** | i18n segmenty | ~2s | commit |
| **push** | Gate testy | ~5s | push |
| **push** | func:validate | ~10s | push |
| **push** | i18n kontrola | ~3s | push |
| **push** | Unit testy | ~30s | push |
| **push** | Build | ~60s | push |

---

## PR a merge — co NEdělat

### Nemergovat `main` do větve „pro narovnání"

Forgejo při události `pull_request` checkoutuje **merge commit**, ne holou hlavu
větve (je to i důvod, proč `detect` počítá změny proti `PR_BASE_SHA` a ne proti
`HEAD~1`). CI tedy **už měří výsledek sloučení** se základem.

Domergovat `main` do větve, která jde sloučit sama, proto nic nezpřesní — jen
vyrobí nový push, a tím **celý běh CI navíc**. Při sériové concurrency skupině
(`group: aisha-ci-runner`) to zdrží i všechny PR ve frontě za ním.

| stav PR | co udělat |
|---|---|
| `mergeable = true` | **nic.** Počkat na CI a mergnout. |
| `mergeable = false` | Domergovat `main`, konflikt vyřešit ručně, pushnout — a mergovat teprve až projde automaticky. Co Forgejo neumí sloučit, to neumí ani otestovat. |

Stav se zjistí z API PR (`GET /repos/{owner}/{repo}/pulls/{n}` → pole `mergeable`).
Pozor, počítá se proti **aktuálnímu** `main`: když mezitím přistane jiný PR na týž
soubor, `mergeable` spadne na `false` — sledovat průběžně, ne jen na začátku.

### Běh nad `main` se po mergi neopakuje, když není co měřit

Merge do `main` dřív přehrával celou sadu podruhé nad obsahem, který PR běh právě
prohlásil za zelený. Nově to `detect` pozná a testovací lane přeskočí — ale jen
po důkazu:

```
tree(HEAD) == tree(HEAD^2)   a zároveň   běh hlavy PR byl zelený
```

Rovnost **stromů** je nutná: commit status visí na hlavě větve, kdežto CI měřila
merge commit. Pohnul-li se `main` mezitím, je to jiný obsah — rovnost neplatí a
jede plná sada. Cokoli nečekaného (mělký klon, chybějící druhý rodič, API mlčí)
končí taky plným během; přeskakuje se jen po důkazu, nikdy „pro jistotu".

**Deploy joby se nepřeskakují nikdy** — smyslem běhu nad `main` je nasadit.
Hlídá to brána `ci-neopakovat-mereni`.
