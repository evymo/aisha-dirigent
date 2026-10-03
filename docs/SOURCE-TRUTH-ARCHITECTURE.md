# Source of Truth Architecture

**Datum:** 2026-01-09  
**Verze:** 1.2

---

## 🎯 Filozofie

### ⚠️ KRITICKÉ: ROZŠIŘUJ, NEODSTRAŇUJ

```
═══════════════════════════════════════════════════════════════════════════════
📋 FILOZOFIE KONZISTENCE: ROZŠIŘUJ, NEODSTRAŇUJ
═══════════════════════════════════════════════════════════════════════════════

✅ SPRÁVNÝ PŘÍSTUP:
   - Chybí sloupec v tabulce? → PŘIDEJ sloupec do tabulky
   - Chybí parametr v SQL funkci? → PŘIDEJ parametr do SQL
   - TypeScript má extra argument? → ROZŠIŘ SQL funkci

❌ ŠPATNÝ PŘÍSTUP:
   - NIKDY neodstraňuj funkčnost z SQL funkcí
   - NIKDY neodstraňuj sloupce z tabulek (může být v migracích)
   - NIKDY neredukuj TypeScript typy jen proto, že SQL to nemá

💡 VÝJIMKY: Odstranit lze pouze DUPLICITY (stejná věc 2×)
═══════════════════════════════════════════════════════════════════════════════
```

### Zdroj Pravdy

**`supabase/sql/` soubory JSOU jediný zdroj pravdy.**

- Migrace jsou VÝSTUP, ne zdroj
- DB exporty jsou VÝSTUP, ne zdroj  
- Dokumentace je VÝSTUP, ne zdroj

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOURCE OF TRUTH (jediný)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  supabase/sql/                                                  │
│     ├── functions/*.sql     ← Definice funkcí                   │
│     ├── tables/*.sql        ← Definice tabulek                  │
│     ├── policies/*.sql      ← RLS policies                      │
│     └── grants/*.sql        ← Security grants                   │
│                                                                 │
│  src/integrations/supabase/types.ts                             │
│     └── Generováno z SQL (supabase gen types)                   │
│                                                                 │
│  src/**/*.ts(x)                                                 │
│     └── Implementuje volání definovaná v SQL                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OUTPUTS (NE zdroje):                                           │
│     - aisha/db/migrations/     ← baseline generovaný z sql/     │
│         (npm run db:init:generate; registry zůstává prázdná)    │
│     - aisha/db/heals.sql       ← idempotentní dorovnání pro     │
│         existující DB (baseline se na ně už neaplikuje)         │
│     - docs/db-structure/       ← Exporty pro dokumentaci        │
│     - Skutečná databáze        ← Deploy target                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Aktuální Stav

### Analyzátory

| Analyzátor | Účel | DB Needed | Status |
|------------|------|-----------|--------|
| `source-truth-analyzer` | SQL ↔ TS ↔ Frontend + Schema konzistence | ❌ Ne | ✅ Implementován |
| `access-flow-analyzer` | RLS + Auth checks | ✅ Ano | ✅ Implementován |
| `flow-consistency-analyzer` | Runtime flow validation | ✅ Ano | ✅ Implementován |

### Typy Problémů a Jak Je Řešit

| Typ | Význam | 💡 FIX |
|-----|--------|--------|
| `EXTRA_TS_ARG` | TS má parametr, SQL ne | **ROZŠIŘ SQL funkci** o tento parametr |
| `MISSING_TS_ARG` | SQL má required parametr, TS ne | Přidej do TypeScript |
| `MISSING_TABLE_COLUMN` | Funkce čte sloupec, tabulka ho nemá | **PŘIDEJ sloupec** do tabulky |
| `sensitive-data_NO_CONSENT_CHECK` | sensitive data funkce pro cizí data bez consent | Přidej `has_data_sharing_consent` check |
| `MISSING_TS_TYPE` | SQL funkce bez TS typu | Přidej typ do types.ts |
| `WRONG_PARAM` | Frontend volá se špatným názvem | Oprav název parametru ve frontendu |

---

## ✅ Implementované Validace

### 1. Source Truth Analyzer (`source-truth-analyzer.mjs`)

Parsuje a validuje konzistenci mezi třemi vrstvami + schema:

```javascript
// Parsuje SQL funkce z souborů
parseSqlFunctions()  // → 529 funkcí s jejich parametry

// Parsuje TypeScript typy
parseTypeScriptTypes()  // → 307 typových definic

// Parsuje frontend volání
parseFrontendRpcCalls()  // → 412 RPC volání

// Parsuje SQL tabulky
parseSqlTables()  // → 143 tabulek se sloupci

// Cross-validuje konzistenci
validateConsistency()  // → SQL ↔ TS ↔ Frontend

// Validuje schema konzistenci (NOVÉ)
validateSchemaConsistency()  // → Funkce čtou sloupce které tabulky mají?

// Validuje security
validateSecurity()  // → restricted tables, consent checks
```

### 2. Gate Testy (`security.gate.test.ts`)

```typescript
describe('Source of Truth Consistency', () => {
  // CRITICAL: Frontend volání odpovídají SQL
  test('Frontend RPC calls match SQL function signatures')
  
  // CRITICAL: Všechny required params jsou poskytnuty
  test('All required parameters are provided')
  
  // ERROR: sensitive data funkce mají consent checks
  test('sensitive-data user data functions have consent checks')
  
  // ERROR: TypeScript typy odpovídají SQL
  test('TypeScript RPC types match SQL function signatures')
  
  // WARNING: SQL funkce mají TypeScript typy
  test('SQL functions should have TypeScript type definitions')
})
```

---

## 🔧 Workflow: Jak Opravovat Problémy

### EXTRA_TS_ARG - TypeScript má extra parametr

**Příklad:**
```
[EXTRA_TS_ARG] TypeScript argument 'p_unlock_condition' not found in SQL function
   file: supabase/sql/functions/create_token_lock_admin.sql
   💡 FIX: ROZŠIŘ SQL funkci 'create_token_lock_admin' o parametr 'p_unlock_condition'
```

**Řešení:** Otevři SQL soubor a přidej parametr:

```sql
-- PŘED
CREATE OR REPLACE FUNCTION create_token_lock_admin(
  p_user_id UUID,
  p_amount NUMERIC
)

-- PO
CREATE OR REPLACE FUNCTION create_token_lock_admin(
  p_user_id UUID,
  p_amount NUMERIC,
  p_unlock_condition TEXT DEFAULT NULL  -- PŘIDÁNO
)
```

### MISSING_TABLE_COLUMN - Funkce čte neexistující sloupec

**Příklad:**
```
[MISSING_TABLE_COLUMN] Function 'get_my_token_locks' reads 'tl.unlock_condition' 
   but column 'unlock_condition' missing in table 'token_locks'
   💡 FIX: Add column 'unlock_condition' to supabase/sql/tables/token_locks.sql
```

**Řešení:** Přidej sloupec do SQL definice tabulky:

```sql
-- V supabase/sql/tables/token_locks.sql přidej:
unlock_condition TEXT,
```

### sensitive-data_NO_CONSENT_CHECK - Chybí consent kontrola

**Příklad:**
```
[sensitive-data_NO_CONSENT_CHECK] User data function 'get_user_consents_audited' 
   does not check data_sharing_consent
```

**Řešení:** Přidej consent check na začátek funkce:

```sql
-- V BEGIN bloku přidej:
IF NOT has_data_sharing_consent(p_client_id, auth.uid()) THEN
  RAISE EXCEPTION 'No consent granted';
END IF;
```

---

## 🏃 Quick Commands

```bash
# Spustit source truth analýzu (NEVYŽADUJE DB)
npm run db-mgr:source

# Filtrovat konkrétní typ problémů
npm run db-mgr:source 2>&1 | grep "EXTRA_TS_ARG"
npm run db-mgr:source 2>&1 | grep "MISSING_TABLE_COLUMN"

# Zobrazit report
cat docs/db-structure/SOURCE-TRUTH-REPORT.md

# Spustit gate testy
npm run test:gates

# Regenerovat TypeScript typy (VYŽADUJE lokální Supabase)
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

---

## 📋 Checklist Před Commitem

- [ ] `npm run db-mgr:source` - žádné CRITICAL
- [ ] `npm run db-mgr:source 2>&1 | grep EXTRA_TS_ARG` - 0 (nebo zdokumentované)
- [ ] `npm run db-mgr:source 2>&1 | grep MISSING_TABLE_COLUMN` - 0 (nebo zdokumentované)
- [ ] `npm run test:gates` - všechny testy prochází
- [ ] `npm run test:run && npm run build` - VŽDY před push

---

## ❌ Známé Problémy k Opravě

### Aktuální Stav (2026-01-11)

#### Source-truth analyzer (docs/db-structure/source-truth-report.json)

| Typ | Počet | Priorita |
|-----|-------|----------|
| `MISSING_TS_TYPE` | 192 | P2 - Regenerovat typy |
| `ORPHAN_TS_TYPE` | 1 | P3 - Uklidit typy |
| `sensitive-data_NO_AUDIT` | 11 | P1 - Dopsat audit log |
| `sensitive-data_NOT_DEFINER` | 1 | P0 - SECURITY DEFINER |

#### Flow-consistency analyzer (docs/db-structure/flow-consistency-report.json)

| Typ | Počet | Priorita |
|-----|-------|----------|
| `EXTRA_PARAM` | 59 | P1 - Zarovnat parametry |
| `COMPONENT_DIRECT_RPC` | 71 | P1 - Přesunout do hooků |
| `INCONSISTENT_PARAM_USAGE` | 9 | P2 - Sjednotit volání |

### sensitive-data_NOT_DEFINER - K Opravě

```
get_combined_study_consents
```

### sensitive-data_NO_AUDIT - K Opravě

```
aggregate_questionnaire_responses
get_combined_consent_requirements_localized
get_combined_study_consents
get_consent_templates_admin
get_partner_user_registrations
get_study_consent_items_admin
get_study_consent_requirements_admin
get_study_consent_requirements_localized
get_study_informed_consent_special_provisions
has_data_sharing_consent
set_questionnaire_response_version
```

---

## 🔧 Budoucí Vylepšení

### 1. Automatická Oprava TypeScript Typů

```bash
# Regenerovat typy z databáze
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

### 2. RLS Policy Validace ze Souborů

Parsovat `supabase/sql/policies/*.sql` a validovat:
- Každá sensitive data tabulka má RLS enabled
- Všechny operace (SELECT, INSERT, UPDATE, DELETE) mají policy

### 3. Grant/Revoke Validace

Parsovat `supabase/sql/grants/*.sql` a validovat:
- sensitive data funkce nemají `GRANT EXECUTE TO public/anon`

---

## 📋 Validační Matice

| Validace | SQL Files | TS Types | Frontend | DB Query |
|----------|-----------|----------|----------|----------|
| Function existence | ✅ | ✅ | ✅ | ❌ |
| Parameter names | ✅ | ✅ | ✅ | ❌ |
| Parameter types | ✅ | ✅ | ⚠️ | ❌ |
| Required vs optional | ✅ | ✅ | ✅ | ❌ |
| Return types | ✅ | ✅ | ⚠️ | ❌ |
| Schema consistency | ✅ | ❌ | ❌ | ❌ |
| RLS policies | ✅ | ❌ | ❌ | ⚠️ |
| Grants | ✅ | ❌ | ❌ | ⚠️ |
| Consent checks | ✅ | ❌ | ❌ | ❌ |

**Legenda:**
- ✅ Plně implementováno z file-based source
- ⚠️ Částečně / vyžaduje vylepšení
- ❌ Neaplikovatelné nebo nevyžadované

---

## 📚 Související Dokumenty

- [ARCHITECTURE.md](ARCHITECTURE.md) - Celková architektura
- [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md) - Vývojové standardy
- [security/RLS_POLICY_DOCUMENTATION.md](security/RLS_POLICY_DOCUMENTATION.md) - RLS dokumentace
- [AGENTS.md](../AGENTS.md) - Instrukce pro AI asistenty

---

*Dokument aktualizován: 2026-01-09*
