-- ============================================================================
-- Source of Truth: fn_submit_message_feedback_audited
-- Step:  Step 2 of retrieval optimization plan 2026
-- Used by: src/hooks/useSubmitMessageFeedback.ts → FeedbackButtons.tsx
-- Audit:  INSERT INTO audit_journal (action='chat.message_feedback', metadata)
-- Migration: aisha/db/migrations/20260518220000_chat_message_eval_link.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_submit_message_feedback_audited(
  p_ai_run_id  uuid,
  p_metadata   jsonb,
  p_rating     smallint,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fb_id     uuid;
  v_audit_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required' USING ERRCODE = '22023';
  END IF;
  IF p_ai_run_id IS NULL THEN
    RAISE EXCEPTION 'p_ai_run_id is required';
  END IF;
  IF p_rating IS NULL OR p_rating NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'p_rating must be -1, 0, or 1';
  END IF;

  INSERT INTO public.message_user_feedback (ai_run_id, user_id, rating, reason, metadata)
  VALUES (p_ai_run_id, auth.uid(), p_rating, p_reason, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (ai_run_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating,
        reason = EXCLUDED.reason,
        metadata = EXCLUDED.metadata
  RETURNING id INTO v_fb_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'chat.message_feedback',
    jsonb_build_object(
      'feedback_id', v_fb_id,
      'ai_run_id', p_ai_run_id,
      'rating', p_rating,
      'has_reason', p_reason IS NOT NULL AND length(p_reason) > 0
    )
  )
  RETURNING id INTO v_audit_id;

  UPDATE public.message_user_feedback
     SET audit_journal_id = v_audit_id
   WHERE id = v_fb_id;

  RETURN v_fb_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_submit_message_feedback_audited(uuid, jsonb, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_submit_message_feedback_audited(uuid, jsonb, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_message_feedback_audited(uuid, jsonb, smallint, text) TO service_role;

COMMENT ON FUNCTION public.fn_submit_message_feedback_audited(uuid, jsonb, smallint, text) IS
  'Step 2: end-user thumbs feedback (rating ∈ {-1, 0, 1}) + optional reason. Upsert per (run, user). Audit row written.';
