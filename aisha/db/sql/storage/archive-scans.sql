-- Storage bucket: archive-scans
-- Description: Storage for scanned archive documents
-- Public: YES for read access (download control is in application layer)
-- 
-- Access logic (enforced in application layer via DocumentViewer):
-- - is_public=true: everyone can VIEW preview
-- - is_public=false: only authenticated users can VIEW preview (detail page accessible, but no viewer)
-- - is_download_public=true + authenticated: download button shown
-- - is_download_public=false + authenticated: download button hidden for non-authors
--
-- Note: For stricter download control, use Edge Function with signed URLs in future

-- Create the bucket (PUBLIC for read, protected for write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'archive-scans',
  'archive-scans',
  true,  -- PUBLIC bucket for read access
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access (bucket is public)
DROP POLICY IF EXISTS "Archive scans are publicly viewable" ON storage.objects;
CREATE POLICY "Archive scans are publicly viewable"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'archive-scans');

-- Admin/staff upload access
DROP POLICY IF EXISTS "Admins can upload archive scans" ON storage.objects;
CREATE POLICY "Admins can upload archive scans"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'archive-scans'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff update access
DROP POLICY IF EXISTS "Admins can update archive scans" ON storage.objects;
CREATE POLICY "Admins can update archive scans"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'archive-scans'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff delete access
DROP POLICY IF EXISTS "Admins can delete archive scans" ON storage.objects;
CREATE POLICY "Admins can delete archive scans"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'archive-scans'
  AND (SELECT public.is_admin_or_staff())
);
