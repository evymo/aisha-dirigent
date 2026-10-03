-- Function: is_health_document_owner
-- SECURITY DEFINER helper to break circular RLS dependency between
-- member_health_documents and document_sharing_permissions.
--
-- Used in RLS policies on document_sharing_permissions to check ownership
-- WITHOUT triggering member_health_documents RLS (which would cause infinite recursion).
--
-- Dependencies:
--   - member_health_documents (table)
--   - auth.uid() (Supabase auth)
--
-- Referenced by RLS policies:
--   - document_sharing_permissions: "Users can manage permissions for their documents" (ALL)
--   - document_sharing_permissions: "Users can view their own permissions" (SELECT)

CREATE OR REPLACE FUNCTION public.is_health_document_owner(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM member_health_documents mhd
    WHERE mhd.id = p_document_id
      AND mhd.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_health_document_owner(uuid) IS
  'SECURITY DEFINER helper: checks if auth.uid() owns the given health document. Used in RLS to break circular dependency with document_sharing_permissions.';

REVOKE ALL ON FUNCTION public.is_health_document_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_health_document_owner(uuid) TO authenticated;
