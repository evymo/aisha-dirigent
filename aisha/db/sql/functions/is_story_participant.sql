/**
 * is_story_participant
 *
 * Checks whether a user is a participant of a given story.
 * Used as a security helper for story collaboration RLS and RPC functions.
 *
 * @param p_user_id - UUID of the user to check
 * @param p_story_id - UUID of the story to check participation in
 * @returns boolean - true if the user is a participant
 */
CREATE OR REPLACE FUNCTION public.is_story_participant(p_user_id uuid, p_story_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Funkce je
  -- přes PostgREST vystavená (`/rpc/is_story_participant`) a pravdivě odpovídala
  -- o KOMKOLI: přihlášený člen z ní složil, kdo patří do které story — tedy
  -- graf spoluprací cizích lidí, uuid po uuid.
  --
  -- Odpovídá se proto jen o VOLAJÍCÍM; služba a správa se smí ptát na kohokoli.
  -- Změřeno, že to nic nerozbije: všech 10 volání v politikách (sql/rls,
  -- sql/policies — story_participants, web_artifact_jobs, story_links) jí
  -- předává `auth.uid()`, ani jedno sloupec řádku; 21 volání z definer funkcí
  -- předává proměnnou naplněnou z `auth.uid()`; fn_user_can_read_run
  -- a can_access_linked_story mají tutéž stráž před sebou a svc-ai-chat
  -- (dirigent-supervisor) volá service klíčem. `false` místo výjimky je záměr —
  -- predikát v RLS má vracet deny, ne shodit dotaz.
  --
  -- REVOKE tady řešením NENÍ: RLS predikát se vyhodnocuje právy volajícího,
  -- takže odebrání EXECUTE by shodilo obyčejné čtení story_links.
  --
  -- TVAR JE ZMĚŘENÝ, ne estetický. V politice story_links se predikát volá PER
  -- ŘÁDEK se sloupcem řádku (`is_story_participant(auth.uid(), source_story_id)`),
  -- takže do InitPlanu nejde. Throwaway DB, 29 903 odkazů, tvar té politiky:
  --     bez stráže                    ~1 770 ms
  --     stráž napřed (CASE)           ~3 180 ms   ← auth.uid() za každý řádek
  --     EXISTS napřed, stráž potom    ~1 690 ms   ← tenhle tvar
  -- Většina řádků účast nemá, EXISTS vrátí false a stráž se nevyhodnotí vůbec.
  -- Výsledek je v obou pořadích totožný (AND); pořadí nese jen cenu.
  -- COALESCE drží anonyma: `p_user_id = NULL` je NULL → false, ne NULL.
  SELECT EXISTS (
      SELECT 1 FROM public.story_participants
      WHERE user_id = p_user_id AND story_id = p_story_id
    )
    AND (
      COALESCE(p_user_id = auth.uid(), false)
      OR public.is_service_role()
      OR public.is_admin_or_staff()
    );
$function$;

REVOKE ALL ON FUNCTION public.is_story_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_story_participant(uuid, uuid) TO authenticated;
-- service_role: start_web_artifact_ingest (SECURITY INVOKER) evaluates this as the
-- real service_role role at boot; same result, grant only avoids a permission error.
GRANT EXECUTE ON FUNCTION public.is_story_participant(uuid, uuid) TO service_role;
