# RPC Function Security Guide

**Verze:** 1.0 | **Datum:** 12. ledna 2026

---

## 🚨 TL;DR - Kritické pravidlo

> **Každá funkce s `GRANT TO anon` MUSÍ mít `SECURITY DEFINER`**

Bez toho funkce selhává s **403 Forbidden** i když má správný GRANT.

---

## 📋 Obsah

1. [Problém](#1-problém)
2. [Příčina](#2-příčina)
3. [Řešení](#3-řešení)
4. [Design Patterns](#4-design-patterns)
5. [Debugging Guide](#5-debugging-guide)
6. [Automatické Testy](#6-automatické-testy)
7. [Checklist](#7-checklist)

---

## 1. Problém

### Symptomy

```
403 Forbidden - get_supported_languages
403 Forbidden - get_public_products
400 Bad Request - get_user_permissions (pro anon)
```

### Kdy nastává

- Funkce má `GRANT EXECUTE TO anon`
- Funkce čte z tabulek (SELECT)
- Uživatel není přihlášen (anon role)

---

## 2. Příčina

### Supabase Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Schema USAGE    │ GRANT USAGE ON SCHEMA public TO role  │
│ 2. Table SELECT    │ GRANT SELECT ON table TO role         │
│ 3. RLS Policies    │ CREATE POLICY ... USING (condition)   │
│ 4. Function EXECUTE│ GRANT EXECUTE ON FUNCTION ... TO role │
└─────────────────────────────────────────────────────────────┘
```

### Problém s `anon` rolí

```sql
-- anon role má:
✅ GRANT USAGE ON SCHEMA public     -- může vidět schéma
✅ GRANT EXECUTE ON FUNCTION ...    -- může volat funkce
❌ GRANT SELECT ON table            -- NEMÁ přímý přístup k tabulkám!
```

### Proč funkce selhává

```sql
-- ŠPATNĚ: Funkce běží jako anon (SECURITY INVOKER = default)
CREATE OR REPLACE FUNCTION get_public_products()
RETURNS TABLE (...) 
LANGUAGE plpgsql
AS $$
BEGIN
  -- anon nemá SELECT na products → 403 Forbidden!
  RETURN QUERY SELECT * FROM products WHERE is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_products() TO anon;
```

---

## 3. Řešení

### SECURITY DEFINER Pattern

```sql
-- SPRÁVNĚ: Funkce běží jako owner (postgres)
CREATE OR REPLACE FUNCTION get_public_products()
RETURNS TABLE (...) 
LANGUAGE plpgsql
SECURITY DEFINER              -- ← Běží jako vlastník (postgres)
SET search_path TO 'public'   -- ← Security best practice
AS $$
BEGIN
  -- postgres má SELECT → funguje!
  RETURN QUERY SELECT * FROM products WHERE is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_products() TO anon;
```

### Vysvětlení

| Klauzule | Význam |
|----------|--------|
| `SECURITY DEFINER` | Funkce běží s právy vlastníka (postgres), ne volajícího |
| `SET search_path TO 'public'` | Prevence search_path injection útoku |

---

## 4. Design Patterns

### Pattern A: Veřejná funkce (anon + authenticated)

```sql
CREATE OR REPLACE FUNCTION public.get_public_data()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT id, name, description
  FROM public.items
  WHERE is_public = true;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_public_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_data() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_data() TO authenticated;
```

### Pattern B: Authenticated-only funkce

```sql
CREATE OR REPLACE FUNCTION public.get_my_data()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Guard: vyžaduje přihlášení
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT id, content
  FROM public.user_data
  WHERE user_id = auth.uid();
END;
$$;

-- Permissions - POUZE authenticated
REVOKE ALL ON FUNCTION public.get_my_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_data() TO authenticated;
```

### Pattern C: Funkce s guardem pro anon

```sql
-- Pokud chceme že funkci může volat i anon, ale vrátí prázdno
CREATE OR REPLACE FUNCTION public.get_user_permissions()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Guard: pro anon vrať prázdno (ne error)
  IF auth.uid() IS NULL THEN
    RETURN;  -- prázdný result set
  END IF;

  RETURN QUERY
  SELECT permission_code
  FROM public.user_permissions
  WHERE user_id = auth.uid();
END;
$$;

-- anon může volat, ale dostane prázdno
GRANT EXECUTE ON FUNCTION public.get_user_permissions() TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_permissions() TO authenticated;
```

### Pattern D: sensitive data funkce s auditem

```sql
CREATE OR REPLACE FUNCTION public.get_my_health_data_audited(
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1. Guard
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Audit log (bez sensitive data dat!)
  INSERT INTO public.audit_journal (user_id, action, target_type, details)
  VALUES (
    auth.uid(),
    'sensitive-data_READ',
    'health_data',
    jsonb_build_object('limit', p_limit)  -- jen metadata
  );

  -- 3. Return data
  RETURN QUERY
  SELECT id, check_in_date, pain_level
  FROM public.health_check_ins
  WHERE user_id = auth.uid()
  ORDER BY check_in_date DESC
  LIMIT p_limit;
END;
$$;

-- POUZE authenticated (sensitive-data nikdy pro anon)
REVOKE ALL ON FUNCTION public.get_my_health_data_audited(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_health_data_audited(INTEGER) TO authenticated;
```

---

## 5. Debugging Guide

### Krok 1: Identifikace problému

```bash
# Najdi funkce s TO anon ale bez SECURITY DEFINER
cd supabase/sql/functions
for f in *.sql; do
  if grep -q "TO anon" "$f" && ! grep -q "SECURITY DEFINER" "$f"; then
    echo "⚠️ $f"
  fi
done
```

### Krok 2: Ověření v DB

```sql
-- Podívej se na function security
SELECT 
  p.proname AS function_name,
  CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
  p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE 'get_%'
ORDER BY p.proname;
```

### Krok 3: Test jako anon

```sql
-- Přepni na anon roli a testuj
SET ROLE anon;

-- Tohle by mělo fungovat
SELECT * FROM public.get_public_products();

-- Vrať se na postgres
RESET ROLE;
```

### Krok 4: Oprava

```sql
-- Přegeneruj funkci s SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.problematic_function()
...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
...
$$;
```

---

## 6. Automatické Testy

### Unit Test

Soubor `src/tests/security/rpc-function-security.test.ts` automaticky kontroluje:

```typescript
// Test 1: Anon funkce musí mít SECURITY DEFINER
it("all functions with GRANT TO anon MUST have SECURITY DEFINER")

// Test 2: SECURITY DEFINER musí mít search_path
it("functions with SECURITY DEFINER MUST have SET search_path")

// Test 3: Inventář anon funkcí
it("lists all anon-accessible functions for review")
```

### Spuštění

```bash
# Spusť security testy
npm run test:run src/tests/security/rpc-function-security.test.ts

# Nebo všechny testy
npm run test:run
```

### CI/CD Integration

Testy se automaticky spouští v CI pipeline a **blokují merge** pokud najdou:
- Funkci s `TO anon` bez `SECURITY DEFINER`
- Funkci s `SECURITY DEFINER` bez `SET search_path`

---

## 7. Checklist

### Pro novou veřejnou funkci

- [ ] Má `SECURITY DEFINER`
- [ ] Má `SET search_path TO 'public'`
- [ ] Má `REVOKE ALL ... FROM PUBLIC`
- [ ] Má `GRANT EXECUTE ... TO anon`
- [ ] Má `GRANT EXECUTE ... TO authenticated`
- [ ] Má `COMMENT ON FUNCTION`

### Pro novou authenticated-only funkci

- [ ] Má `SECURITY DEFINER`
- [ ] Má `SET search_path TO 'public'`
- [ ] Má guard `IF auth.uid() IS NULL THEN RAISE EXCEPTION`
- [ ] Má `REVOKE ALL ... FROM PUBLIC`
- [ ] Má `GRANT EXECUTE ... TO authenticated` (NE anon!)

### Pro novou sensitive data funkci

- [ ] Název končí `_audited`
- [ ] Má `SECURITY DEFINER`
- [ ] Má `SET search_path TO 'public'`
- [ ] Má guard pro auth
- [ ] Má `INSERT INTO audit_journal`
- [ ] Audit NEOBSAHUJE sensitive data
- [ ] Má `GRANT EXECUTE ... TO authenticated` (NIKDY anon!)

---

## 📚 Reference

- [Supabase RPC Security](https://supabase.com/docs/guides/database/functions)
- [PostgreSQL Security Definer](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) - RPC-only pattern
- [docs/security/RLS_POLICY_DOCUMENTATION.md](RLS_POLICY_DOCUMENTATION.md) - RLS policies

---

*Dokument vytvořen: 12. ledna 2026*
