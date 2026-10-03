-- Function: public.update_conversation_message_count
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:16+01:00

CREATE OR REPLACE FUNCTION public.update_conversation_message_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.chat_conversations SET message_count = message_count + 1, last_message_at = NEW.created_at,
      total_tokens_used = COALESCE(total_tokens_used, 0) + COALESCE(NEW.tokens_input, 0) + COALESCE(NEW.tokens_output, 0)
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_conversation_message_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_conversation_message_count() TO authenticated;
