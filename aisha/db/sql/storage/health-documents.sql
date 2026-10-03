-- Storage bucket: health-documents
-- Description: Private storage for member health documents (sensitive data)
-- Public: NO (user can only access their own documents)

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-documents',
  'health-documents',
  false,
  52428800, -- 50MB limit
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload their own health documents
-- Storage path format: {user_id}/filename
DROP POLICY IF EXISTS "Users can upload their own health documents" ON storage.objects;
CREATE POLICY "Users can upload their own health documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'health-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own health documents
DROP POLICY IF EXISTS "Users can view their own health documents" ON storage.objects;
CREATE POLICY "Users can view their own health documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'health-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own health documents
DROP POLICY IF EXISTS "Users can update their own health documents" ON storage.objects;
CREATE POLICY "Users can update their own health documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'health-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own health documents
DROP POLICY IF EXISTS "Users can delete their own health documents" ON storage.objects;
CREATE POLICY "Users can delete their own health documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'health-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admin/staff can view all health documents (for support)
DROP POLICY IF EXISTS "Admins can view all health documents" ON storage.objects;
CREATE POLICY "Admins can view all health documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'health-documents'
  AND (SELECT public.is_admin_or_staff())
);

-- Partners can view health documents explicitly shared with them (requires active data sharing consent)
DROP POLICY IF EXISTS "Partners can view shared health documents" ON storage.objects;
CREATE POLICY "Partners can view shared health documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'health-documents'
  AND EXISTS (
    SELECT 1
    FROM public.member_health_documents mhd
    JOIN public.document_sharing_permissions dsp
      ON dsp.document_id = mhd.id
      AND dsp.revoked_at IS NULL
      AND dsp.can_view = true
    JOIN public.partner_profiles pp
      ON pp.user_id = auth.uid()
    LEFT JOIN public.study_consultants sc
      ON sc.study_id = dsp.shared_with_study_id
      AND sc.partner_id = pp.id
      AND sc.status = 'approved'
    JOIN public.data_sharing_consents dsc
      ON dsc.user_id = mhd.user_id
      AND dsc.partner_id = pp.id
      AND dsc.revoked_at IS NULL
      AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
    WHERE mhd.file_path = storage.objects.name
      AND (
        dsp.shared_with_partner_id = pp.id
        OR sc.partner_id IS NOT NULL
      )
  )
);
