/**
 * can_access_linked_story
 *
 * Determines whether a user can access a linked story based on their role
 * and participation. Admin/staff can access any accepted link; regular users
 * must be a participant of the source story with an accepted link to the target.
 *
 * @param p_user_id - UUID of the user requesting access
 * @param p_source_story_id - UUID of the source story
 * @param p_target_story_id - UUID of the target story
 * @returns boolean - true if the user can access the linked story
 */
CREATE OR REPLACE FUNCTION public.can_access_linked_story(
  p_user_id uuid,
  p_source_story_id uuid,
  p_target_story_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Přes
  -- `/rpc/can_access_linked_story` se dal pro CIZÍ uuid zjistit, jestli je
  -- účastníkem zdrojové story a (větví níž) jestli je admin/staff — funkce
  -- se ptala `is_admin_or_staff(p_user_id)`, tedy na roli toho, na koho se
  -- volající ptá, ne na jeho vlastní.
  --
  -- Odpovídá se jen o VOLAJÍCÍM; služba a správa na kohokoli. Změřeno, že to
  -- nic nerozbije: jediný volající v repu (get_cross_story_summary) předává
  -- `v_user_id := auth.uid()`. `false` = deny, stejně jako „odkaz neexistuje",
  -- takže zamítnutí nic neprozradí.
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RETURN false;
    END IF;
  END IF;

  -- Admin/staff can access any linked story (but link must still be accepted)
  IF public.is_admin_or_staff(p_user_id) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.story_links
      WHERE (
        (source_story_id = p_source_story_id AND target_story_id = p_target_story_id)
        OR (source_story_id = p_target_story_id AND target_story_id = p_source_story_id)
      )
      AND is_accepted = true
    );
  END IF;

  -- Regular users: must be participant of source story,
  -- and an accepted link must exist between source and target
  RETURN (
    public.is_story_participant(p_user_id, p_source_story_id)
    AND EXISTS (
      SELECT 1 FROM public.story_links
      WHERE (
        (source_story_id = p_source_story_id AND target_story_id = p_target_story_id)
        OR (source_story_id = p_target_story_id AND target_story_id = p_source_story_id)
      )
      AND is_accepted = true
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_linked_story(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_linked_story(uuid, uuid, uuid) TO authenticated;
