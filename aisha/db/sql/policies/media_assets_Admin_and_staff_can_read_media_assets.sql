-- Policy: Admin and staff can read media assets ON public.media_assets
-- Zápis: jen storage-auth pod service_role (record_media_asset); čtení admin/staff.

DROP POLICY IF EXISTS "Admin and staff can read media assets" ON public.media_assets;
CREATE POLICY "Admin and staff can read media assets" ON public.media_assets
  AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
