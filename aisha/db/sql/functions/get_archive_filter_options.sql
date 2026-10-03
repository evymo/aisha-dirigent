-- Function: public.get_archive_filter_options
-- Arguments: (none)
-- Description: Returns filter options for public archive. Public archive access.
-- Security: SECURITY DEFINER - public archive filter options.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_archive_filter_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_has_member_access boolean := false;
BEGIN
  IF auth.role() = 'authenticated' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.consents c
      WHERE c.user_id = auth.uid()
        AND c.consent_type = 'data_processing'::public.consent_type
        AND c.granted = true
        AND c.revoked_at IS NULL
    ) INTO v_has_member_access;
  END IF;

  SELECT jsonb_build_object(
    'decades', COALESCE((
      SELECT jsonb_agg(DISTINCT decade ORDER BY decade)
      FROM archive_documents
      WHERE decade IS NOT NULL
        AND (COALESCE(is_public, false) OR v_has_member_access)
    ), '[]'::jsonb),
    'document_types', COALESCE((
      SELECT jsonb_agg(DISTINCT document_type ORDER BY document_type)
      FROM archive_documents
      WHERE document_type IS NOT NULL
        AND (COALESCE(is_public, false) OR v_has_member_access)
    ), '[]'::jsonb),
    'preparations', COALESCE((
      SELECT jsonb_agg(DISTINCT preparation ORDER BY preparation)
      FROM archive_documents
      WHERE preparation IS NOT NULL
        AND (COALESCE(is_public, false) OR v_has_member_access)
    ), '[]'::jsonb),
    'places', COALESCE((
      SELECT jsonb_agg(DISTINCT place ORDER BY place)
      FROM archive_documents
      WHERE place IS NOT NULL
        AND (COALESCE(is_public, false) OR v_has_member_access)
    ), '[]'::jsonb),
    'keywords', COALESCE((
      SELECT jsonb_agg(DISTINCT kw ORDER BY kw)
      FROM archive_documents ad, LATERAL unnest(ad.keywords) AS kw
      WHERE (COALESCE(ad.is_public, false) OR v_has_member_access)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions (PUBLIC: filtry archivu jsou veřejné)
REVOKE ALL ON FUNCTION public.get_archive_filter_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_filter_options() TO public;
GRANT EXECUTE ON FUNCTION public.get_archive_filter_options() TO authenticated;
