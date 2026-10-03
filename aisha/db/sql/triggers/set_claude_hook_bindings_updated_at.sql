-- Trigger: set_claude_hook_bindings_updated_at_trg
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql
-- Purpose: maintain updated_at = now() on every UPDATE — required by
--          production-build.gate.test.ts which enforces that any table with
--          an updated_at column has a matching trigger.

CREATE OR REPLACE FUNCTION public.set_claude_hook_bindings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_claude_hook_bindings_updated_at_trg
  ON public.claude_hook_bindings;
CREATE TRIGGER set_claude_hook_bindings_updated_at_trg
  BEFORE UPDATE ON public.claude_hook_bindings
  FOR EACH ROW EXECUTE FUNCTION public.set_claude_hook_bindings_updated_at();
