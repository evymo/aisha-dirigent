-- Function: public.update_message_eval_score
-- Records an LLM-as-judge evaluation onto a chat message (svc-ai-chat
-- routes/evaluate.ts). Stores the judge model, the averaged score and the
-- per-dimension score object into chat_messages.eval_score (jsonb).
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.update_message_eval_score(
  p_eval_model text,
  p_eval_score_avg numeric,
  p_eval_scores jsonb,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id is required' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.chat_messages
     SET eval_score = jsonb_build_object(
           'model', p_eval_model,
           'score_avg', p_eval_score_avg,
           'scores', COALESCE(p_eval_scores, '{}'::jsonb),
           'evaluated_at', now()
         )
   WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat message not found: %', p_message_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.update_message_eval_score(text, numeric, jsonb, uuid) IS
  'Writes the LLM-as-judge verdict (model + avg + per-dimension scores) onto chat_messages.eval_score.';

REVOKE ALL ON FUNCTION public.update_message_eval_score(text, numeric, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_message_eval_score(text, numeric, jsonb, uuid) TO service_role;
