-- Function: fn_resolve_embedding_model
-- Resolve a NAMED embedding model's backend + corpus space — the eval/sweep (brick 1)
-- needs to test a SPECIFIC candidate embedding model, not let the per-call CLOW ranker
-- pick one (that ranker is the model-as-index-constant anti-pattern; here we deliberately
-- name the model under test). Returns the provider transport (backend_kind/endpoint/auth)
-- so the query can be embedded with exactly that model, plus the corpus vector SPACE the
-- model targets (derived from its native dimension: 2560 ⇒ v2 halfvec, else v1 vector).
--
-- Availability still honours capability-availability: only an enabled provider serving an
-- is_embedding model that is available + not deprecated + healthy is returned. Empty result
-- ⇒ the named model has no live embedding backend (caller must fail loud, never silently
-- substitute a different model — that would compare a query against a corpus embedded by a
-- DIFFERENT model). Prefer the FK-linked provider row over the legacy provider=slug arm.

CREATE OR REPLACE FUNCTION public.fn_resolve_embedding_model(p_model_id text)
 RETURNS TABLE(
   model_id text,
   provider_slug text,
   backend_kind text,
   endpoint_url text,
   auth_env_var text,
   embedding_dimensions integer,
   rag_space text
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_model_id IS NULL OR p_model_id = '' THEN
    RAISE EXCEPTION 'p_model_id is required';
  END IF;

  RETURN QUERY
  SELECT
    r.model_id,
    p.slug,
    p.backend_kind,
    p.endpoint_url,
    p.auth_env_var,
    r.embedding_dimensions,
    -- Prostor se určuje SHODOU rozměru se sloupcem, ne „všechno ostatní je v1".
    -- Dřív tu stálo `CASE WHEN dim = 2560 THEN 'v2' ELSE 'v1'`: nebyla to derivace,
    -- ale dvouhodnotová tabulka, která KAŽDÝ jiný rozměr mlčky prohlásila za v1.
    -- Model s 1024 tak dostal nálepku v1 a jeho vektor by šel do sloupce jiného
    -- rozměru — Postgres to odmítne až při zápisu, daleko od místa rozhodnutí,
    -- a u dotazu by se neshoda projevila jen jako nevysvětlitelně horší výsledky.
    -- NULL = „tenhle model do žádného zdejšího prostoru nepatří"; volající to musí
    -- ošetřit hlasitě, protože mlčky zvolený špatný prostor je horší než chyba.
    CASE r.embedding_dimensions
      WHEN 2560 THEN 'v2'
      WHEN 1024 THEN 'v1'
      ELSE NULL
    END AS rag_space
  FROM public.ai_model_registry r
  JOIN public.ai_provider_registry p
    ON (r.provider_registry_id = p.id OR r.provider = p.slug)
  WHERE r.model_id = p_model_id
    AND r.is_embedding
    AND r.is_available
    AND NOT r.is_deprecated
    AND p.is_enabled
    AND p.last_health_status IN ('healthy', 'unknown')
  ORDER BY (r.provider_registry_id = p.id) DESC  -- prefer the FK-linked provider row
  LIMIT 1;
END;
$function$
;

REVOKE ALL ON FUNCTION fn_resolve_embedding_model(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_resolve_embedding_model(text) TO service_role;
