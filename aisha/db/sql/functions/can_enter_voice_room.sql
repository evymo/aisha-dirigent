-- =============================================================================
-- can_enter_voice_room — JEDINÝ predikát „smí tahle osoba do hlasové místnosti“
-- =============================================================================
-- ⛔ NAMĚŘENO 2026-09-29 (docs/audit/2026-09-29-hlas-a-matrix-audit.md, H-5) a
-- 2026-10-01 (audit veřejného vydání, B2): o vstupu do místnosti nerozhodovalo
-- nic. svc-livekit /create-token kontroloval členství jen u místnosti se story,
-- takže token do KONZULTACE (story_id NULL, jméno `consultation-` + 8 hex znaků)
-- dostal kdokoli přihlášený, kdo jméno znal nebo uhodl — a zapsal se jako její
-- účastník. U konzultace navázané na story pustil každého člena story do hovoru
-- dvou lidí. RPC nad místnostmi (seznam účastníků, PTT místnost story) se
-- neptala vůbec.
--
-- Pravidla (podle druhu místnosti, ne podle toho, kdo se ptá):
--   consultation        → jen volající a volaný z consultation_sessions.
--                         Ani člen story, ani správa: hovor dvou lidí je soukromý.
--   se story (ptt, …)    → vlastník story nebo její účastník (jakákoli role).
--   bez story           → zakladatel, nebo kdo už v místnosti účast má.
--   neaktivní místnost  → nikdo.
-- Správa (admin/staff) VĚDOMĚ bez obchvatu — na rozdíl od can_access_story:
-- k obsahu story ano, do živého hovoru ne.
--
-- Odpovídá jen o VOLAJÍCÍM; služba se smí ptát na kohokoli (svc-livekit vydává
-- token jménem ověřeného uživatele). Tvar viz is_story_participant — predikát
-- o třetí osobě je orákulum. EXECUTE má jen service_role: definer funkce níž ho
-- volají s právy vlastníka, PostgREST ho nevystavuje.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_enter_voice_room(p_voice_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (COALESCE(p_user_id = auth.uid(), false) OR public.is_service_role())
    AND EXISTS (
      SELECT 1
      FROM public.voice_rooms vr
      WHERE vr.id = p_voice_room_id
        AND vr.is_active
        AND CASE
          WHEN vr.room_type = 'consultation' THEN EXISTS (
            SELECT 1 FROM public.consultation_sessions cs
            WHERE cs.voice_room_id = vr.id
              AND p_user_id IN (cs.caller_id, cs.callee_id)
          )
          WHEN vr.story_id IS NOT NULL THEN
            EXISTS (
              SELECT 1 FROM public.partner_stories ps
              WHERE ps.id = vr.story_id AND ps.user_id = p_user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.story_participants sp
              WHERE sp.story_id = vr.story_id AND sp.user_id = p_user_id
            )
          ELSE
            vr.created_by = p_user_id
            OR EXISTS (
              SELECT 1 FROM public.call_participants cp
              WHERE cp.voice_room_id = vr.id AND cp.user_id = p_user_id
            )
        END
    );
$function$;

REVOKE ALL ON FUNCTION public.can_enter_voice_room(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_enter_voice_room(uuid, uuid) TO service_role;
