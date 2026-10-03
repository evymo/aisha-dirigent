# Database Migration Guidelines

## Idempotence & Extensions

### Důležité pravidlo pro pgcrypto

Pokud vaše migrace používá funkce z `pgcrypto` extension (`gen_random_bytes`, `digest`, atd.), MUSÍTE na začátku migrace explicitně vytvořit extension:

```sql
-- ✅ SPRÁVNĚ - Explicitní schéma, idempotentní
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
```

```sql
-- ❌ ŠPATNĚ - Může selhat na některých DB
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Funkce používající pgcrypto

Pokud vytváříte `SECURITY DEFINER` funkci, která volá pgcrypto funkce:

```sql
-- ✅ SPRÁVNĚ - Explicitní search_path a kvalifikace
CREATE OR REPLACE FUNCTION public.my_function()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
BEGIN
  RETURN encode(public.gen_random_bytes(6), 'hex');
END;
$$;
```

```sql
-- ❌ ŠPATNĚ - Může selhat pokud pgcrypto není v search_path
CREATE OR REPLACE FUNCTION public.my_function()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(gen_random_bytes(6), 'hex')
$$;
```

### Idempotence Checklist

Každá migrace MUSÍ být idempotentní (lze spustit vícekrát bez chyby):

- [ ] Extensions: `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA public`
- [ ] Tables: `DO $$ BEGIN IF to_regclass(...) IS NULL THEN CREATE TABLE ...`
- [ ] Columns: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- [ ] Constraints: Kontrola existence přes `pg_constraint` před `ADD CONSTRAINT`
- [ ] Indexes: `CREATE INDEX IF NOT EXISTS ...`
- [ ] Functions: `CREATE OR REPLACE FUNCTION ...`
- [ ] RLS Policies: `DROP POLICY IF EXISTS ... ; CREATE POLICY ...`
- [ ] Permissions: `REVOKE ALL ... ; GRANT ...`

### Příklad idempotentní migrace

```sql
-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- 2. Functions
CREATE OR REPLACE FUNCTION public.my_func()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
BEGIN
  RETURN 'test';
END;
$$;

-- 3. Tables
DO $$
BEGIN
  IF to_regclass('public.my_table') IS NULL THEN
    CREATE TABLE public.my_table (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL
    );
  END IF;
END $$;

-- 4. Columns (pro existující tabulky)
ALTER TABLE public.my_table
  ADD COLUMN IF NOT EXISTS new_column TEXT;

-- 5. Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'my_constraint'
      AND conrelid = 'public.my_table'::regclass
  ) THEN
    ALTER TABLE public.my_table
      ADD CONSTRAINT my_constraint CHECK (name != '');
  END IF;
END $$;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_my_table_name 
  ON public.my_table(name);

-- 7. RLS
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_name" ON public.my_table;
CREATE POLICY "policy_name"
  ON public.my_table
  FOR SELECT
  USING (auth.uid() = user_id);

-- 8. Permissions
REVOKE ALL ON TABLE public.my_table FROM PUBLIC;
GRANT SELECT ON TABLE public.my_table TO authenticated;
```

## Body-drift detekce a re-apply

Runner (`scripts/db/migrate.mjs`) sleduje u každé delty **sha256 checksum jejího
těla** ve sloupci `aisha_meta.applied_migrations.checksum`. Dřív se sledovala jen
`version`, takže oprava těla již aplikované migrace (např. `fafa90190` —
korekce neplatného `ai_event_type` v deferred migraci) se na existujících DB
**tiše ignorovala** ("migrate.mjs tracks by version → existing DBs unaffected").

Co runner dělá při každém běhu:

- **Vždy upozorní** ("body drift"), když se tělo již aplikované delty od záznamu
  změnilo — drift se nikdy neskryje.
- **Re-apply je opt-in** přes `AISHA_DB_REAPPLY_CHANGED=1`. Důvod: deferred delta
  může být **data migrace**, jejíž re-run by zduplikoval řádky → operátor o
  re-applikaci rozhoduje vědomě. Pro idempotentní `CREATE OR REPLACE` delty
  (viz checklist výše) je re-apply bezpečný a propaguje opravu na existující DB.
- **Absorbed (baseline-covered) migrace jsou z driftu vyloučeny.** Jejich těla
  jsou autoritativně nahrazena regenerovaným baseline; re-run staršího těla
  absorbed migrace přes opravený baseline je přesně ten deferred-re-apply defekt,
  proti kterému se chráníme. Baseline samotný nese `checksum = NULL`.
- **Legacy řádky** (záznam před zavedením checksumů, `checksum = NULL`) se při
  prvním běhu **doplní (backfill)** na aktuální tělo bez re-applikace — historický
  drift nelze zpětně zjistit, sledování začíná od současného stavu.

```bash
# Surface drift (default — pouze upozorní):
npm run db:migrate

# Propagovat opravené idempotentní delty na existující DB (vědomý opt-in):
AISHA_DB_REAPPLY_CHANGED=1 npm run db:migrate
```

> **Pravidlo:** Jakmile je migrace absorbed do baseline, **neopravuj její tělo
> kvůli existujícím DB** — přidej novou korektivní deltu. Editace těla je legitimní
> jen pro deferred delty (drift re-apply je propaguje) nebo jako belt-and-suspenders
> pro fresh cold-start.

## Testování migrací

Před push:

```bash
# 1. Test na čistém dev prostředí
npm run db:migrate

# 2. Test idempotence (spustit 2x za sebou)
npm run db:migrate
npm run db:migrate

# 3. Ověřit že build prochází
npm run build
```

## Troubleshooting

### Error: function gen_random_bytes does not exist

**Příčina:** Chybí pgcrypto extension  
**Fix:** Přidat na začátek migrace:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
```

### Error: permission denied for schema

**Příčina:** Funkce nemá správný search_path  
**Fix:** Použít:
```sql
SET search_path TO public, pg_catalog
```

### Error: duplicate key value violates unique constraint

**Příčina:** Migrace není idempotentní  
**Fix:** Použít `IF NOT EXISTS` nebo `DO $$ BEGIN ... END $$` bloky
