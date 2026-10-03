-- Function: get_preceding_user_message
-- Poslední zpráva UŽIVATELE před danou zprávou v téže konverzaci — otázka, na kterou
-- hodnocená odpověď odpovídala (svc-ai-chat routes/evaluate.ts, jen služba).
--
-- Vznik 2026-09-29 (SELF_IMPROVEMENT_LOOP.md §3, K-17): evaluate.ts ji volal, SoT neexistoval
-- (V2_PENDING v bráně rpc-sql-mapping). Bez otázky soudce hodnotí odpověď naslepo.
-- Vrací {content} nebo NULL, když otázka před zprávou není.

CREATE OR REPLACE FUNCTION public.get_preceding_user_message(p_conversation_id uuid, p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object('content', cm.content)
    FROM public.chat_messages cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.role = 'user'
      AND cm.created_at < (SELECT m.created_at FROM public.chat_messages m WHERE m.id = p_message_id)
    ORDER BY cm.created_at DESC
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public.get_preceding_user_message(uuid, uuid) IS
  'Poslední zpráva uživatele před danou zprávou v konverzaci ({content}); jen služba. NULL = není.';

REVOKE ALL ON FUNCTION public.get_preceding_user_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_preceding_user_message(uuid, uuid) TO service_role;
