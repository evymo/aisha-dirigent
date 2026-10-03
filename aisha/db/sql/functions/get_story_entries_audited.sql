-- Function: public.get_story_entries_audited
-- Arguments: p_story_id uuid, p_limit integer, p_offset integer
-- Purpose: RPC-only story entry listing with access control and audit logging.
-- Security: SECURITY DEFINER, authenticated only.

CREATE OR REPLACE FUNCTION public.get_story_entries_audited(
  p_story_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(id uuid, story_id uuid, parent_id uuid, entry_type text, content text, metadata jsonb, is_internal boolean, is_pinned boolean, created_by uuid, created_at timestamp with time zone, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'PGRST';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_stories ps
    WHERE ps.id = p_story_id
      AND (
        ps.user_id = v_user_id
        -- The caller's partner owns the story. (Was a subquery over a stale `public.partners`
        -- table left over from the partner→partner_profiles rebrand — the canonical resolver is
        -- get_current_partner_id(); a real-DB integration run surfaced the broken reference.)
        OR ps.partner_id = public.get_current_partner_id()
        OR EXISTS (
          SELECT 1
          FROM public.story_participants sp
          WHERE sp.story_id = ps.id
            AND sp.user_id = v_user_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'PGRST';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'get_story_entries_audited',
    jsonb_build_object('story_id', p_story_id, 'limit', p_limit, 'offset', p_offset)
  );

  RETURN QUERY
    SELECT
      se.id,
      se.story_id,
      se.parent_id,
      se.entry_type,
      se.content,
      se.metadata,
      se.is_internal,
      se.is_pinned,
      se.created_by,
      se.created_at,
      se.occurred_at
    FROM public.story_entries se
    WHERE se.story_id = p_story_id
    ORDER BY se.created_at ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_entries_audited(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_story_entries_audited(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_story_entries_audited(uuid, integer, integer) TO authenticated;
