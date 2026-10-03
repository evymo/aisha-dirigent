-- Policy: default deny — čtení jen admin/staff, ne plošně authenticated.
-- Tabulka má ENABLE ROW LEVEL SECURITY a její hlavička deklaruje "RPC-only lockdown —
-- čtení přes SECURITY DEFINER RPC, ne přímo". Bez policy ale RLS zamkla i admin/staff:
-- 5× upsert RPC, 0× read RPC, 0 policies = evidence nateče a nedostane se ven.
-- Vzor 1:1 s obligation_register_admin_select.sql (sesterská evidence primitiva).

DROP POLICY IF EXISTS li_entity_suggestions_admin_select ON public.li_entity_suggestions;
CREATE POLICY li_entity_suggestions_admin_select ON public.li_entity_suggestions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
