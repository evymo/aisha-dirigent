---
name: aisha-rpc
description: Write Postgres RPC functions for the AISHA platform with SECURITY DEFINER + REVOKE/GRANT pattern, audit trail, decision provenance, and proper search_path isolation. Use when creating new RPC functions, modifying existing ones, or auditing RPC security. Triggers on "create RPC", "new function", "SECURITY DEFINER", "RPC security", "audit logging", "decision provenance", "log_integration_action".
---

# AISHA RPC Skill

Vytváření a auditování Postgres RPC funkcí pro AISHA platformu.

## Kdy použít RPC vs. direct query

| Scénář | Použij |
|---|---|
| Read s autorizací (admin/staff/own only) | RPC s SECURITY DEFINER + check |
| Write s audit trail | RPC s INSERT INTO audit_journal |
| Cross-table mutation v jedné transakci | RPC |
| Kompoziční read (joins, aggregates) | RPC |
| Trivial single-row read by ID s RLS | Optionally direct (`postgrest /tablename?id=eq.X`) |
| App layer (React/Vite) | **RPC ALWAYS** — CLAUDE.md zakazuje `.from()` |

## Hlavní vzor

```sql
-- ============================================================================
-- Source of Truth: {function_name}
-- Popis: {co dělá, kdo volá, jaké side-effects}
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: {co loguje}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.{function_name}(
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
  -- 1. Authorization check (FIRST, before any data access)
  v_is_service := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- 2. Input validation
  IF p_arg1 IS NULL THEN
    RAISE EXCEPTION 'arg1 required';
  END IF;

  -- 3. Business logic
  ...

  -- 4. Audit log (for mutating operations)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    '{action_name}',
    jsonb_build_object('key', value)
  );

  -- 5. Return
  RETURN v_var;
END;
$$;

-- 6. Permissions (REVOKE/GRANT pattern is MANDATORY)
REVOKE ALL ON FUNCTION public.{function_name}({arg_types}) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.{function_name}({arg_types}) TO authenticated;
GRANT EXECUTE ON FUNCTION public.{function_name}({arg_types}) TO service_role;
```

## Klíčové bezpečnostní vrstvy

### Vrstva 1: SECURITY DEFINER + SET search_path

`SECURITY DEFINER` znamená "běž s permissions ownera funkce, ne callera". To umožní funkci accessovat tabulky, ke kterým nemá caller direct access.

`SET search_path TO 'public'` je **MANDATORY** — bez něj může útočník manipulovat search_path a podstrčit malicious functions ze schema, které kontroluje (search_path injection attack).

### Vrstva 2: REVOKE ALL FROM PUBLIC + explicit GRANT

Default Postgres má `EXECUTE FROM PUBLIC` na nově vytvořenou funkci. **Vždy** explicitně:

```sql
REVOKE ALL ON FUNCTION public.{name}({sig}) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.{name}({sig}) TO authenticated;
GRANT EXECUTE ON FUNCTION public.{name}({sig}) TO service_role;
-- Optionally: GRANT EXECUTE ON FUNCTION ... TO anon;  -- jen pokud read-only public RPC
```

### Vrstva 3: Authorization check uvnitř funkce

```sql
-- Pattern A: admin or service_role
v_is_service := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
  RAISE EXCEPTION 'Unauthorized';
END IF;

-- Pattern B: admin only (action button targets)
IF NOT public.is_user_admin() THEN
  RAISE EXCEPTION 'Admin role required';
END IF;

-- Pattern C: own data
IF auth.uid() <> p_user_id THEN
  RAISE EXCEPTION 'Cannot read other user data';
END IF;

-- Pattern D: any authenticated (rare, e.g., counts only)
IF auth.role() = 'anon' THEN
  RAISE EXCEPTION 'Authentication required';
END IF;
```

> **Princip**: funkce volaná z service_role (n8n, edge fn) musí umět projít authorizací bez `auth.uid()`. Volání z user JWT (React app) musí mít `auth.uid()`.

### Vrstva 4: Audit logging

Každá mutating RPC zapisuje do `audit_journal`:

```sql
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  auth.uid(),                    -- NULL pro service_role calls
  '{action.subaction}',          -- snake_case, dotted (např. 'drift_resolved')
  jsonb_build_object(
    'entity_id', v_entity_id,
    'before', v_old_value,
    'after', v_new_value,
    -- NIKDY: 'email', 'password', 'secret', plain content
    'metadata_safe_only', '...'
  )
);
```

**Konvence pro `action`**:
- `entity.created` / `entity.updated` / `entity.deleted`
- `drift_resolved`, `slot_lock_acquired`, `blue_green_switch_committed`
- Past tense, snake_case
- Konzistentní napříč codebase

### Vrstva 5: Decision provenance

Pro AI-driven autonomous decisions (Phase 1-3 deploy flow), loguj decision řetězec:

```sql
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  NULL,
  'autonomous_decision',
  jsonb_build_object(
    'decision_provenance', jsonb_build_array(
      jsonb_build_object(
        'source', 'ruleset_snapshot',
        'rule', 'max_auto_remediate_per_hour',
        'value', 5,
        'applied', true
      ),
      jsonb_build_object(
        'source', 'compliance_policy',
        'rule', 'secret_drift_requires_approval',
        'value', true,
        'applied', true
      ),
      jsonb_build_object(
        'source', 'fallback',
        'rule', 'default_risk_unknown',
        'value', 'high',
        'applied', false
      )
    ),
    'final_decision', 'request_approval'
  )
);
```

Hierarchie autorit (od strongest do weakest):
1. `ruleset_snapshot`
2. `core_values`
3. `compliance_policy`
4. `orchestration_policy`
5. `knowledge_retrieval`
6. `model_heuristic`
7. `fallback`

Slabší **nesmí** přepsat silnější bez explicit `override_justification`.

## Read RPCs (STABLE marker)

```sql
CREATE OR REPLACE FUNCTION public.get_xxx(p_limit int DEFAULT 50)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE                          -- ← důležité pro PostgREST query optimizer
AS $$
BEGIN
  ...
END;
$$;
```

`STABLE` říká, že funkce nemá side-effects a vrátí stejný result pro stejné argumenty v rámci jednoho query (umožňuje optimization).

## Mutating RPCs (VOLATILE default)

Žádný explicit volatility marker — Postgres default `VOLATILE` je správně pro mutating funkce.

## Risk evaluation pattern

Pro RPCs, které dělají riskantní akce, integruj `fn_evaluate_proposal_risk`:

```sql
DECLARE
  v_risk text;
BEGIN
  v_risk := public.fn_evaluate_proposal_risk(
    'drift_observer',                   -- agent_slug
    'infrastructure_drift',             -- category
    jsonb_build_object(
      'drift_kind', p_drift_kind,
      'app_role', p_app_role,
      'is_production', p_is_production
    )
  );

  IF v_risk IN ('high', 'critical') THEN
    -- Eskaluj na approval, ne přímá akce
    PERFORM public.mark_drift_pending_approval(p_drift_id, NULL);
    RETURN json_build_object('status', 'approval_required', 'risk', v_risk);
  END IF;

  -- Auto-execute pro low/medium
  ...
END;
```

## Helper RPCs reference

| RPC | Purpose |
|---|---|
| `auth.uid()` | Current user UUID (NULL pro service_role bez JWT user) |
| `auth.role()` | 'authenticated' \| 'anon' \| 'service_role' |
| `public.is_admin_or_staff()` | True pokud user má admin nebo staff role |
| `public.is_user_admin()` | True pouze pro admin (přísnější než is_admin_or_staff) |
| `public.fn_evaluate_proposal_risk()` | Risk evaluation pro autonomous actions |
| `public.log_integration_action()` | Standard audit pro integration calls |

## Type safety s n8n

Pokud RPC bude voláno z n8n (`n8n-nodes-aisha.aishaRpc`), naming convention:

- **Argumenty**: `p_arg_name` (prefix `p_` pro parametry)
- **Variables**: `v_var_name` (prefix `v_` pro lokální vars)
- **Return**: pojmenované TABLE columns nebo single typed return

aishaRpc node používá `RPC.{category}.{function_name}` cestu — kategorizace ovlivňuje který autorizační scope se použije.

## Anti-patterns (NEDĚLAT)

❌ `SECURITY DEFINER` bez `SET search_path TO 'public'` — search_path injection
❌ Skip `REVOKE ALL FROM PUBLIC` — default execute povolen pro všechny
❌ Authorization check po data access — leak možný pokud check selže
❌ `RAISE NOTICE` místo `RAISE EXCEPTION` pro auth failures — obtaže access
❌ Audit log s plain secrets — vytváří compliance issue
❌ `SELECT *` v RPC — fragile při schema změnách
❌ Mutating function bez audit log — neobnovitelný audit trail
❌ Custom auth check místo `is_admin_or_staff()` — drift mezi RPCs
❌ `LANGUAGE sql` pro non-trivial logic — chybí explicit error handling
❌ `INVOKER` security mode — nejde s RLS-enabled tables for cross-table operations

## Validační checklist před commitem

- [ ] `SECURITY DEFINER` přítomen
- [ ] `SET search_path TO 'public'` přítomen
- [ ] `REVOKE ALL ... FROM PUBLIC` přítomen
- [ ] Explicit `GRANT EXECUTE TO {role}` pro každou potřebnou roli
- [ ] Authorization check uvnitř funkce, **před** data access
- [ ] Mutating RPC: audit_journal INSERT
- [ ] Read RPC s side-effect-free logic: `STABLE` marker
- [ ] Input validation (NULL check, format check, range check)
- [ ] Error messages bez leakování dat
- [ ] Functional name match SoT file name
- [ ] SoT file v `aisha/db/sql/functions/{name}.sql`
- [ ] `npm run func:validate` projde

## Reference

- `aisha/db/sql/functions/log_integration_action.sql` — exemplar standard audit RPC
- `aisha/db/sql/functions/fn_evaluate_proposal_risk.sql` — risk eval RPC
- `aisha/db/sql/functions/is_admin_or_staff.sql` — auth helper
- `CLAUDE.md` — Absolute rules
- `src/tests/gates/audited-function-integrity.gate.test.ts` — gate test enforcing audit pattern
