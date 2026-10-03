-- =============================================================================
-- get_voice_room_entry — místnost podle jména v LiveKitu + verdikt vstupu
-- =============================================================================
-- Služební čtečka pro svc-livekit /create-token. Nahrazuje dvě RPC, která
-- trasa volala a která NIKDY neexistovala (get_voice_room_by_livekit_name,
-- check_story_membership — audit hlasu 2026-09-29, krok 5b): trasa proto
-- každou místnost hlásila 404. Rozhodnutí o vstupu nese can_enter_voice_room,
-- ne služba — jedno pravidlo pro token i pro RPC nad místnostmi.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_voice_room_entry(p_livekit_room_name text, p_user_id uuid)
RETURNS TABLE(
  id uuid,
  is_active boolean,
  story_id uuid,
  room_type text,
  may_enter boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT vr.id, vr.is_active, vr.story_id, vr.room_type,
         public.can_enter_voice_room(vr.id, p_user_id)
  FROM public.voice_rooms vr
  WHERE vr.livekit_room_name = p_livekit_room_name;
$function$;

REVOKE ALL ON FUNCTION public.get_voice_room_entry(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voice_room_entry(text, uuid) TO service_role;
