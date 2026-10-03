-- Policy: Admins can manage consent templates

DROP POLICY IF EXISTS "Admins can manage consent templates" ON public.consent_templates;
CREATE POLICY "Admins can manage consent templates" ON public.consent_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
