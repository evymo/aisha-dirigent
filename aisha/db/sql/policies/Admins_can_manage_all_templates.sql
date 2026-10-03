-- Policy: Admins can manage all templates

DROP POLICY IF EXISTS "Admins can manage all templates" ON public.partner_templates;
CREATE POLICY "Admins can manage all templates" ON public.partner_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
