-- Grants: claude_hook_bindings
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql

GRANT SELECT ON public.claude_hook_bindings TO anon;
GRANT SELECT ON public.claude_hook_bindings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.claude_hook_bindings TO service_role;
