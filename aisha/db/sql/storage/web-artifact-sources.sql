-- Storage bucket: web-artifact-sources
-- Raw uploads (zip / tar.gz / standalone HTML) prior to processing.
-- Admin/staff write, story participants + service_role read, anon DENIED.
-- 50 MB cap (vs page-assets 5 MB — sources are intentionally larger).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'web-artifact-sources',
  'web-artifact-sources',
  false,
  52428800,
  ARRAY[
    'application/zip',
    'application/x-tar',
    'application/gzip',
    'text/html',
    'text/css',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin and staff can read web artifact sources" ON storage.objects;
CREATE POLICY "Admin and staff can read web artifact sources"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'web-artifact-sources' AND (SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Admin and staff can upload web artifact sources" ON storage.objects;
CREATE POLICY "Admin and staff can upload web artifact sources"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'web-artifact-sources' AND (SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Admin and staff can update web artifact sources" ON storage.objects;
CREATE POLICY "Admin and staff can update web artifact sources"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'web-artifact-sources' AND (SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Admin and staff can delete web artifact sources" ON storage.objects;
CREATE POLICY "Admin and staff can delete web artifact sources"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'web-artifact-sources' AND (SELECT public.is_admin_or_staff()));
