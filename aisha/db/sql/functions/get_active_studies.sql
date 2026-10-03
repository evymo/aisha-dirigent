-- Function: public.get_active_studies
-- Description: Public access function(s) for active studies.
-- Notes:
-- - Includes both overloads: get_active_studies(p_locale text) + wrapper get_active_studies()
-- - Keeps frontend contract stable and prevents init ordering issues

DROP FUNCTION IF EXISTS public.get_active_studies(text);
DROP FUNCTION IF EXISTS public.get_active_studies();

-- Single function with DEFAULT parameter (no overloads to avoid PGRST203)
CREATE OR REPLACE FUNCTION public.get_active_studies(p_locale text DEFAULT 'en')
RETURNS TABLE (
  id uuid,
  code text,
  name text,
  description text,
  study_type text,
  target_condition text,
  products text[],
  duration_weeks integer,
  target_registration integer,
  current_registration integer,
  is_blinded boolean,
  is_active boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  protocol_url text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id,
    s.code,
    COALESCE(name_t.value, name_en_t.value, s.name) AS name,
    COALESCE(desc_t.value, desc_en_t.value, s.description) AS description,
    s.study_type::text,
    s.target_condition,
    s.products,
    s.duration_weeks,
    s.target_registration,
    COALESCE(s.current_registration, 0)::integer,
    s.is_blinded,
    s.is_active,
    s.starts_at,
    s.ends_at,
    s.protocol_url,
    s.created_at,
    s.updated_at
  FROM public.studies s
  LEFT JOIN public.translations name_t
    ON name_t.namespace = 'studies'
   AND name_t.key = s.name_key
   AND name_t.locale = p_locale
  LEFT JOIN public.translations name_en_t
    ON name_en_t.namespace = 'studies'
   AND name_en_t.key = s.name_key
   AND name_en_t.locale = 'en'
  LEFT JOIN public.translations desc_t
    ON desc_t.namespace = 'studies'
   AND desc_t.key = s.description_key
   AND desc_t.locale = p_locale
  LEFT JOIN public.translations desc_en_t
    ON desc_en_t.namespace = 'studies'
   AND desc_en_t.key = s.description_key
   AND desc_en_t.locale = 'en'
  WHERE s.is_active = true
  ORDER BY s.created_at DESC;
$$;

-- Permissions (PUBLIC: seznam studií je veřejný)
REVOKE ALL ON FUNCTION public.get_active_studies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_studies(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_active_studies(text) IS 'Returns active studies with locale-aware name/description. Uses DEFAULT parameter to avoid overload ambiguity (PGRST203).';
