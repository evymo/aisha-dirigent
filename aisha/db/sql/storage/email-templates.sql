-- Storage bucket: email-templates
-- Description: Shared email assets bucket — email HTML snippets, logos, inline images
--              that are referenced by emails sent by the platform.
-- Created: 2026-01-24, reworked for Keycloak: 2026-04-26
--
-- Architecture (post-Supabase rework):
--   - Keycloak auth emails use FreeMarker themes from keycloak/themes/aisha/email/*.ftl
--     (verification, password reset, identity-provider-link, executeActions, event).
--   - This bucket holds NON-Keycloak shared email assets (logos, illustration, fragments)
--     consumed by:
--       * the auth-send-email edge function (push/email composer)
--       * service-side notification campaign sender
--       * Keycloak's resource URLs may also reference public assets here
--   - Bucket is also created at MinIO bootstrap (docker-compose.coolify.yml) — this DB
--     entry mirrors that so storage RLS policies apply consistently.

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-templates',
  'email-templates',
  true,  -- Public — assets are served via signed-URL-free GET (logos, fragments)
  102400,  -- 100KB max (HTML fragments, small inline assets)
  ARRAY['text/html', 'text/plain', 'image/png', 'image/jpeg', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read access — anon role needed for outbound emails referencing public assets
DROP POLICY IF EXISTS "Email templates are publicly accessible" ON storage.objects;
CREATE POLICY "Email templates are publicly accessible"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'email-templates');

-- Admin/staff upload access
DROP POLICY IF EXISTS "Admin and staff can upload email templates" ON storage.objects;
CREATE POLICY "Admin and staff can upload email templates"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'email-templates'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff update access
DROP POLICY IF EXISTS "Admin and staff can update email templates" ON storage.objects;
CREATE POLICY "Admin and staff can update email templates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'email-templates'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff delete access
DROP POLICY IF EXISTS "Admin and staff can delete email templates" ON storage.objects;
CREATE POLICY "Admin and staff can delete email templates"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'email-templates'
  AND (SELECT public.is_admin_or_staff())
);
