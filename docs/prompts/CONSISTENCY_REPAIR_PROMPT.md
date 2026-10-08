# 🔧 Prompt pro opravu konzistence aplikace Platform

## 📋 Kontext

Tento prompt je určen pro systematickou opravu konzistence **produkční aplikace** pracující s **reálnými citlivými daty**. Aplikace již měla funkční RBAC systém s daty, který se během vývoje poškodil nebo ztratil konzistenci.

---

## 🛡️ DŮRAZNÉ POŽADAVKY NA KVALITU A DOTAŽENÍ

**Oprava NESMÍ být provedena formou rychlých záplat nebo zjednodušení.**

- Každý krok musí být dotažen do finální podoby v souladu s architekturou a bezpečnostními standardy aplikace.
- Očekává se plné prověření a případná oprava všech endpointů, RPC funkcí, RLS policies, seed dat, mapování a návazností.
- Oprava musí být **systémová, konzistentní a auditovatelná** – žádné workaroundy, žádné opomenuté části.
- Všechny změny musí být pokryty testy a ověřeny v reálném běhu aplikace.
- Výsledkem je stav, kdy je permission systém, RBAC, RLS i všechny související endpointy a rozhraní v plné shodě s dokumentací a architekturou.

---

---

## 🎯 Cíl

Opravit a obnovit konzistenci:
1. **Permission systému** - `permissions`, `app_role_permissions`, `user_roles`
2. **RLS policies** - správné nastavení pro všechny tabulky
3. **RPC funkcí** - autorizace, audit, granty
4. **Seed dat** - obnovení výchozích rolí a oprávnění

---

## 🚨 KRITICKÉ vývojové principy (POVINNÉ)

### 1. RPC-Only Pattern

**Všechny DB operace MUSÍ jít přes `supabase.rpc()`**

```typescript
// ✅ SPRÁVNĚ - RPC s auditem
const { data } = await supabase.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});

// ❌ ZAKÁZÁNO - Přímý dotaz
const { data } = await supabase.from("health_check_ins").select("*");
```

**Proč:**
- Automatický audit log pro sensitive data přístupy
- Explicitní sloupce (žádný overfetch)
- Business logic v DB, ne v klientu
- Double security: RLS + function-level authorization

### 2. Žádné sensitive data v logách

```typescript
// ✅ SPRÁVNĚ
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));

// ❌ ZAKÁZÁNO
console.error(`Failed for user ${email}:`, error);
```

**sensitive-data zahrnuje:** emaily, jména, DOB, adresy, citlivá data, session tokeny

### 3. Zod/JSON validace

**Všechna data z externích zdrojů MUSÍ být validována:**

```typescript
import { z } from "zod";

const userPermissionRowSchema = z.object({
  section: z.string(),
  permission: z.string(),
  role: z.string(),
});

const parsed = z.array(userPermissionRowSchema).safeParse(data);
if (!parsed.success) {
  throw new Error("Invalid data format");
}
```

### 4. Testování před push

```bash
# POVINNÉ před každým push
npm run test:run && npm run build
```

- 1000+ testů MUSÍ projít
- 0 TypeScript chyb
- 0 ESLint chyb

### 5. Explicitní sloupce (žádný overfetch)

```sql
-- ✅ SPRÁVNĚ
SELECT id, code, name FROM permissions WHERE ...

-- ❌ ZAKÁZÁNO
SELECT * FROM permissions WHERE ...
```

---

## 📊 Aktuální architektura RBAC

### Klíčové tabulky

| Tabulka | Účel |
|---------|------|
| `permissions` | Katalog všech permission codes (source of truth) |
| `app_role_permissions` | Mapování role → permission_id |
| `user_roles` | Přiřazení rolí uživatelům |
| `roles` | Definice rolí s capabilities |

### Klíčové RPC funkce

| Funkce | Účel |
|--------|------|
| `get_user_permissions()` | Vrací permission codes pro auth.uid() |
| `get_permissions_catalog_admin()` | Admin: seznam všech permissions |
| `get_app_role_permissions_admin()` | Admin: mapování role→permission |
| `grant_app_role_permission_admin()` | Admin: přidělit permission |
| `revoke_app_role_permission_admin()` | Admin: odebrat permission |

### Permission codes (frontend)

```typescript
// src/hooks/usePermissions.ts
export type PermissionCode =
  // sensitive data Access
  | "view_phi"
  | "edit_phi"
  | "share_phi"
  // Member Features
  | "view_studies"
  | "enroll_studies"
  | "submit_checkins"
  | "upload_documents"
  // Shop Access
  | "view_products"
  | "preorder_products"
  | "order_products"
  | "auto_approve_orders"
  // Partner Features
  | "view_assigned_members"
  | "manage_member_assignments"
  | "view_partner_dashboard"
  // Admin Features
  | "view_admin_dashboard"
  | "manage_users"
  | "manage_roles"
  | "manage_permissions"
  // ... další
```

---

## 🔍 Co ověřit a opravit

### 1. Ověření existence tabulek

```sql
-- Zkontrolovat existence klíčových tabulek
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('permissions', 'app_role_permissions', 'user_roles', 'roles');
```

### 2. Ověření seed dat v `permissions`

```sql
-- Měly by existovat všechny permission codes z frontendu
SELECT code, name, category FROM permissions ORDER BY category, code;
```

**Očekávané permission codes:**

| Category | Codes |
|----------|-------|
| `phi` | `view_phi`, `edit_phi`, `share_phi` |
| `member` | `view_studies`, `enroll_studies`, `submit_checkins`, `upload_documents` |
| `shop` | `view_products`, `preorder_products`, `order_products`, `auto_approve_orders` |
| `partner` | `view_assigned_members`, `manage_member_assignments`, `view_partner_dashboard`, `schedule_appointments`, `send_member_messages`, `view_member_progress` |
| `partner_professional` | `view_operational_details`, `create_operational_notes`, `issue_recommendations`, `access_lab_interpretations`, `prescribe_protocols` |
| `partner_amateur` | `view_basic_health_summary`, `create_wellness_notes`, `suggest_lifestyle_changes` |
| `evaluator` | `evaluate_health_data`, `create_assessments` |
| `admin` | `view_admin_dashboard`, `manage_users`, `manage_roles`, `manage_permissions`, `manage_studies`, `manage_products`, `manage_orders`, `view_audit_logs`, `manage_system_config` |
| `staff` | `view_staff_dashboard`, `process_orders`, `view_basic_reports` |

### 3. Ověření mapování `app_role_permissions`

```sql
-- Mělo by existovat mapování pro každou roli
SELECT 
  arp.role,
  p.code,
  p.category
FROM app_role_permissions arp
JOIN permissions p ON p.id = arp.permission_id
ORDER BY arp.role, p.category, p.code;
```

**Očekávané mapování:**

| Role | Permission Codes |
|------|------------------|
| `admin` | Všechny permissions |
| `member` | `view_studies`, `enroll_studies`, `submit_checkins`, `upload_documents`, `view_products`, `order_products` |
| `staff` | `view_staff_dashboard`, `process_orders`, `view_basic_reports`, `manage_orders` |
| `partner` | `view_partner_dashboard`, `view_assigned_members`, `view_member_progress`, `schedule_appointments`, `send_member_messages`, `view_basic_health_summary`, `create_wellness_notes`, `suggest_lifestyle_changes` |
| `practitioner` | `view_partner_dashboard`, `view_assigned_members`, `view_member_progress`, `schedule_appointments`, `send_member_messages`, `view_operational_details`, `create_operational_notes`, `access_lab_interpretations`, `prescribe_protocols`, `issue_recommendations` |
| `evaluator` | `evaluate_health_data`, `create_assessments` |

### 4. Ověření RPC funkcí

```sql
-- Zkontrolovat existence funkcí
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public'
AND routine_name IN (
  'get_user_permissions',
  'get_permissions_catalog_admin',
  'get_app_role_permissions_admin',
  'grant_app_role_permission_admin',
  'revoke_app_role_permission_admin'
);
```

### 5. Ověření GRANT/REVOKE

```sql
-- Zkontrolovat EXECUTE grants
SELECT 
  p.proname AS function_name,
  CASE WHEN acl.grantee = 0 THEN 'public'
       WHEN r.rolname IS NOT NULL THEN r.rolname
       ELSE acl.grantee::text
  END AS grantee,
  acl.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE p.pronamespace = 'public'::regnamespace
AND p.proname LIKE '%permission%'
ORDER BY p.proname;
```

### 6. Ověření RLS policies

```sql
-- Zkontrolovat RLS status na klíčových tabulkách
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('permissions', 'app_role_permissions', 'user_roles', 'roles');

-- Zkontrolovat policies
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('permissions', 'app_role_permissions', 'user_roles', 'roles');
```

---

## 🛠️ Opravná migrace (template)

```sql
-- migrations/YYYYMMDDHHMMSS_fix_rbac_consistency.sql

-- =============================================================================
-- Fix RBAC Consistency
-- =============================================================================
-- Purpose: Obnovit konzistenci permission systému
-- =============================================================================

-- 1. Zajistit existenci tabulek
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  UNIQUE(role, permission_id)
);

-- 2. Enable RLS
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_role_permissions ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS "permissions_read_authenticated" ON public.permissions;
CREATE POLICY "permissions_read_authenticated" ON public.permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "permissions_admin_all" ON public.permissions;
CREATE POLICY "permissions_admin_all" ON public.permissions
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "app_role_permissions_read_authenticated" ON public.app_role_permissions;
CREATE POLICY "app_role_permissions_read_authenticated" ON public.app_role_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_role_permissions_admin_all" ON public.app_role_permissions;
CREATE POLICY "app_role_permissions_admin_all" ON public.app_role_permissions
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Seed permission codes
INSERT INTO public.permissions (code, name, description, category, is_system) VALUES
  -- sensitive-data
  ('view_phi', 'View sensitive-data', 'Can view sensitive data', 'phi', true),
  ('edit_phi', 'Edit sensitive-data', 'Can edit sensitive data', 'phi', true),
  ('share_phi', 'Share sensitive-data', 'Can share sensitive data', 'phi', true),
  -- Member
  ('view_studies', 'View Studies', 'Can view available studies', 'member', true),
  ('enroll_studies', 'Enroll in Studies', 'Can enroll in studies', 'member', true),
  ('submit_checkins', 'Submit Check-ins', 'Can submit check-ins', 'member', true),
  ('upload_documents', 'Upload Documents', 'Can upload private documents', 'member', true),
  -- Shop
  ('view_products', 'View Products', 'Can view products', 'shop', true),
  ('preorder_products', 'Preorder Products', 'Can preorder products', 'shop', true),
  ('order_products', 'Order Products', 'Can order products', 'shop', true),
  ('auto_approve_orders', 'Auto-approve Orders', 'Orders are auto-approved', 'shop', true),
  -- Partner shared
  ('view_assigned_members', 'View Assigned Members', 'Can view assigned members', 'partner', true),
  ('manage_member_assignments', 'Manage Member Assignments', 'Can manage member assignments', 'partner', true),
  ('view_partner_dashboard', 'View Partner Dashboard', 'Can view partner dashboard', 'partner', true),
  ('schedule_appointments', 'Schedule Appointments', 'Can schedule appointments', 'partner', true),
  ('send_member_messages', 'Send Member Messages', 'Can send messages to members', 'partner', true),
  ('view_member_progress', 'View Member Progress', 'Can view member progress', 'partner', true),
  -- Partner professional
  ('view_operational_details', 'View Operational Details', 'Can view operational details', 'partner_professional', true),
  ('create_operational_notes', 'Create Operational Notes', 'Can create operational notes', 'partner_professional', true),
  ('issue_recommendations', 'Issue Recommendations', 'Can issue recommendations', 'partner_professional', true),
  ('access_lab_interpretations', 'Access Lab Interpretations', 'Can access lab interpretations', 'partner_professional', true),
  ('prescribe_protocols', 'Prescribe Protocols', 'Can prescribe protocols', 'partner_professional', true),
  -- Partner amateur
  ('view_basic_health_summary', 'View Basic Activity Summary', 'Can view basic health summary', 'partner_amateur', true),
  ('create_wellness_notes', 'Create Wellness Notes', 'Can create wellness notes', 'partner_amateur', true),
  ('suggest_lifestyle_changes', 'Suggest Lifestyle Changes', 'Can suggest lifestyle changes', 'partner_amateur', true),
  -- Evaluator
  ('evaluate_health_data', 'Evaluate Activity Data', 'Can evaluate sensitive data', 'evaluator', true),
  ('create_assessments', 'Create Assessments', 'Can create assessments', 'evaluator', true),
  -- Admin
  ('view_admin_dashboard', 'View Admin Dashboard', 'Can view admin dashboard', 'admin', true),
  ('manage_users', 'Manage Users', 'Can manage users', 'admin', true),
  ('manage_roles', 'Manage Roles', 'Can manage roles', 'admin', true),
  ('manage_permissions', 'Manage Permissions', 'Can manage permissions', 'admin', true),
  ('manage_studies', 'Manage Studies', 'Can manage studies', 'admin', true),
  ('manage_products', 'Manage Products', 'Can manage products', 'admin', true),
  ('manage_orders', 'Manage Orders', 'Can manage orders', 'admin', true),
  ('view_audit_logs', 'View Audit Logs', 'Can view audit logs', 'admin', true),
  ('manage_system_config', 'Manage System Config', 'Can manage system configuration', 'admin', true),
  -- Staff
  ('view_staff_dashboard', 'View Staff Dashboard', 'Can view staff dashboard', 'staff', true),
  ('process_orders', 'Process Orders', 'Can process orders', 'staff', true),
  ('view_basic_reports', 'View Basic Reports', 'Can view basic reports', 'staff', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  updated_at = now();

-- 5. Seed role-permission mappings
-- Admin gets ALL permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'admin'::public.app_role, p.id
FROM public.permissions p
ON CONFLICT (role, permission_id) DO NOTHING;

-- Member permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'member'::public.app_role, p.id
FROM public.permissions p
WHERE p.code IN ('view_studies', 'enroll_studies', 'submit_checkins', 'upload_documents', 'view_products', 'order_products')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Staff permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'staff'::public.app_role, p.id
FROM public.permissions p
WHERE p.code IN ('view_staff_dashboard', 'process_orders', 'view_basic_reports', 'manage_orders')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Partner (amateur) permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'partner'::public.app_role, p.id
FROM public.permissions p
WHERE p.code IN (
  'view_partner_dashboard', 'view_assigned_members', 'view_member_progress',
  'schedule_appointments', 'send_member_messages',
  'view_basic_health_summary', 'create_wellness_notes', 'suggest_lifestyle_changes'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Practitioner (professional) permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'practitioner'::public.app_role, p.id
FROM public.permissions p
WHERE p.code IN (
  'view_partner_dashboard', 'view_assigned_members', 'view_member_progress',
  'schedule_appointments', 'send_member_messages',
  'view_operational_details', 'create_operational_notes', 'access_lab_interpretations',
  'prescribe_protocols', 'issue_recommendations'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Evaluator permissions
INSERT INTO public.app_role_permissions (role, permission_id)
SELECT 'evaluator'::public.app_role, p.id
FROM public.permissions p
WHERE p.code IN ('evaluate_health_data', 'create_assessments')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 6. Recreate RPC functions with correct GRANT/REVOKE
-- (Include full function definitions from 20251227150000_rbac_app_permissions_admin_rpcs.sql)

-- 7. Comments
COMMENT ON TABLE public.permissions IS 'Canonical permission definitions (source of truth)';
COMMENT ON TABLE public.app_role_permissions IS 'Role to permission mappings';
```

---

## 🧪 Testování oprav

### 1. Test RPC volání

```typescript
// Test v browseru nebo testu
const { data, error } = await supabase.rpc("get_user_permissions");
console.log("Permissions:", data);
console.log("Error:", error);

// Pro admin
const { data: catalog } = await supabase.rpc("get_permissions_catalog_admin");
console.log("Catalog:", catalog);
```

### 2. Test v psql

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres << 'PSQL_EOF'
-- Test jako authenticated user (simulace)
SET request.jwt.claim.sub = 'test-user-id';
SET request.jwt.claims = '{"role": "authenticated"}';

SELECT * FROM public.get_user_permissions();
PSQL_EOF
```

### 3. Test v aplikaci

1. Přihlásit se jako admin → měl by vidět všechny permissions
2. Přihlásit se jako member → měl by vidět pouze member permissions
3. Ověřit `hasPermission("view_admin_dashboard")` vrací správnou hodnotu

---

## 📝 Checklist pro opravu

- [ ] Ověřit existenci tabulek `permissions`, `app_role_permissions`, `user_roles`
- [ ] Ověřit seed data v `permissions` (všechny kódy z frontendu)
- [ ] Ověřit mapování v `app_role_permissions`
- [ ] Ověřit RLS policies na všech tabulkách
- [ ] Ověřit RPC funkce existují a mají správné signatury
- [ ] Ověřit GRANT EXECUTE TO authenticated
- [ ] Ověřit REVOKE ALL FROM PUBLIC
- [ ] Spustit `npm run test:run` - všechny testy prochází
- [ ] Spustit `npm run build` - build úspěšný
- [ ] Test v aplikaci - permissions fungují správně

---

## 🔗 Reference

| Dokument | Účel |
|----------|------|
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | RPC-only pattern, Audit systém |
| [docs/security/RLS_POLICY_DOCUMENTATION.md](../security/RLS_POLICY_DOCUMENTATION.md) | security compliance RLS dokumentace |
| [src/hooks/usePermissions.ts](../../src/hooks/usePermissions.ts) | Frontend permission hook |
| [supabase/migrations/20251227150000_rbac_app_permissions_admin_rpcs.sql](../../supabase/migrations/20251227150000_rbac_app_permissions_admin_rpcs.sql) | RBAC Admin RPCs |

---

*Vytvořeno: 30. prosince 2025*
