-- Source of Truth: get_chat_context_story_id
-- Purpose: Resolve the most relevant story context for AI chat composition.
--          Prioritizes caller-owned active stories with story_contexts/rulesets.
-- Used by: ai-chat edge function

CREATE OR REPLACE FUNCTION public.get_chat_context_story_id(
  p_story_id uuid DEFAULT NULL::uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_story_id uuid;
BEGIN
  -- §19.1: an explicit story_id resolves ONLY when owned by the caller.
  IF p_story_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM partner_stories ps WHERE ps.id = p_story_id AND ps.user_id = p_user_id) THEN
      RETURN p_story_id;
    END IF;
    -- Non-owned explicit id is a hard tenancy error — fail closed, never resolve
    -- a foreign story and never silently substitute the caller's own.
    RETURN NULL;
  END IF;

  -- Prefer active stories owned by the caller and already context-ready.
  SELECT ps.id INTO v_story_id
  FROM partner_stories ps
  LEFT JOIN story_contexts sc ON sc.story_id = ps.id
  WHERE ps.user_id = p_user_id
    AND ps.status = 'active'
  ORDER BY
    CASE WHEN sc.story_id IS NOT NULL THEN 0 ELSE 1 END,
    ps.updated_at DESC NULLS LAST,
    ps.created_at DESC
  LIMIT 1;

  -- §19.1: NO arbitrary-active fallback. Returning another tenant's story would
  -- poison story-scope/RLS/chargeback. NULL ⇒ caller fail-closes (story-required).
  RETURN v_story_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_chat_context_story_id(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_context_story_id(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_context_story_id(uuid, uuid) TO service_role;
