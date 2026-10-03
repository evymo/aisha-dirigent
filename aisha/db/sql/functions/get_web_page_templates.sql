-- Function: public.get_web_page_templates
-- Description: Lists active page templates (newest first).
-- Security: SECURITY INVOKER, authenticated only
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.get_web_page_templates()
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  thumbnail_url text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT t.id, t.name, t.description, t.thumbnail_url, t.created_at
  FROM public.web_page_templates t
  WHERE t.is_active = true
  ORDER BY t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_web_page_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_page_templates() TO authenticated;
