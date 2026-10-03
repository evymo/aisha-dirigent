-- Function: public.get_extended_studies
-- Arguments: p_locale text DEFAULT 'en'
-- Description: Public list of active studies with funding/participation counts.
--   Locale-aware name/description via LEFT JOIN on translations table.
-- Security: SECURITY DEFINER — public study listing.

DROP FUNCTION IF EXISTS public.get_extended_studies();
DROP FUNCTION IF EXISTS public.get_extended_studies(text);

CREATE OR REPLACE FUNCTION public.get_extended_studies(p_locale text DEFAULT 'en')
 RETURNS TABLE(id uuid, code text, name text, description text, study_type text, target_condition text, products text[], duration_weeks integer, target_registration integer, current_registration integer, is_blinded boolean, is_active boolean, is_umbrella boolean, starts_at timestamptz, ends_at timestamptz, protocol_url text, funding_goal numeric, current_funding numeric, funding_deadline timestamptz, funding_status text, min_participants integer, max_participants integer, created_at timestamptz, updated_at timestamptz, consultant_count bigint, contribution_count bigint, total_contributed numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    (COALESCE(s.is_umbrella, false) OR s.code = 'umbrella') AS is_umbrella,
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
    COALESCE((SELECT COUNT(*) FROM public.study_contributions sc WHERE sc.study_id = s.id AND sc.status = 'completed'), 0)::bigint,
    COALESCE((SELECT SUM(sc.amount) FROM public.study_contributions sc WHERE sc.study_id = s.id AND sc.status = 'completed'), 0)
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
  ORDER BY (COALESCE(s.is_umbrella, false) OR s.code = 'umbrella') DESC, s.created_at DESC;
END;
$function$
;

-- Permissions (PUBLIC: přehled studií je veřejný)
REVOKE ALL ON FUNCTION public.get_extended_studies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_extended_studies(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_extended_studies(text) TO authenticated;

COMMENT ON FUNCTION public.get_extended_studies(text) IS 'Public list of active studies with locale-aware name/description. Uses DEFAULT parameter to avoid overload ambiguity (PGRST203).';
