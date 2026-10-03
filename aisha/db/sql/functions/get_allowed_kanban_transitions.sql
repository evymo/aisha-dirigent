-- Function: public.get_allowed_kanban_transitions
-- Description: Returns the legal target statuses from a story's current
--   kanban status. Parallel to get_allowed_transitions (delivery side) but
--   queries workflow_status_transitions instead of delivery_transition_rules.
--   The drag-drop kanban UI calls this on hover/long-press to highlight
--   only valid drop targets.
-- Security: SECURITY DEFINER. Requires the caller to be authenticated.
--   Returns rows visible to any authenticated user (workflow_status_transitions
--   has a permissive read RLS policy).
-- See also: update_story_status_audited (enforces the same rules on writes),
--   get_allowed_transitions (delivery_status equivalent).

CREATE OR REPLACE FUNCTION public.get_allowed_kanban_transitions(
  p_story_id uuid
)
RETURNS TABLE (
  to_status     text,
  requires_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_current_status
  FROM public.partner_stories
  WHERE id = p_story_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT t.to_status, t.requires_role
  FROM public.workflow_status_transitions t
  WHERE t.is_active = true
    AND t.from_status = v_current_status
  ORDER BY t.to_status ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_allowed_kanban_transitions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_allowed_kanban_transitions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_allowed_kanban_transitions(uuid) TO service_role;
