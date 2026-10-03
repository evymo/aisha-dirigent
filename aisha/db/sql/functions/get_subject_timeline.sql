-- Function: public.get_subject_timeline
-- Arguments: p_subject_type text, p_subject_id uuid, p_entry_types text[], p_limit integer
-- Description: Reads the typed records of ONE subject's timeline off the
--              polymorphic axis — the counterpart to append_subject_entry_service.
--              Without it the actor axis would be write-only: story_timeline
--              reads by story_id, and the permissive discussion-read policy
--              deliberately covers only public content kinds.
-- Security: SECURITY DEFINER. Operators see any subject; a member sees only
--           their own actor axis, and never internal (operator-written) records.

CREATE OR REPLACE FUNCTION public.get_subject_timeline(
  p_subject_type text,
  p_subject_id uuid,
  p_entry_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  entry_type text,
  content text,
  metadata jsonb,
  is_internal boolean,
  created_by uuid,
  occurred_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_operator boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type IS NULL OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'subject_type and subject_id are required' USING ERRCODE = '22023';
  END IF;

  v_is_operator := public.is_admin_or_staff();

  IF NOT v_is_operator THEN
    -- Self-read only, and only on the axis whose subject_id IS a user id.
    IF NOT (p_subject_type = 'actor' AND p_subject_id = v_caller_id) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT se.id, se.entry_type, se.content, se.metadata, se.is_internal,
         se.created_by, se.occurred_at, se.created_at
  FROM public.story_entries se
  WHERE se.subject_type = p_subject_type
    AND se.subject_id = p_subject_id
    AND se.status = 'visible'
    AND (v_is_operator OR se.is_internal = false)
    AND (p_entry_types IS NULL OR se.entry_type = ANY (p_entry_types))
  ORDER BY COALESCE(se.occurred_at, se.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_subject_timeline(text, uuid, text[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_subject_timeline(text, uuid, text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_subject_timeline(text, uuid, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subject_timeline(text, uuid, text[], integer) TO service_role;
