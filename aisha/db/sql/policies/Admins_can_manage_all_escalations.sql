-- Policy: Admins can manage all escalations

DROP POLICY IF EXISTS "Admins can manage all escalations" ON public.message_escalations;
CREATE POLICY "Admins can manage all escalations" ON public.message_escalations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
