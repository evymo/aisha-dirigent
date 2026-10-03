# Komplexní Validační Systém - Platform

## 📊 Současné validační nástroje

| Nástroj | Příkaz | Co kontroluje |
|---------|--------|---------------|
| **SQL Func Validate** | `npm run func:validate` | SECURITY DEFINER, search_path, GRANTs, anon policies |
| **SQL Func List** | `npm run func:list` | Seznam všech SQL funkcí ze source of truth |
| **SQL Func List Live** | `npm run func:list:live` | Porovnání source vs. živá lokální DB |
| **DB Seed Validate** | `npm run db:seed:validate` | Schema validace seedu |
| **i18n Check** | `npm run i18n:check` | Překlady, parita klíčů |
| **Unit Testy** | `npm run test:run` | Vitest unit + integration testy |
| **Gate Testy** | `npx vitest run --config vitest.gates.config.ts src/tests/gates/` | i18n, emoji, RPC-only, architecture |
| **ESLint** | `npm run lint` | Kódová kvalita, console.log, any typy |
| **TypeScript** | `npx tsc --noEmit` | Typová korektnost |

---

## 🎯 Validační Pipeline

### Tier 1: Pre-commit (lokální, rychlé)
```bash
# ~5 sekund
npx tsc --noEmit               # TypeScript
npm run lint                    # ESLint
npm run i18n:segments:check     # i18n segmenty
```

### Tier 2: Pre-push (lokální, důkladné)
```bash
# ~60 sekund
npm run test:run                # Unit testy
npm run func:validate           # SQL funkce
npm run build                   # Build check
```

### Tier 3: CI Pipeline (blokující merge)
```bash
# ~2 minuty
npm run test:run
npm run build
npm run func:validate           # MUSÍ být 0 errors!
npm run i18n:check              # Kompletní i18n gate
```

---

## 🆕 Plánované rozšíření validace

### 1. Source of Truth Konzistence
Ověří že `supabase/sql/functions/` odpovídá migracím:
- Všechny funkce z migrací existují v source
- Verze funkcí jsou shodné
- Žádné orphan funkce

### 2. TypeScript Types Freshness
Ověří že `src/integrations/supabase/types.ts` je aktuální:
- Hash souboru odpovídá poslednímu `npx supabase gen types`
- Všechny RPC funkce mají typy
- Žádné chybějící tabulky

### 3. RPC Usage Alignment
Ověří že hooky volají existující RPC:
- Všechny `supabase.rpc("...")` volání mají odpovídající funkci
- Parametry odpovídají signatuře
- Návratové typy jsou správné

### 4. RLS Policy Coverage
Ověří že všechny tabulky mají RLS:
- RLS enabled
- Policies pro SELECT/INSERT/UPDATE/DELETE
- Žádné `USING (true)` na sensitive data tabulkách

---

## 📈 Metriky

| Metrika | Cíl | Nástroj |
|---------|-----|---------|
| func:validate errors | 0 | `npm run func:validate` |
| func:validate warnings | <50 | `npm run func:validate` |
| Source vs Migrations diff | 0 | `npm run func:list:live` |
| Types freshness | 100% | plánováno |
| RLS coverage | 100% | plánováno |

---

## ⚡ Prioritní akce

1. **[P0]** Opravit `get_user_permissions` - buď odstranit z blacklistu (má guard) nebo změnit grant
2. **[P0]** Přidat `validate:rpc` do CI
3. **[P1]** Snížit warnings na <50
4. **[P1]** Vytvořit consistency check
5. **[P2]** Types freshness check
6. **[P2]** RLS audit tool

