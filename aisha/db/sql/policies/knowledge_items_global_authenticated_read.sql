-- Policy: knowledge_items_global_authenticated_read ON public.knowledge_items
--
-- Čtení tabulky napřímo pro přihlášeného: globální položky s viditelností, kterou mu dává
-- JEDEN domov (public.knowledge_visibility_searchable — týž jako hledání a čtení podle id;
-- politika se ho ptá přes public.knowledge_visibilities_for_caller() — množina pro identitu volajícího):
-- `public`, `members` (je přihlášen) a `guild`, má-li profil partnera; navíc položky
-- s požadavkem na úroveň členství, kterou volající splňuje. Proč čtyři politiky a co
-- bylo špatně: knowledge_items_global_anon_read.sql.
--
-- Úroveň se měří na řádku ZÁMĚRNĚ — závisí na `minimum_tier` té položky. Funkce je
-- jednoargumentová (měří volajícího); `authenticated` na ni EXECUTE má.
DROP POLICY IF EXISTS knowledge_items_global_authenticated_read ON public.knowledge_items;
CREATE POLICY knowledge_items_global_authenticated_read ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'active'
    AND story_id IS NULL
    -- Množina štítků se spočítá jednou za dotaz (poddotaz bez vazby na řádek → InitPlan).
    AND visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[])
    -- Týž výčet jako public.knowledge_state_readable — politika ho nese doslova, protože
    -- se vyhodnocuje právy tazatele a ten funkci spustit nesmí. Shodu hlídá brána.
    AND quarantine_status IN ('clear', 'reviewed', 'reinstated')
    AND (minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(minimum_tier))
  );
