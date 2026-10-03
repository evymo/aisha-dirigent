-- Function: has_document_sharing_access
-- SECURITY DEFINER helper to break circular RLS dependency between
-- member_health_documents and document_sharing_permissions.
--
-- Checks if the current authenticated user has sharing access to a health document
-- as a partner (directly shared) or as a study consultant.
--
-- Used in RLS policies on member_health_documents and storage.objects to check
-- sharing permissions WITHOUT triggering document_sharing_permissions RLS
-- (which references member_health_documents → infinite recursion).
--
-- Dependencies:
--   - document_sharing_permissions (table)
--   - partner_profiles (table)
--   - is_study_consultant() (function)
--   - auth.uid() (Supabase auth)
--
-- Referenced by RLS policies:
--   - member_health_documents: "Partners can view shared documents" (SELECT)
--   - storage.objects: "Partners can view shared health documents" (SELECT)

CREATE OR REPLACE FUNCTION public.has_document_sharing_access(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM document_sharing_permissions dsp
    WHERE dsp.document_id = p_document_id
      AND dsp.revoked_at IS NULL
      AND dsp.can_view = true
      AND (
        EXISTS (
          SELECT 1
          FROM partner_profiles pp
          WHERE pp.id = dsp.shared_with_partner_id
            AND pp.user_id = auth.uid()
        )
        OR (
          dsp.shared_with_study_id IS NOT NULL
          AND is_study_consultant(dsp.shared_with_study_id)
        )
      )
  );
$$;

COMMENT ON FUNCTION public.has_document_sharing_access(uuid) IS
  'SECURITY DEFINER helper: checks if auth.uid() (as partner/consultant) has sharing access to a health document. Used in RLS to break circular dependency with member_health_documents.';

REVOKE ALL ON FUNCTION public.has_document_sharing_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_document_sharing_access(uuid) TO authenticated;
