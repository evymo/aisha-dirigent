-- Policy: Admins can manage label templates

DROP POLICY IF EXISTS "Admins can manage label templates" ON public.product_label_templates;
CREATE POLICY "Admins can manage label templates" ON public.product_label_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
