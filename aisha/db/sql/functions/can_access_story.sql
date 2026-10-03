-- Function: public.can_access_story
-- Arguments: p_story_id uuid, p_for_write boolean DEFAULT false
-- Description: Smí volající (auth.uid() / service_role) na story? Jediný predikát
--   pro story-scoped SECURITY DEFINER RPC, které dřív nekontrolovaly NIC.
-- Security: SECURITY DEFINER
-- Search path: public
--
-- ⛔ NAMĚŘENO 2026-09-14: transition_story_delivery_status, get_allowed_transitions,
-- moderate_development_flow, mcp_get_compliance_context a generate_copilot_instructions
-- byly SECURITY DEFINER s GRANT authenticated a bez jakékoli kontroly story —
-- každý přihlášený mohl číst kontext a ruleset cizí story a měnit její
-- delivery_status. Příprava na MCP Client Tool (nástroje nad těmito RPC poběží
-- pod identitou uživatele / PAT) to z latentní díry dělá otevřenou.
--
-- Pravidla:
--   service_role, admin/staff  → vždy (strojová lane a správa)
--   vlastník story (partner_stories.user_id)  → čtení i zápis
--   účastník story  → čtení; zápis jen s rolí jinou než 'viewer'
--   kdokoli jiný, nepřihlášený, neexistující story  → false
-- Neexistující a cizí story vrací totéž (false) — volající stráž tak není orákulum
-- existence story.

CREATE OR REPLACE FUNCTION public.can_access_story(p_story_id uuid, p_for_write boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    RETURN true;
  END IF;

  IF v_user_id IS NULL OR p_story_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
           SELECT 1 FROM public.partner_stories ps
           WHERE ps.id = p_story_id AND ps.user_id = v_user_id
         )
      OR EXISTS (
           SELECT 1 FROM public.story_participants sp
           WHERE sp.story_id = p_story_id
             AND sp.user_id = v_user_id
             AND (NOT p_for_write OR sp.role <> 'viewer')
         );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_story(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_story(uuid, boolean) TO authenticated, service_role;
