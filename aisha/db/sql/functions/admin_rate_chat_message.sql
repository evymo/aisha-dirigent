-- Function: public.admin_rate_chat_message
-- Arguments: p_message_id uuid, p_rating smallint, p_review_note text, p_is_golden boolean
-- Description: Admin rating/review of AI chat messages + golden example flag
-- Security: SECURITY DEFINER, admin/staff only
-- Source: supabase/migrations/20260302100000_phase3_evaluation_system.sql

CREATE OR REPLACE FUNCTION public.admin_rate_chat_message(
  p_message_id uuid,
  p_rating smallint,
  p_review_note text DEFAULT NULL,
  p_is_golden boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required';
  END IF;

  IF p_rating IS NOT NULL AND p_rating NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'Rating must be -1, 0, or 1';
  END IF;

  UPDATE chat_messages
  SET admin_rating = COALESCE(p_rating, admin_rating),
      admin_review_note = COALESCE(p_review_note, admin_review_note),
      is_golden_example = COALESCE(p_is_golden, is_golden_example)
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  PERFORM write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'admin'::journal_area,
    p_details := jsonb_build_object(
      'rating', p_rating,
      'has_review_note', p_review_note IS NOT NULL,
      'is_golden', p_is_golden
    ),
    p_entity_id := p_message_id::text,
    p_entity_type := 'chat_message',
    p_severity := 'info'::journal_severity,
    p_summary := 'Admin rated AI response',
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rate_chat_message(uuid, smallint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rate_chat_message(uuid, smallint, text, boolean) TO authenticated;
