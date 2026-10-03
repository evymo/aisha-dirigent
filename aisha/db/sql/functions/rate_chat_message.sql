-- Function: public.rate_chat_message
-- Arguments: p_message_id uuid, p_rating smallint, p_feedback text
-- Description: User rating for AI chat messages (-1, 0, 1) with optional feedback
-- Security: SECURITY DEFINER, authenticated only
-- Source: supabase/migrations/20260302100000_phase3_evaluation_system.sql

CREATE OR REPLACE FUNCTION public.rate_chat_message(
  p_message_id uuid,
  p_rating smallint,
  p_feedback text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_conv_owner uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT cc.user_id INTO v_conv_owner
  FROM chat_messages cm
  JOIN chat_conversations cc ON cc.id = cm.conversation_id
  WHERE cm.id = p_message_id;

  IF v_conv_owner IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF v_conv_owner <> v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_rating NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'Rating must be -1, 0, or 1';
  END IF;

  UPDATE chat_messages
  SET user_rating = p_rating,
      user_feedback = p_feedback
  WHERE id = p_message_id;

  PERFORM write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'chat'::journal_area,
    p_details := jsonb_build_object('rating', p_rating, 'has_feedback', p_feedback IS NOT NULL),
    p_entity_id := p_message_id::text,
    p_entity_type := 'chat_message',
    p_severity := 'info'::journal_severity,
    p_summary := 'User rated AI response',
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_chat_message(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_chat_message(uuid, smallint, text) TO authenticated;
