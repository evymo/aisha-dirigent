# Database & Static Validation Framework

**Verze:** 2.0 | **Datum:** 12. ledna 2026

Tento dokument popisuje validační framework pro seed data, schéma databáze a statickou analýzu aplikace.

---

## Přehled

Framework se skládá ze tří hlavních částí:

| Soubor | Účel | Přepínač |
|--------|------|----------|
| `ai-static-validation.test.ts` | Statická analýza + AI testy | Žádný (vždy běží) |
| `schema-validation-v2.test.ts` | Validace DB schématu | `DB_VALIDATION=true` |
| `seed-validation.test.ts` | Validace seed.sql | `DB_VALIDATION=true` |

---

## 1. AI Static Validation

Běží **vždy** bez potřeby databáze. Ideální pro CI a rychlou validaci.

### Spuštění

```bash
# Všechny statické testy
npm run test:run src/tests/db/ai-static-validation.test.ts

# Jako součást celé test suite
npm run test:run
```

### Co testuje

**Statické testy (vždy běží):**
- ✅ File structure validation (seed.sql, migrations, types.ts)
- ✅ Security pattern detection (sensitive-data logging, unsafe code, direct table access)
- ✅ Seed SQL validation (INSERT statements, trigger handling)
- ✅ i18n locale validation (valid JSON, key coverage)
- ✅ Backup data validation (CSV exports exist)

**AI testy (Apple Silicon + MLX vyžadováno):**
- 🤖 Seed SQL logic validation
- 🤖 TypeScript types alignment
- 🤖 Security code review
- 🤖 React hooks patterns
- 🤖 i18n completeness

### Prerekvizity pro AI testy

```bash
# 1. macOS s Apple Silicon (M1/M2/M3/M4)
uname -m  # musí být arm64

# 2. Nastavení MLX Python venv
cd scripts/ai
python3 -m venv .venv
source .venv/bin/activate

# 3. Instalace MLX
pip install mlx mlx-lm

# 4. Model se stáhne automaticky při prvním použití
# mlx-community/Qwen2.5-Coder-7B-Instruct-4bit
```

MLX validace se spouští **automaticky** na podporovaných strojích.
Pro explicitní vypnutí: `SKIP_MLX_VALIDATION=1`

---

## 2. Schema Validation v2

Validuje DB schéma a typy **pouze s explicitním přepínačem**.

### Spuštění

```bash
# S přepínačem (vyžaduje lokální Supabase)
DB_VALIDATION=true npm run test:run src/tests/db/schema-validation-v2.test.ts

# Bez přepínače (pouze non-DB testy)
npm run test:run src/tests/db/schema-validation-v2.test.ts
```

### Co testuje

**Bez přepínače:**
- ✅ Type system (TypeScript alignment)
- ✅ Seed SQL obsahuje kritické tabulky
- ✅ AI availability check

**S `DB_VALIDATION=true`:**
- ✅ All auth.users from seed exist in DB
- ✅ All profiles reference valid auth.users
- ✅ user_roles reference valid auth.users
- ✅ memberships reference valid users
- ✅ program_registrations reference valid users and studies
- ✅ health_check_ins reference valid users
- ✅ products exist in DB
- ✅ partner_profiles reference valid users
- ✅ consents reference valid users

---

## 3. Seed Validation

Validuje seed.sql včetně `db reset`. **Potenciálně destruktivní operace!**

### Spuštění

```bash
# S přepínačem (POZOR: resetuje lokální DB!)
DB_VALIDATION=true npm run test:run src/tests/db/seed-validation.test.ts
```

### Co testuje

- ✅ seed.sql exists and is not empty
- ✅ seed.sql contains INSERT statements
- ✅ seed.sql contains required tables
- ✅ seed.sql disables/enables triggers correctly
- ✅ seed.sql has valid SQL syntax (via psql)
- ⚠️ **supabase db reset** (slow, ~60s, resets database!)
- ✅ Expected record counts after seeding

---

## Doporučené použití

### Během vývoje

```bash
# Rychlá statická validace (doporučeno před commitem)
npm run test:run src/tests/db/ai-static-validation.test.ts
```

### Před mergem do main

```bash
# Kompletní test suite (bez DB validace)
npm run test:run
```

### Po změnách v seed.sql nebo schématu

```bash
# Plná validace včetně DB (lokální Supabase musí běžet)
DB_VALIDATION=true npm run test:run src/tests/db/

# Nebo zvlášť
DB_VALIDATION=true npm run test:run src/tests/db/seed-validation.test.ts
DB_VALIDATION=true npm run test:run src/tests/db/schema-validation-v2.test.ts
```

---

## CI/CD Integrace

```yaml
# .github/workflows/test.yml

# Vždy běží statické testy
- name: Run Static Validation
  run: npm run test:run src/tests/db/ai-static-validation.test.ts

# DB validace jen manuálně nebo na schedule
- name: Run DB Validation
  if: github.event_name == 'schedule' || contains(github.event.head_commit.message, '[validate-db]')
  run: DB_VALIDATION=true npm run test:run src/tests/db/
```

---

## Troubleshooting

### Testy přeskočeny

```
ℹ️  DB Validation disabled (enable with DB_VALIDATION=true)
```

**Řešení:** Přidej `DB_VALIDATION=true` před příkaz.

### MLX AI not available

```
🤖 AI Validation (MLX): Unavailable
   Reason: MLX venv not found or not properly configured
```

**Řešení:**
```bash
cd scripts/ai
python3 -m venv .venv
source .venv/bin/activate
pip install mlx mlx-lm
```

**Pro vypnutí MLX validace:**
```bash
SKIP_MLX_VALIDATION=1 npm run test:run
```

### Database not accessible

```
Skipping psql syntax check - local Supabase not available
```

**Řešení:**
```bash
supabase start
```

### Seed validation failed

```
Seed validation failed: db reset error
```

**Řešení:**
- Zkontroluj že Supabase běží: `supabase status`
- Zkontroluj syntax seed.sql ručně
- Zkontroluj migrace: `supabase migration list`

---

## Architektura

```
src/tests/db/
├── ai-static-validation.test.ts  # Statické + AI testy (vždy běží)
├── schema-validation-v2.test.ts  # DB schéma (s přepínačem)
├── seed-validation.test.ts       # Seed + db reset (s přepínačem)
└── validation-utils.ts           # Sdílené utility
```

### Diagram rozhodování

```
npm run test:run
        │
        ▼
┌─────────────────────────┐
│ ai-static-validation    │ ← Vždy běží
│ - Static checks         │
│ - AI checks (if avail)  │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ DB_VALIDATION=true ?    │
└─────────────────────────┘
        │
   NO   │   YES
        │    │
        ▼    ▼
  SKIP DB   ┌─────────────────────────┐
  TESTS     │ schema-validation-v2    │
            │ - DB integrity checks   │
            └─────────────────────────┘
                     │
                     ▼
            ┌─────────────────────────┐
            │ seed-validation         │
            │ - db reset              │
            │ - count validation      │
            └─────────────────────────┘
```

---

*Dokument vytvořen: 12. ledna 2026*
