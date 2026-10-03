-- Policy: Admins can manage consent template versions

DROP POLICY IF EXISTS "Admins can manage consent template versions" ON public.consent_template_versions;
CREATE POLICY "Admins can manage consent template versions" ON public.consent_template_versions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
