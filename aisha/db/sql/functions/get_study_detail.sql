-- Function: public.get_study_detail
-- Description: Public access function(s) for study detail.
-- Notes:
-- - Includes both overloads: get_study_detail(uuid, text) + wrapper get_study_detail(uuid)
-- - Locale-aware name/description via translations
-- - products stays text[]

DROP FUNCTION IF EXISTS public.get_study_detail(uuid, text);
DROP FUNCTION IF EXISTS public.get_study_detail(uuid);

-- Single function with DEFAULT parameter (no overloads to avoid PGRST203)
CREATE OR REPLACE FUNCTION public.get_study_detail(p_study_id uuid, p_locale text DEFAULT 'en')
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
  is_umbrella boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  protocol_url text,
  funding_goal numeric,
  current_funding numeric,
  funding_deadline timestamptz,
  funding_status text,
  min_participants integer,
  max_participants integer,
  created_at timestamptz,
  updated_at timestamptz,
  consultant_count bigint,
  contribution_count bigint,
  total_contributed numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
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
    COALESCE(s.is_umbrella, false),
    s.starts_at,
    s.ends_at,
    s.protocol_url,
    COALESCE(s.funding_goal, 0),
    COALESCE(s.current_funding, 0),
    s.funding_deadline,
    COALESCE(s.funding_status, 'draft')::text,
    COALESCE(s.min_participants, 0),
    s.max_participants,
    s.created_at,
    s.updated_at,
    COALESCE((SELECT COUNT(*) FROM public.study_consultants sc WHERE sc.study_id = s.id AND sc.status = 'approved'), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.study_contributions c WHERE c.study_id = s.id), 0)::bigint,
    COALESCE((SELECT SUM(c2.amount) FROM public.study_contributions c2 WHERE c2.study_id = s.id), 0)
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
  WHERE s.id = p_study_id;
END;
$$;

-- Permissions (PUBLIC: detail studie je veřejný)
REVOKE ALL ON FUNCTION public.get_study_detail(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_detail(uuid, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_study_detail(uuid, text) IS 'Public access function for study detail page with locale-aware name/description. Uses DEFAULT parameter to avoid overload ambiguity (PGRST203).';
