-- Policy: web_tracking_registry_authenticated_read ON public.web_tracking_registry
-- Mirrors ai_provider_registry §19.4 scoping. The public web surface reads through
-- get_active_web_tracking() (SECURITY DEFINER, enabled+consent-shaped), never by
-- direct table read.

CREATE POLICY "web_tracking_registry_authenticated_read" ON public.web_tracking_registry AS PERMISSIVE FOR SELECT TO public USING (
  (auth.role() = 'service_role'::text)
  OR (
    (auth.uid() IS NOT NULL)
    AND (
      (scoped_to_instance_id IS NULL)
      OR (scoped_to_instance_id = NULLIF(current_setting('aisha.instance_id'::text, true), ''::text)::uuid)
    )
  )
);
