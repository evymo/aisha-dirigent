# Database Migration System - Platform

## Přehled

Tento dokument popisuje migrační systém databáze včetně baseline schématu a self-repair mechanismu.

## Struktura Migrací

```
supabase/migrations/
├── 00000000000000_baseline_v0.sql      # Kompletní schéma v1.0
├── 00000000000001_self_repair_system.sql # Auto-diagnostika a opravy
├── 00000000000002_seed_data.sql        # Výchozí data (role, permissions, etc.)
├── 20251207*.sql → 20251219*.sql       # Legacy migrace (zachovány pro kompatibilitu)
└── supabase/migrations_archive_v0/     # Archiv konsolidovaných migrací
```

## Baseline v0 (00000000000000_baseline_v0.sql)

Obsahuje kompletní schéma databáze:

### Tabulky

| Kategorie | Tabulky |
|-----------|---------|
| Users & Auth | `profiles`, `user_roles`, `roles`, `permissions`, `role_permissions` |
| Studies | `studies`, `program_registrations`, `study_consultants`, `study_blinding_config`, `study_distribution_protocols` |
| Activity Tracking | `health_check_ins`, `member_health_documents`, `lab_results`, `activity_logs`, `wearables_data` |
| Partners | `partner_profiles`, `partner_appointments`, `partner_availability`, `partner_certifications` |
| E-commerce | `products`, `orders`, `order_items`, `cart_items`, `subscription_packages` |
| Consents | `consents`, `data_sharing_consents`, `document_sharing_permissions` |
| Audit | `audit_logs`, `audit_journal`, `security_event_resolutions`, `user_sessions` |
| Tokens | `token_allocations`, `token_transactions`, `token_reward_rules` |
| Production | `production_batches`, `product_vials`, `production_workflow_steps` |

### Vlastnosti

- **Idempotentní**: Všechny `CREATE TABLE` používají `IF NOT EXISTS`
- **RLS**: Automaticky povoleno na všech tabulkách
- **Indexy**: Vytvořeny pro výkon

## Self-Repair System (00000000000001_self_repair_system.sql)

### Funkce

#### `db_self_repair()` - Automatická oprava

```sql
-- Spustit opravu (pouze service_role)
SELECT public.db_self_repair();
```

Kontroluje a opravuje:
- ✅ Chybějící rozšíření (pgcrypto, pg_trgm)
- ✅ Chybějící sloupce v tabulkách
- ✅ Tabulky bez RLS
- ✅ Chybějící systémové role
- ✅ Chybějící indexy
- ✅ Výchozí data

Vrací JSON s přehledem oprav:
```json
{
  "success": true,
  "repairs_count": 3,
  "repairs": [
    {"type": "extension", "name": "pgcrypto", "action": "created"},
    {"type": "column", "table": "profiles", "column": "must_change_password", "action": "added"},
    {"type": "role", "name": "admin", "action": "created"}
  ],
  "timestamp": "2024-12-19T21:27:00Z"
}
```

#### `db_diagnose()` - Diagnostika (read-only)

```sql
-- Spustit diagnostiku (authenticated users)
SELECT public.db_diagnose();
```

Vrací:
```json
{
  "healthy": true,
  "issues_count": 0,
  "issues": [],
  "schema_version": "1.0.0",
  "last_repair": "2024-12-19T21:27:00Z"
}
```

### Sledování oprav

Všechny opravy jsou zaznamenány v `schema_repairs`:
```sql
SELECT * FROM schema_repairs ORDER BY repaired_at DESC;
```

## Použití

### Nová instalace

```bash
# Aplikuje všechny migrace od baseline
supabase db reset
```

### Oprava existující DB

```sql
-- 1. Nejprve diagnostika
SELECT public.db_diagnose();

-- 2. Pokud jsou problémy, spustit opravu
SELECT public.db_self_repair();

-- 3. Ověřit
SELECT public.db_diagnose();
```

### Přidání nové migrace

```bash
# Vytvořit novou migraci
supabase migration new popis_zmeny

# Upravit soubor v supabase/migrations/
# Použít IF NOT EXISTS, ON CONFLICT DO NOTHING pro idempotenci
```

### Pravidla pro nové migrace

1. **Idempotence**: Vždy používat `IF NOT EXISTS`, `ON CONFLICT`
2. **RLS**: Vždy povolit RLS na nových tabulkách
3. **Rollback**: Dokumentovat rollback v komentáři
4. **Self-repair**: Přidat check do `db_self_repair()` pro kritické změny

```sql
-- Příklad idempotentní migrace
CREATE TABLE IF NOT EXISTS public.new_feature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);

ALTER TABLE public.new_feature ENABLE ROW LEVEL SECURITY;

-- Přidat do self_repair pokud je kritické
```

## Schema Verze

Aktuální verze schématu je sledována v `schema_version`:

```sql
SELECT * FROM schema_version;
-- version: 1.0.0
-- baseline_applied_at: 2024-12-19
-- last_repair_at: 2024-12-19
```

## Archiv

Původní migrace (142 souborů) jsou archivovány v:
- `supabase/migrations_archive_v0/ALL_MIGRATIONS_CONSOLIDATED.sql`

Tento archiv slouží jako reference a pro případnou analýzu historie změn.

## Troubleshooting

### Chyba: function gen_salt(unknown) does not exist

```sql
-- Oprava
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- Nebo použij self-repair
SELECT public.db_self_repair();
```

### Chyba: RLS policy violation

```sql
-- Zkontroluj RLS
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = false;

-- Oprav pomocí self-repair
SELECT public.db_self_repair();
```

### Chybějící role

```sql
-- Zkontroluj
SELECT * FROM roles;

-- Self-repair doplní chybějící
SELECT public.db_self_repair();
```

## Best Practices

1. **Před deploy**: Vždy spustit `db_diagnose()` v staging
2. **Po deploy**: Spustit `db_self_repair()` pro jistotu
3. **Monitoring**: Pravidelně kontrolovat `schema_repairs`
4. **Backup**: Před většími změnami zálohovat
5. **Testování**: Nové migrace testovat lokálně

## Kontakt

Pro otázky ohledně databázového schématu kontaktujte development team.
