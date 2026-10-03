---
name: aisha-migration
description: Create database migrations for the AISHA platform with proper SoT (source-of-truth) pairing. Use when adding new tables, RPC functions, indexes, RLS policies, or modifying schema. Triggers on "create migration", "add table", "new RPC", "schema change", "add column", "alter table", "new index". Critical to know that aisha/db/migrations/00000000000000_baseline.sql is auto-generated from aisha/db/sql/ — never edit directly. After baseline regeneration, applied migrations get archived to the absorbed migration (now in the baseline)
---

# AISHA Migration Skill

Vytváření databázových migrací pro AISHA stack se striktním dodržováním SoT (Source of Truth) párování.

## Kritická pravidla — NIKDY NEPORUŠOVAT

1. **NIKDY needituj `aisha/db/migrations/00000000000000_baseline.sql` přímo** — je auto-generován z `aisha/db/sql/` přes `npm run db:init:generate`. Edit baseline = ztracený při příštím refresh.
2. **NIKDY needituj `aisha/db/seed.sql` přímo** — je auto-compiled z `aisha/db/seed/` přes `npm run db:seed:compile`.
3. **Každá nová tabulka/funkce vyžaduje pár**: jeden soubor v `aisha/db/sql/{tables,functions,...}/{name}.sql` + jeden soubor v `aisha/db/migrations/[timestamp]_description.sql`.

## Lifecycle migrace

```
                      git commit
                           │
   ┌───────────────────────┼───────────────────────┐
   ▼                       ▼                       ▼
 SoT file               Migration               registry.json
 aisha/db/sql/          aisha/db/migrations/    aisha/db/migration-
 {kind}/{name}.sql      [ts]_desc.sql           registry.json
                                                (auto-managed)
                                  │
                                  ▼
                       npm run db:migrate:local
                                  │
                                  ▼
                     [some time / many migrations later]
                                  │
                                  ▼
                       npm run db:init:generate
                       (regenerates baseline.sql from SoT files)
                                  │
                                  ▼
                     [maintainer rozhoduje o archive]
                                  │
                                  ▼
                     mv aisha/db/migrations/[ts]_desc.sql \
                        the absorbed migration (now in the baseline)
                     update migration-registry.json
                     update baseline-meta.json
```

> **Důležité**: po archivaci migrace už nikdy neaplikuje proti čerstvé DB (baseline obsahuje její DDL). Zůstává v archive jen pro audit/historii.

## Step-by-step: vytvoření nové migrace

### 1. Naplánuj scope

Před psaním rozhodni:
- **Co se mění**: nová tabulka? nová RPC? alter na existující tabulku?
- **Vztahy**: FK na jiné tabulky? RLS policies? indexy?
- **Hosting**: která doména (admin? story? observability? deploy? auth?)?
- **Rate of change**: to-be-archived (jednorázová alterace) vs to-stay-in-baseline (nová stable struktura)?

### 2. Vytvoř SoT soubor (pokud nová tabulka/funkce)

**Tabulky** → `aisha/db/sql/tables/{name}.sql`:

```sql
-- ============================================================================
-- Source of Truth: {name}
-- Popis: {jednovětý popis účelu tabulky}
--        Spravováno: {který workflow/service do toho zapisuje}
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.{name} (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  ...kolumny...,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.{name} IS '{popis}';
COMMENT ON COLUMN public.{name}.{key_field} IS '{specifický popis if non-obvious}';

CREATE INDEX IF NOT EXISTS idx_{name}_{column} ON public.{name} ({column});

ALTER TABLE public.{name} ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS {name}_read ON public.{name};
CREATE POLICY {name}_read ON public.{name}
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS {name}_service ON public.{name};
CREATE POLICY {name}_service ON public.{name}
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
```

**Funkce** → `aisha/db/sql/functions/{name}.sql`:

```sql
-- ============================================================================
-- Source of Truth: {name}
-- Popis: {popis}
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.{name}(
  p_arg1 type,
  p_arg2 type DEFAULT NULL
)
RETURNS {return_type}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_var type;
  v_is_service boolean;
BEGIN
  -- Authorization: explicit check
  v_is_service := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Implementation
  ...

  RETURN v_var;
END;
$$;

REVOKE ALL ON FUNCTION public.{name}({arg_types}) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.{name}({arg_types}) TO authenticated;
GRANT EXECUTE ON FUNCTION public.{name}({arg_types}) TO service_role;
```

### 3. Vytvoř migration soubor

`aisha/db/migrations/{YYYYMMDDHHMMSS}_{description}.sql`:

Timestamp generuj jako:
```bash
date +%Y%m%d%H%M%S
```
(Např. `20260428100000`.)

Migrace má **stejný obsah** jako SoT soubor, ale:
- Může obsahovat `INSERT` seed data (SoT obsahuje jen DDL)
- Může obsahovat `ALTER TABLE` (SoT vždy reflektuje **current state**, ne diff)
- Vždy končí `INSERT INTO audit_journal` zápisem o aplikaci migrace

```sql
-- ============================================================================
-- {short title}
-- ============================================================================
-- {explanation: what + why}
--
-- Source of truth pair:
--   aisha/db/sql/tables/{name}.sql
--   aisha/db/sql/functions/{name}.sql
--
-- Související specs:
--   docs/...
-- ============================================================================

{migrace SQL — same as SoT}

-- Audit
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  NULL,
  '{description}.applied',
  jsonb_build_object(
    'migration', '{filename without .sql}',
    'breaking_changes', false
  )
);
```

### 4. Registrace migrace

```bash
npm run db:migration:register
```

Tento skript:
- Skenuje `aisha/db/migrations/` pro `.sql` soubory
- Updatuje `aisha/db/migration-registry.json`
- Validuje proti `migration-registry.schema.json`

### 5. Aplikace migrace lokálně

```bash
npm run db:migrate:local
```

Pak regeneruj TypeScript typy z DB:
```bash
npm run db:types:gen:local
```

A ověř TS compile:
```bash
npx tsc --noEmit
```

### 6. Validace

```bash
npm run func:validate         # Validate all SQL functions
npm run db-mgr:lint           # Lint SQL
npm run db-mgr:source         # Source-of-truth audit
npx vitest run src/tests/gates/audited-function-integrity.gate.test.ts
```

## Patterns pro běžné případy

### Audit logging v RPC

Každá mutating RPC, která dělá něco "důležitého", zapisuje do `audit_journal`:

```sql
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  auth.uid(),
  '{action_name}',
  jsonb_build_object(
    'key1', value1,
    'key2', value2
  )
);
```

**Nikdy** nelogovat PII (email, plain text secrets, full request body) — jen IDs a metadata.

### Idempotency

Pokud migrace může být spuštěna dvakrát (CI re-run, partial failure), použij:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `INSERT ... ON CONFLICT (...) DO UPDATE` (na unique constraint)
- `DROP POLICY IF EXISTS` před `CREATE POLICY`

### Indexy s `WHERE` filterem

Pro tabulky s častými query proti subset rowsů:
```sql
CREATE INDEX IF NOT EXISTS idx_drift_state_unresolved
  ON public.drift_state (app_uuid, drift_kind)
  WHERE resolved_at IS NULL;
```

### RLS strategy

Default pro AISHA tabulky:
- `READ`: admin/staff via `is_admin_or_staff()`
- `WRITE`: service_role only
- Pro user-data: `USING (user_id = auth.uid())` policy
- Pro multi-tenant: `USING (partner_id IN (...))`

### Risk evaluation

Pokud RPC dělá riskantní akci (deploy, secret change, data delete), volej `fn_evaluate_proposal_risk`:

```sql
v_risk := public.fn_evaluate_proposal_risk(
  'agent_slug',
  'category',  -- e.g., 'infrastructure_drift', 'rollback', 'blue_green_switch'
  jsonb_build_object('key', value)
);

IF v_risk IN ('high', 'critical') THEN
  -- Eskaluj na WF_APPROVAL_GATE, neexekuuj přímo
  RAISE EXCEPTION 'Risk level % requires approval gate', v_risk;
END IF;
```

## Po refreshi baseline (archive flow)

Když maintainer rozhodne, že migrace už není "pending" (patří do baseline):

1. **Regenerace baseline**: `npm run db:init:generate`
2. **Verify**: `npm run db-mgr:source` ověří, že SoT files match baseline
3. **Archive migration**:
   ```bash
   mv aisha/db/migrations/{ts}_desc.sql the absorbed migration (now in the baseline)
   ```
4. **Update registry**: znovu spusť `npm run db:migration:register` (auto-removes archived migrations from registry)
5. **Verify baseline-meta**: `aisha/db/baseline-meta.json` by měl odrážet nový `refreshed_at` a `pending_migrations` array bez archivované migrace

> **Když pracuješ na migraci**: vždy předpokládej, že migrace zůstane v `aisha/db/migrations/` jen po dobu několika sprintů. SoT soubor je permanentní zdroj pravdy. Migrace je delta-script.

## Anti-patterns (NEDĚLAT)

❌ **Edit baseline.sql directly** → změna je ztracená při příštím `db:init:generate`
❌ **Migration bez SoT pair** → po refresh baseline se ztratí (baseline neví o tabulce)
❌ **Multiple changes per migration file** → ztížený rollback, audit, code review
❌ **Direct `.from('table_name')` in app code** → CLAUDE.md zakazuje, používej RPC
❌ **`SELECT *`** → vždy explicit columns
❌ **Plain text secrets v migration** → použij Postgres `pgsodium` extension
❌ **Skip `REVOKE ALL FROM PUBLIC`** → security gap
❌ **Mutating RPC bez audit log** → ztížený forensics

## Quick reference příkazů

| Akce | Příkaz |
|---|---|
| Vytvořit timestamp pro migraci | `date +%Y%m%d%H%M%S` |
| Registrovat novou migraci | `npm run db:migration:register` |
| Aplikovat lokálně | `npm run db:migrate:local` |
| Regenerovat TS types | `npm run db:types:gen:local` |
| Validovat funkce | `npm run func:validate` |
| Lint SQL | `npm run db-mgr:lint` |
| SoT audit | `npm run db-mgr:source` |
| Status migrací | `npm run db:status` |
| Regenerovat baseline | `npm run db:init:generate` |

## Reference

- `CLAUDE.md` — Absolute rules (RPC-Only, no `.from()` v app, etc.)
- `aisha/db/baseline-meta.json` — current baseline state
- `aisha/db/migration-registry.json` — registered pending migrations
- `aisha/db/migration-registry.schema.json` — registry schema
- `the absorbed migration (now in the baseline)` — archived migrations (audit only)
- `scripts/db/audit-sot-vs-migrations.py` — SoT/migration drift detector
