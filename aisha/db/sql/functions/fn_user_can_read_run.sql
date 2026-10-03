/**
 * fn_user_can_read_run
 *
 * On-behalf-of authorization for reading an ai_run: returns true iff the given
 * user may read the given run. Mirrors the canonical ai_runs read authority
 * (RLS policies participant_read_ai_runs + admin_staff_read_ai_runs) and adds
 * the story OWNER, so the user who started a run can always drain it:
 *   - admin/staff                                  → always
 *   - run bound to a story AND (
 *       user is a story participant
 *       OR user owns the story (partner_stories.user_id)
 *       OR the story is the stack-default story )  → yes
 *   - system run (story_id IS NULL)                → admin/staff only
 *
 * Used by the Omni reflection-poll endpoint (GET /reflect/runs/:id) to authorize
 * a PAT caller against the LOADED run's story — identity comes from the validated
 * PAT (user_id), resource authz is checked here against the run. This lets a
 * scoped, unscoped, OR legacy PAT drain ITS OWN deferred run without relaxing the
 * §8.5 token story-binding that /v1/chat/completions still enforces.
 *
 * FAIL-CLOSED: a non-existent run_id matches no ai_runs row → EXISTS is false →
 * returns false, identical to "not allowed" (no existence oracle for the caller).
 *
 * STRÁŽ VOLAJÍCÍHO (2026-09-19): odpovídá jen o volajícím (p_user_id = auth.uid());
 * na kohokoli se smí ptát service_role (reflect.ts) a admin/staff — jinak false.
 *
 * @param p_user_id - the caller's user id (from the validated PAT)
 * @param p_run_id  - the ai_run to authorize
 * @returns boolean - true iff the user may read the run
 */
CREATE OR REPLACE FUNCTION public.fn_user_can_read_run(p_user_id uuid, p_run_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Funkce je
  -- on-behalf-of autorizace pro SLUŽBU (svc-ai-chat reflect.ts ji volá service
  -- klíčem s user_id z ověřeného PAT), jenže GRANT pro `authenticated` ji vystavil
  -- i přímo: přihlášený člen se pro cizí uuid dozvěděl, zda smí číst který běh —
  -- tedy vlastnictví a účast v cizích story (a přes is_admin_or_staff(p_user_id)
  -- i cizí roli).
  --
  -- Odpovídá se jen o VOLAJÍCÍM; služba a správa na kohokoli. Změřeno, že to nic
  -- nerozbije: jediný volající v repu je reflect.ts přes rpcService (service_role).
  -- `false` = totéž, co „nesmí" i „běh neexistuje", takže zamítnutí nic neprozradí.
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_user_id = auth.uid()
      OR public.is_service_role()
      OR public.is_admin_or_staff()
    THEN EXISTS (
      SELECT 1
      FROM public.ai_runs r
      WHERE r.id = p_run_id
        AND (
          public.is_admin_or_staff(p_user_id)
          OR (
            r.story_id IS NOT NULL
            AND (
              public.is_story_participant(p_user_id, r.story_id)
              OR EXISTS (
                SELECT 1 FROM public.partner_stories ps
                WHERE ps.id = r.story_id
                  AND (ps.user_id = p_user_id OR ps.is_stack_default = true)
              )
            )
          )
        )
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.fn_user_can_read_run(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_user_can_read_run(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_can_read_run(uuid, uuid) TO service_role;
