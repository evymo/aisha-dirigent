-- Policy: aisha_static_defense_rules_admin_all
-- Table: aisha_static_defense_rules
-- Admin + staff get full CRUD on rule rows. service_role bypasses RLS so the
-- generator scripts and Aisha autonomous loop don't need a JWT. Everyone
-- else is denied — non-admin authenticated users cannot read or mutate.

DROP POLICY IF EXISTS aisha_static_defense_rules_admin_all
  ON public.aisha_static_defense_rules;

CREATE POLICY aisha_static_defense_rules_admin_all
  ON public.aisha_static_defense_rules
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
