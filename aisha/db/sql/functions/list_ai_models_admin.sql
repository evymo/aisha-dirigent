-- list_ai_models_admin — Admin/staff-only list AI modelů z ai_model_registry.
-- Slouží pro Dirigent VS Code extension Model Switch dropdown a NocoDB admin view.
--
-- Migration: 20260428112918_insight_maestro_provider.sql
-- Hooks/MCP: src/hooks/useAiModels.ts (useAiModelRegistry)

CREATE OR REPLACE FUNCTION public.list_ai_models_admin(
  p_provider text DEFAULT NULL,
  p_only_available boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  provider text,
  model_id text,
  display_name text,
  model_family text,
  is_admin_active boolean,
  is_available boolean,
  is_deprecated boolean,
  context_window integer,
  max_output_tokens integer,
  input_price_per_m numeric,
  output_price_per_m numeric,
  eval_status text,
  latest_eval_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied: admin or staff role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.provider,
    r.model_id,
    r.display_name,
    r.model_family,
    r.is_admin_active,
    r.is_available,
    r.is_deprecated,
    r.context_window,
    r.max_output_tokens,
    r.input_price_per_m,
    r.output_price_per_m,
    r.eval_status,
    r.latest_eval_score
  FROM public.ai_model_registry r
  WHERE (NOT p_only_available OR (r.is_available AND NOT r.is_deprecated))
    AND (p_provider IS NULL OR r.provider = p_provider)
  ORDER BY r.is_admin_active DESC, r.provider, r.display_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_ai_models_admin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_ai_models_admin(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.list_ai_models_admin(text, boolean) IS
  'Admin/staff-only list AI modelů z ai_model_registry. Slouží pro Dirigent VS Code '
  'extension Model Switch dropdown a NocoDB admin view.';
