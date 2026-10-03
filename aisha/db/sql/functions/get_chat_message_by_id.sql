-- Function: get_chat_message_by_id
-- Zpráva chatu podle id pro hodnocení kvality (svc-ai-chat routes/evaluate.ts, jen služba).
--
-- Vznik 2026-09-29 (SELF_IMPROVEMENT_LOOP.md §3, K-17): evaluate.ts ji volal od začátku,
-- ale SoT neexistoval (brána rpc-sql-mapping ji vedla jako V2_PENDING) → každé hodnocení
-- odpovědi z chatu padlo dřív, než se soudce vůbec zeptal. chat_messages čte přes RLS jen
-- správce, služba potřebuje definer čtečku; vrací jen pole, která hodnocení čte.
-- Vrací objekt, nebo NULL, když zpráva neexistuje (route z toho dělá 404).

CREATE OR REPLACE FUNCTION public.get_chat_message_by_id(p_message_id uuid)
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
    SELECT jsonb_build_object(
      'id', cm.id,
      'content', cm.content,
      'role', cm.role,
      'conversation_id', cm.conversation_id
    )
    FROM public.chat_messages cm
    WHERE cm.id = p_message_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_chat_message_by_id(uuid) IS
  'Zpráva chatu (id, content, role, conversation_id) pro hodnocení kvality; jen služba. NULL = neexistuje.';

REVOKE ALL ON FUNCTION public.get_chat_message_by_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_message_by_id(uuid) TO service_role;
