# Quick Reference: Oprava konzistence RBAC

## 🚨 Vývojové principy (MUSÍ se dodržovat)

| Princip | Pravidlo |
|---------|----------|
| **RPC-Only** | Všechny DB operace přes `supabase.rpc()` |
| **Žádné sensitive data v logách** | Používat `safeError()`, nikdy email/jméno/citlivá data |
| **Zod validace** | Všechna externí data validovat přes Zod schema |
| **Explicitní sloupce** | Žádné `.select("*")`, vždy vyjmenovat sloupce |
| **Testy** | `npm run test:run && npm run build` před push |

## 📊 RBAC tabulky

```
permissions (source of truth)
    ↓
app_role_permissions (role → permission_id mapping)
    ↓
user_roles (user_id → role assignment)
```

## 🔍 Diagnostické příkazy

```bash
# Permissions exist?
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c \
  "SELECT count(*) FROM permissions"

# Role mappings exist?
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c \
  "SELECT role, count(*) FROM app_role_permissions GROUP BY role ORDER BY role"

# RPC works?
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c \
  "SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%permission%'"

# RLS enabled?
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c \
  "SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('permissions', 'app_role_permissions')"
```

## ✅ Očekávané hodnoty

| Role | Počet permissions |
|------|-------------------|
| admin | Všechny (~35) |
| member | 6 |
| staff | 4 |
| partner | 9 |
| practitioner | 11 |
| evaluator | 2 |

## 🛠️ Rychlá oprava (seed dat)

```sql
-- Insert všechny permissions (ON CONFLICT DO UPDATE)
INSERT INTO permissions (code, name, category, is_system) VALUES
  ('view_phi', 'View sensitive-data', 'phi', true),
  ('view_admin_dashboard', 'View Admin Dashboard', 'admin', true),
  -- ... další z CONSISTENCY_REPAIR_PROMPT.md
ON CONFLICT (code) DO UPDATE SET updated_at = now();

-- Admin = všechny permissions
INSERT INTO app_role_permissions (role, permission_id)
SELECT 'admin'::app_role, id FROM permissions
ON CONFLICT DO NOTHING;
```

## 📝 Checklist

- [ ] `permissions` má všechny kódy z `usePermissions.ts`
- [ ] `app_role_permissions` má mapování pro všechny role
- [ ] RLS enabled na obou tabulkách
- [ ] `get_user_permissions()` RPC existuje a má GRANT
- [ ] Admin RPCs existují a fungují
- [ ] `npm run test:run` prochází

---

Kompletní prompt: [CONSISTENCY_REPAIR_PROMPT.md](./CONSISTENCY_REPAIR_PROMPT.md)
