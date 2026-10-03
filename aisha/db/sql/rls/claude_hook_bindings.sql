-- RLS: claude_hook_bindings
-- Source: hand-authored; deploy via migration 20260524000000_claude_hook_bindings.sql
--
-- Read model: anon + authenticated may SELECT all active bindings (they describe
-- public coding policy, not user-specific data; same access pattern as
-- expert_rules with status=published). service_role full access for n8n /
-- bootstrap seed updates.

ALTER TABLE public.claude_hook_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access_claude_hook_bindings ON public.claude_hook_bindings;
CREATE POLICY service_role_full_access_claude_hook_bindings
  ON public.claude_hook_bindings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS anon_read_active_claude_hook_bindings ON public.claude_hook_bindings;
CREATE POLICY anon_read_active_claude_hook_bindings
  ON public.claude_hook_bindings
  FOR SELECT
  TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS auth_read_active_claude_hook_bindings ON public.claude_hook_bindings;
CREATE POLICY auth_read_active_claude_hook_bindings
  ON public.claude_hook_bindings
  FOR SELECT
  TO authenticated
  USING (is_active = true);
