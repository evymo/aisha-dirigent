-- Function: public.append_subject_entry_service
-- Arguments: p_subject_type text, p_subject_id uuid, p_entry_type text, p_content text,
--            p_metadata jsonb, p_created_by uuid, p_story_id uuid, p_is_internal boolean,
--            p_occurred_at timestamptz
-- Description: The single privileged writer of a TYPED RECORD onto a subject's
--              timeline (the polymorphic story_entries axis). Every doctrine
--              statement of the form "work with a twin leaves a typed record in
--              its story" funnels through here, so attribution and shape are
--              decided in one place instead of in each caller.
-- Security: SECURITY DEFINER, service_role only. This function performs NO
--           authorization of its own — it is an internal primitive, and the
--           CALLING RPC is responsible for deciding who may write to which
--           subject. That is why it is REVOKEd from authenticated: exposed
--           directly it would be an entry-forgery tool, the same reason
--           write_audit_journal was revoked from authenticated (2026-07-15).

CREATE OR REPLACE FUNCTION public.append_subject_entry_service(
  p_subject_type text,
  p_subject_id uuid,
  p_entry_type text,
  p_content text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL,
  p_story_id uuid DEFAULT NULL,
  p_is_internal boolean DEFAULT false,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
BEGIN
  IF p_subject_type IS NULL OR btrim(p_subject_type) = '' THEN
    RAISE EXCEPTION 'subject_type is required' USING ERRCODE = '22023';
  END IF;
  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'subject_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_entry_type IS NULL OR btrim(p_entry_type) = '' THEN
    RAISE EXCEPTION 'entry_type is required' USING ERRCODE = '22023';
  END IF;

  -- story_id stays the legacy binding: set it only for the 'story' axis, where
  -- the FK to partner_stories can actually hold. For every other kind the
  -- polymorphic pair is the whole address.
  INSERT INTO public.story_entries (
    story_id, subject_type, subject_id, entry_type, content, metadata,
    is_internal, created_by, occurred_at
  ) VALUES (
    CASE WHEN p_subject_type = 'story' THEN COALESCE(p_story_id, p_subject_id) ELSE p_story_id END,
    p_subject_type,
    p_subject_id,
    p_entry_type,
    p_content,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_is_internal, false),
    p_created_by,
    COALESCE(p_occurred_at, now())
  )
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$function$
;

-- Permissions — internal primitive: never reachable from a member session.
REVOKE ALL ON FUNCTION public.append_subject_entry_service(text, uuid, text, text, jsonb, uuid, uuid, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_subject_entry_service(text, uuid, text, text, jsonb, uuid, uuid, boolean, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.append_subject_entry_service(text, uuid, text, text, jsonb, uuid, uuid, boolean, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_subject_entry_service(text, uuid, text, text, jsonb, uuid, uuid, boolean, timestamptz) TO service_role;
