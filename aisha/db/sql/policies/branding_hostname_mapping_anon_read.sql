-- Policy: branding_hostname_mapping_anon_read
-- Table: branding_hostname_mapping
--
-- The table is public-by-design — get_branding_for_hostname() is called
-- by anon clients before any login can occur. RLS is enabled to keep the
-- audit story uniform across the platform; the permissive SELECT policy
-- below is the explicit, reviewable equivalent of "anon SELECT GRANT".

CREATE POLICY branding_hostname_mapping_anon_read
  ON public.branding_hostname_mapping
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
