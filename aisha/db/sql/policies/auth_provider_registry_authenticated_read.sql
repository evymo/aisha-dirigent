-- Policy: auth_provider_registry_authenticated_read ON public.auth_provider_registry
-- Mirrors ai_provider_registry §19.4 scoping: base/global rows (scoped_to_instance_id
-- IS NULL) are visible to any authenticated user; instance-scoped rows only within
-- their own instance. service_role sees all. Login-surface enumeration for anonymous
-- visitors goes through get_enabled_auth_providers() (SECURITY DEFINER, filtered),
-- never by direct table read.

CREATE POLICY "auth_provider_registry_authenticated_read" ON public.auth_provider_registry AS PERMISSIVE FOR SELECT TO public USING (
  (auth.role() = 'service_role'::text)
  OR (
    (auth.uid() IS NOT NULL)
    AND (
      (scoped_to_instance_id IS NULL)
      OR (scoped_to_instance_id = NULLIF(current_setting('aisha.instance_id'::text, true), ''::text)::uuid)
    )
  )
);
