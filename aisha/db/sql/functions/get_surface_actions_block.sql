-- ============================================================================
-- Source of Truth: get_surface_actions_block
-- Popis: GENERICKÝ blok masky `action_form` (ADR-003, K4): vydá akce správy
--   dostupné VOLAJÍCÍMU pro daný druh cíle — z allowlistu surface_actions pod
--   RLS (aktivní + publikum), s deklarací polí, kterou renderer nakreslí jako
--   formulář. Identitu cíle nese klientský parametr (u restricted bloku jen přes
--   deklaraci client_params — get_block_data); bez identity blok vydá akce
--   s `target_id: null` (renderer je nabídne až po výběru záznamu).
--
-- Konfigurace (p_params):
--   target_kind  POVINNÉ  'twin' | 'actor' | 'story' | 'none'
--   id_param     volitelné jméno parametru s identitou (default podle druhu:
--                twin→twin_id, actor→user_id, story→story_id)
--   namespace    volitelné filtr na vlastníka řádků akcí
--
-- SECURITY INVOKER: seznam akcí je přesně to, co RLS volajícímu pustí — týž
-- filtr, který pak platí při submitu. Poctivá degradace: prázdné `actions`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_surface_actions_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_kind     text := nullif(btrim(coalesce(p_params->>'target_kind', '')), '');
  v_ns       text := nullif(btrim(coalesce(p_params->>'namespace', '')), '');
  v_id_param text;
  v_id       text;
  v_now      timestamptz := now();
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('twin','actor','story','none') THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('target_kind', coalesce(v_kind, 'none'), 'target_id', NULL, 'actions', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', 'surface_actions',
                                       'trace_id', 'surface-actions:missing_config', 'freshness_at', v_now));
  END IF;
  v_id_param := coalesce(nullif(btrim(coalesce(p_params->>'id_param', '')), ''),
                         CASE v_kind WHEN 'twin' THEN 'twin_id' WHEN 'actor' THEN 'user_id' WHEN 'story' THEN 'story_id' ELSE 'record_id' END);
  v_id := nullif(btrim(coalesce(p_params->>v_id_param, '')), '');
  IF v_id IS NOT NULL AND v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'target_kind', v_kind,
      'target_id', v_id,
      'actions', coalesce((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'slug',            a.action_slug,
                 'title_key',       a.title_key,
                 'description_key', a.description_key,
                 'fields',          (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                        'key',       f->>'key',
                                        'label_key', f->>'label_key',
                                        'type',      coalesce(f->>'type', 'text'),
                                        'required',  coalesce((f->>'required')::boolean, false),
                                        'options',   CASE WHEN jsonb_typeof(f->'options') = 'array' THEN f->'options' END,
                                        'default',   f->>'default'))
                                      ORDER BY ord), '[]'::jsonb)
                                     FROM jsonb_array_elements(coalesce(a.fields, '[]'::jsonb)) WITH ORDINALITY AS fs(f, ord)
                                     WHERE coalesce(f->>'key', '') ~ '^[a-z][a-z0-9_]*$'
                                       AND nullif(f->>'label_key', '') IS NOT NULL)))
               ORDER BY a.position, a.action_slug)
        FROM public.surface_actions a
        WHERE a.is_active
          AND a.target_kind = v_kind
          AND (v_ns IS NULL OR a.namespace = v_ns)
      ), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug', 'surface_actions',
      'trace_id', 'surface-actions:' || v_kind,
      'freshness_at', v_now));
END;
$$;

REVOKE ALL ON FUNCTION public.get_surface_actions_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_surface_actions_block(jsonb) TO authenticated, service_role;
