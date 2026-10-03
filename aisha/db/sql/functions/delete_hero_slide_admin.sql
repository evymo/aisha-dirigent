-- Function: public.delete_hero_slide_admin
-- Arguments: p_id uuid
-- Description: Deletes a hero slide. Requires admin role.
-- Security: SECURITY DEFINER with search_path set.
-- Extracted: 2026-01-09

DROP FUNCTION IF EXISTS public.delete_hero_slide_admin(uuid);

CREATE OR REPLACE FUNCTION public.delete_hero_slide_admin(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  -- Check admin or staff role (staff can manage content)
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM hero_slides WHERE id = p_id;
  
  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'hero_slide',
      p_new_values := jsonb_build_object('id', p_id),
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Deleted hero slide',
      p_tags := ARRAY['admin', 'hero_slide', 'delete'],
      p_user_id := auth.uid()
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_hero_slide_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_hero_slide_admin(uuid) TO authenticated;
