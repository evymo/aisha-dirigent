-- Function: public.edge_public_partners_directory
-- Purpose: Edge-safe helpers for partners directory endpoint.

CREATE OR REPLACE FUNCTION public.edge_public_partners_directory(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_city text;
  v_limit integer;
BEGIN
  IF p_action = 'count_requests_authenticated' THEN
    RETURN jsonb_build_object(
      'count',
      (
        SELECT count(*)
        FROM public.audit_journal a
        WHERE a.action_type = 'view'
          AND a.area = 'partners'
          AND a.entity_type = 'partner_profiles'
          AND a.summary = COALESCE(NULLIF(p_payload ->> 'summary', ''), 'Partners directory queried')
          AND a.user_id = NULLIF(p_payload ->> 'user_id', '')::uuid
          AND a.created_at >= COALESCE(NULLIF(p_payload ->> 'since', '')::timestamptz, now() - interval '1 hour')
      )
    );
  END IF;

  IF p_action = 'count_requests_anonymous' THEN
    RETURN jsonb_build_object(
      'count',
      (
        SELECT count(*)
        FROM public.audit_journal a
        WHERE a.action_type = 'view'
          AND a.area = 'partners'
          AND a.entity_type = 'partner_profiles'
          AND a.summary = COALESCE(NULLIF(p_payload ->> 'summary', ''), 'Partners directory queried (anonymous)')
          AND (a.details ->> 'ip_hash') = NULLIF(p_payload ->> 'ip_hash', '')
          AND a.created_at >= COALESCE(NULLIF(p_payload ->> 'since', '')::timestamptz, now() - interval '1 hour')
      )
    );
  END IF;

  IF p_action = 'count_visible' THEN
    RETURN jsonb_build_object(
      'count',
      (
        SELECT count(*)
        FROM public.partner_profiles_public p
        WHERE p.is_visible = true
      )
    );
  END IF;

  IF p_action = 'get_partners' THEN
    v_city := NULLIF(btrim(COALESCE(p_payload ->> 'city', '')), '');
    v_limit := COALESCE(NULLIF(p_payload ->> 'limit', '')::integer, 20);
    v_limit := GREATEST(1, LEAST(100, v_limit));

    IF COALESCE((p_payload ->> 'authenticated')::boolean, false) THEN
      RETURN jsonb_build_object(
        'rows',
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'accepts_in_person_appointments', p.accepts_in_person_appointments,
                'accepts_online_appointments', p.accepts_online_appointments,
                'avatar_url', p.avatar_url,
                'business_name', p.business_name,
                'certification_level', p.certification_level,
                'certification_passed_at', p.certification_passed_at,
                'certification_score', p.certification_score,
                'city', p.city,
                'country', p.country,
                'created_at', p.created_at,
                'description', p.description,
                'display_name', p.display_name,
                'id', p.id,
                'is_production_provider', p.is_production_provider,
                'is_visible', p.is_visible,
                'services', p.services,
                'user_id', p.user_id,
                'website', p.website
              )
            )
            FROM (
              SELECT
                p.accepts_in_person_appointments,
                p.accepts_online_appointments,
                p.avatar_url,
                p.business_name,
                p.certification_level,
                p.certification_passed_at,
                p.certification_score,
                p.city,
                p.country,
                p.created_at,
                p.description,
                p.display_name,
                p.id,
                p.is_production_provider,
                p.is_visible,
                p.services,
                p.user_id,
                p.website
              FROM public.partner_profiles_public p
              WHERE p.is_visible = true
                AND (v_city IS NULL OR p.city = v_city)
              ORDER BY p.certification_level DESC, p.display_name
              LIMIT v_limit
            ) p
          ),
          '[]'::jsonb
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'accepts_in_person_appointments', p.accepts_in_person_appointments,
              'accepts_online_appointments', p.accepts_online_appointments,
              'avatar_url', p.avatar_url,
              'certification_level', p.certification_level,
              'city', p.city,
              'country', p.country,
              'display_name', p.display_name,
              'id', p.id,
              'is_production_provider', p.is_production_provider
            )
          )
          FROM (
            SELECT
              p.accepts_in_person_appointments,
              p.accepts_online_appointments,
              p.avatar_url,
              p.certification_level,
              p.city,
              p.country,
              p.display_name,
              p.id,
              p.is_production_provider
            FROM public.partner_profiles_public p
            WHERE p.is_visible = true
              AND (v_city IS NULL OR p.city = v_city)
            ORDER BY p.certification_level DESC, p.display_name
            LIMIT v_limit
          ) p
        ),
        '[]'::jsonb
      )
    );
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_public_partners_directory(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_public_partners_directory(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_public_partners_directory(text, jsonb) TO authenticated;
