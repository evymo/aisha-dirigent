-- Function: public.get_story_rulesets
-- Description: Returns ruleset bindings for a story, joined with their
--   expert_rules metadata. Each row represents one ruleset assignment
--   (one row of story_rulesets) with a JSON-aggregated array of the
--   contained rules — slug, title, category, pinned version + current
--   version of each rule.
-- Security: SECURITY DEFINER. Requires participant or admin/staff access
--   to the story; the underlying partner_stories table's RLS is the
--   authority — this RPC just exposes a join-friendly shape.
-- See also: story_rulesets (table), expert_rules + expert_rule_versions,
--   update_story_rulesets_audited (mutation, future Phase 1 follow-up).

CREATE OR REPLACE FUNCTION public.get_story_rulesets(
  p_story_id uuid
)
RETURNS TABLE (
  ruleset_id          uuid,
  ruleset_fingerprint text,
  context_profile     text,
  created_at          timestamptz,
  created_by          text,
  rule_count          int,
  rules               jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_can_view boolean;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Visibility: admin/staff OR a story participant.
  SELECT public.is_admin_or_staff()
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = p_story_id
          AND sp.user_id  = auth.uid()
      )
    INTO v_can_view;

  IF NOT v_can_view THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT sr.id                AS ruleset_id,
         sr.ruleset_fingerprint,
         sr.context_profile,
         sr.created_at,
         sr.created_by,
         COALESCE(array_length(sr.rule_ids, 1), 0) AS rule_count,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'rule_id',         er.id,
                 'slug',            er.slug,
                 'title',           er.title,
                 'summary',         er.summary,
                 'category',        er.category::text,
                 'status',          er.status::text,
                 'current_version', er.version,
                 'used_version',    NULLIF(
                   sr.rule_versions ->> er.id::text,
                   ''
                 )::int,
                 'is_default',      er.is_default
               )
               ORDER BY er.title ASC
             )
             FROM public.expert_rules er
             WHERE er.id = ANY (sr.rule_ids)
               AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
           ),
           '[]'::jsonb
         ) AS rules
  FROM public.story_rulesets sr
  WHERE sr.story_id = p_story_id
  ORDER BY sr.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_story_rulesets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_rulesets(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_rulesets(uuid) TO service_role;
