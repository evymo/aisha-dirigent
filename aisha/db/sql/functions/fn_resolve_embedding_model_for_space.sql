-- Function: fn_resolve_embedding_model_for_space
-- Brick2-PIN: resolve the embedding model to embed a query IN a given corpus SPACE
-- ('v1' vector(1024) | 'v2' halfvec(2560)). The prod search path passes the context profile
-- slug; this function reads that context's embedding_model_pref (= the space the corpus was
-- indexed in) DB-side (honours RPC-only data access — the route never reads context_profiles
-- directly), then resolves which live model targets that space — so the query is embedded
-- with a model whose native dimension routes to the SAME column it will be cosine-compared
-- against (dim-routing: 2560 ⇒ v2, 1024 ⇒ v1, jiný rozměr ⇒ NULL — nepatří do zdejšího prostoru). When no profile slug is given (or it has no
-- pref) the explicit p_rag_space is used. Symmetric twin of fn_resolve_embedding_model,
-- which resolves a NAMED model; here we resolve a model FOR a space.
--
-- Availability honours capability-availability identically: only an enabled provider serving
-- an is_embedding + is_available + NOT is_deprecated model on a healthy/unknown provider is
-- returned. Empty result ⇒ no live embedding backend for that space (the caller MUST fail
-- loud / degrade to text-only — never silently embed with a different-space model, which
-- would compare a query against a corpus embedded by a model of the wrong dimension). The
-- FK-linked provider row is preferred over the legacy provider=slug arm.

CREATE OR REPLACE FUNCTION public.fn_resolve_embedding_model_for_space(p_rag_space text DEFAULT 'v1'::text, p_context_profile_slug text DEFAULT NULL::text)
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
DECLARE
  v_space text := p_rag_space;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- Prefer the context profile's pinned embedding space (the corpus's index generation)
  -- when a slug is supplied; fall back to the explicit p_rag_space otherwise.
  IF p_context_profile_slug IS NOT NULL THEN
    SELECT cp.embedding_model_pref INTO v_space
    FROM public.context_profiles cp
    WHERE cp.slug = p_context_profile_slug;
    v_space := COALESCE(v_space, p_rag_space);
  END IF;

  IF v_space IS NULL OR v_space NOT IN ('v1', 'v2') THEN
    RAISE EXCEPTION 'resolved rag space must be one of v1, v2 (got %)', v_space;
  END IF;

  RETURN QUERY
  SELECT
    r.model_id,
    p.slug,
    p.backend_kind,
    p.endpoint_url,
    p.auth_env_var,
    r.embedding_dimensions,
    CASE r.embedding_dimensions WHEN 2560 THEN 'v2' WHEN 1024 THEN 'v1' ELSE NULL END AS rag_space
  FROM public.ai_model_registry r
  JOIN public.ai_provider_registry p
    ON (r.provider_registry_id = p.id OR r.provider = p.slug)
  WHERE r.is_embedding
    AND r.is_available
    AND NOT r.is_deprecated
    AND p.is_enabled
    AND p.last_health_status IN ('healthy', 'unknown')
    -- Dim-routing: the model's native dimension must map to the requested corpus space.
    AND (CASE r.embedding_dimensions WHEN 2560 THEN 'v2' WHEN 1024 THEN 'v1' ELSE NULL END) = v_space
  ORDER BY (r.provider_registry_id = p.id) DESC,  -- prefer the FK-linked provider row
           r.latest_eval_score DESC NULLS LAST     -- then the better-benchmarked model
  LIMIT 1;
END;
$function$
;

REVOKE ALL ON FUNCTION fn_resolve_embedding_model_for_space(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_resolve_embedding_model_for_space(text, text) TO service_role;
