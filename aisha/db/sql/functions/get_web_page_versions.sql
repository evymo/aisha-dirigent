-- Function: public.get_web_page_versions
-- Description: Lists version snapshots for a given page (max 50, newest first).
-- Security: SECURITY INVOKER, authenticated only
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.get_web_page_versions(p_page_id uuid)
RETURNS TABLE (
  id uuid,
  version_number integer,
  label text,
  created_by uuid,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT v.id, v.version_number, v.label, v.created_by, v.created_at
  FROM public.web_page_versions v
  WHERE v.page_id = p_page_id
    AND v.kind <> 'draft'  -- koncept není verze (2026-10-02)
  ORDER BY v.version_number DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_web_page_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_page_versions(uuid) TO authenticated;
