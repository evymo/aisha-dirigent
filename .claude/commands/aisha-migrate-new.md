# AISHA — Scaffold New Migration

Vytvoří novou migraci s SoT párem podle AISHA pravidel.

## Arguments: $ARGUMENTS

Format: `<table_or_function_name> [tables|functions|policies|indexes|triggers]`

Příklady:
- `/aisha-migrate-new my_new_table tables`
- `/aisha-migrate-new my_rpc_function functions`
- `/aisha-migrate-new` (no args → ask interactively)

## Instructions

1. **Parse $ARGUMENTS**: extract `name` (required) a `kind` (default: `tables`)

2. **Pokud chybí name**: Zeptej se uživatele:
   - Jak se jmenuje tabulka/funkce?
   - Jaký kind (tables, functions, policies, indexes, triggers)?
   - Krátký popis účelu?

3. **Generuj timestamp**:
   ```bash
   date +%Y%m%d%H%M%S
   ```

4. **Vytvoř SoT soubor**: `aisha/db/sql/{kind}/{name}.sql`
   - Použij šablonu z `.claude/skills/aisha-migration/SKILL.md` § Step 2
   - Pokud kind=`tables`: zahrnuj CREATE TABLE + indexes + RLS
   - Pokud kind=`functions`: zahrnuj SECURITY DEFINER + REVOKE/GRANT pattern dle `aisha-rpc` skill

5. **Vytvoř migration soubor**: `aisha/db/migrations/{timestamp}_{description}.sql`
   - Stejný obsah jako SoT
   - Plus audit_journal INSERT na konci

6. **Registruj migraci**:
   ```bash
   npm run db:migration:register
   ```

7. **Aplikuj lokálně** (jen pokud user explicitně chce):
   ```bash
   npm run db:migrate:local
   npm run db:types:gen:local
   npx tsc --noEmit
   ```

8. **Vypiš checklist**:
   - [ ] SoT soubor vytvořen
   - [ ] Migration soubor vytvořen
   - [ ] Registry updated
   - [ ] (Optional) Migration applied locally
   - [ ] (Optional) Types regenerated
   - Připomeň skill: `.claude/skills/aisha-migration/SKILL.md`

## Notes

- Nevyhrazuj, **nikdy** needituj `aisha/db/migrations/00000000000000_baseline.sql`
- Uvedení `breaking_changes: true` v audit_journal metadata pokud migrace mění existing schema (ALTER TABLE)
- Pro funkce volej skill `aisha-rpc` pro správný SECURITY DEFINER pattern
