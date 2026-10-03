-- Storage bucket: e2e-reports
-- HTML report + results.json + traces for each Playwright run.
-- Private (admin/staff + service_role read).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'e2e-reports',
  'e2e-reports',
  false,
  104857600, -- 100 MB per file (HTML reports + videos can be sizeable)
  ARRAY[
    'text/html', 'application/json', 'text/plain',
    'image/png', 'image/jpeg', 'image/webp',
    'video/webm', 'video/mp4',
    'application/zip'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin and staff can read e2e reports" ON storage.objects;
CREATE POLICY "Admin and staff can read e2e reports"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'e2e-reports' AND (SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Service role can manage e2e reports" ON storage.objects;
CREATE POLICY "Service role can manage e2e reports"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'e2e-reports')
WITH CHECK (bucket_id = 'e2e-reports');
