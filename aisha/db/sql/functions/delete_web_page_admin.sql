-- Function: public.delete_web_page_admin
-- Description: Soft-deletes a web page (sets is_active = false). Requires admin role.
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-04-11

CREATE OR REPLACE FUNCTION public.delete_web_page_admin(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE web_pages SET
    is_active = false,
    updated_at = now()
  WHERE web_pages.id = p_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'delete'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_id::text,
    p_entity_type := 'web_page',
    p_new_values := jsonb_build_object('id', p_id),
    p_old_values := NULL,
    p_severity := 'warning'::public.journal_severity,
    p_summary := 'Soft-deleted web page',
    p_tags := ARRAY['admin', 'content', 'web_page', 'delete'],
    p_user_id := auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_web_page_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_web_page_admin(uuid) TO authenticated;
