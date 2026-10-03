-- Function: get_guild_members_marketplace
-- Purpose: Enhanced guild directory query with pricing, availability, activity metrics
-- Used by: GuildDirectory marketplace view

CREATE OR REPLACE FUNCTION get_guild_members_marketplace(
  p_expertise_slug text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL,
  p_max_hourly_rate numeric DEFAULT NULL,
  p_min_hourly_rate numeric DEFAULT NULL,
  p_availability_status text DEFAULT NULL,
  p_instant_booking boolean DEFAULT NULL,
  p_sort_by text DEFAULT 'relevance',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_build_object(
      'items', jsonb_agg(member_row),
      'total', (SELECT count(DISTINCT pp.id)
        FROM partner_profiles pp
        LEFT JOIN guild_member_expertise gme ON gme.partner_id = pp.id
        LEFT JOIN guild_expertise_areas gea ON gea.id = gme.expertise_area_id
        WHERE pp.is_visible = true
          AND pp.guild_tier IS NOT NULL
          AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
          AND (p_search IS NULL OR pp.display_name ILIKE '%' || p_search || '%'
               OR pp.expertise_summary ILIKE '%' || p_search || '%')
          AND (p_min_rating IS NULL OR pp.avg_rating >= p_min_rating)
      )
    )
    FROM (
      SELECT jsonb_build_object(
        'id', pp.id,
        'user_id', pp.user_id,
        'display_name', pp.display_name,
        'avatar_url', pp.avatar_url,
        'city', pp.city,
        'country', pp.country,
        'guild_tier', pp.guild_tier,
        'bio', pp.guild_bio,
        'expertise_summary', pp.expertise_summary,
        'avg_rating', pp.avg_rating,
        'total_ratings_count', pp.total_ratings_count,
        'completed_projects_count', pp.completed_projects_count,
        'last_active_at', pp.last_active_at,
        'accepts_online', pp.accepts_online_appointments,
        'accepts_in_person', pp.accepts_in_person_appointments,
        -- Pricing
        'hourly_rate', sp.hourly_rate,
        'min_block_hours', sp.min_block_hours,
        'block_price', COALESCE(sp.hourly_rate * sp.min_block_hours, 0),
        'currency', COALESCE(sp.currency, public.commerce_base_currency()),
        'instant_booking_enabled', COALESCE(sp.instant_booking, false),
        'availability_status', COALESCE(sp.availability_status::text, 'offline'),
        'response_time_hours', sp.response_time_hours,
        'conditions_text', sp.conditions_text,
        -- Activity metrics
        'activity_score', COALESCE(sam.activity_score, 0),
        'response_time_avg_hours', sam.response_time_avg_hours,
        'acceptance_rate', COALESCE(sam.acceptance_rate, 100),
        'rules_contributed_count', COALESCE(sam.rules_contributed_count, 0),
        -- Expertise areas (aggregated)
        'expertise', COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'slug', gea2.slug,
            'name', gea2.name_key,
            'is_primary', gme2.is_primary,
            'proficiency_level', gme2.proficiency_level
          ))
          FROM guild_member_expertise gme2
          JOIN guild_expertise_areas gea2 ON gea2.id = gme2.expertise_area_id
          WHERE gme2.partner_id = pp.id AND gea2.is_active = true),
          '[]'::jsonb
        ),
        -- Relevance score for sorting
        'relevance_score', (
          COALESCE(pp.avg_rating, 0) * 15
          + COALESCE(sam.activity_score, 0) * 0.3
          + CASE WHEN pp.guild_tier = 'grandmaster' THEN 50
                 WHEN pp.guild_tier = 'master' THEN 40
                 WHEN pp.guild_tier = 'expert' THEN 30
                 WHEN pp.guild_tier = 'journeyman' THEN 20
                 WHEN pp.guild_tier = 'apprentice' THEN 10
                 ELSE 0 END
          + COALESCE(pp.completed_projects_count, 0) * 2
          + CASE WHEN sp.availability_status = 'available' THEN 20
                 WHEN sp.availability_status = 'busy' THEN 5
                 ELSE 0 END
        )
      ) AS member_row
      FROM partner_profiles pp
      LEFT JOIN specialist_pricing sp ON sp.partner_id = pp.id AND sp.is_active = true
      LEFT JOIN specialist_activity_metrics sam ON sam.partner_id = pp.id
      WHERE pp.is_visible = true
        AND pp.guild_tier IS NOT NULL
        -- Filters
        AND (p_expertise_slug IS NULL OR pp.id IN (
          SELECT gme3.partner_id FROM guild_member_expertise gme3
          JOIN guild_expertise_areas gea3 ON gea3.id = gme3.expertise_area_id
          WHERE gea3.slug = p_expertise_slug
        ))
        AND (p_search IS NULL OR pp.display_name ILIKE '%' || p_search || '%'
             OR pp.expertise_summary ILIKE '%' || p_search || '%')
        AND (p_min_rating IS NULL OR pp.avg_rating >= p_min_rating)
        AND (p_max_hourly_rate IS NULL OR sp.hourly_rate IS NULL
             OR sp.hourly_rate <= p_max_hourly_rate)
        AND (p_min_hourly_rate IS NULL OR sp.hourly_rate IS NULL
             OR sp.hourly_rate >= p_min_hourly_rate)
        AND (p_availability_status IS NULL
             OR sp.availability_status::text = p_availability_status)
        AND (p_instant_booking IS NULL
             OR sp.instant_booking = p_instant_booking)
      ORDER BY
        CASE WHEN p_sort_by = 'relevance' THEN (
          COALESCE(pp.avg_rating, 0) * 15
          + COALESCE(sam.activity_score, 0) * 0.3
          + CASE WHEN pp.guild_tier = 'grandmaster' THEN 50
                 WHEN pp.guild_tier = 'master' THEN 40
                 WHEN pp.guild_tier = 'expert' THEN 30
                 WHEN pp.guild_tier = 'journeyman' THEN 20
                 WHEN pp.guild_tier = 'apprentice' THEN 10
                 ELSE 0 END
          + COALESCE(pp.completed_projects_count, 0) * 2
        ) END DESC NULLS LAST,
        CASE WHEN p_sort_by = 'price_asc' THEN sp.hourly_rate END ASC NULLS LAST,
        CASE WHEN p_sort_by = 'price_desc' THEN sp.hourly_rate END DESC NULLS LAST,
        CASE WHEN p_sort_by = 'rating' THEN pp.avg_rating END DESC NULLS LAST,
        CASE WHEN p_sort_by = 'activity' THEN sam.activity_score END DESC NULLS LAST,
        pp.display_name ASC
      LIMIT p_limit OFFSET p_offset
    ) sub),
    jsonb_build_object('items', '[]'::jsonb, 'total', 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION get_guild_members_marketplace(text,text,numeric,numeric,numeric,text,boolean,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guild_members_marketplace(text,text,numeric,numeric,numeric,text,boolean,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION get_guild_members_marketplace(text,text,numeric,numeric,numeric,text,boolean,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_guild_members_marketplace(text,text,numeric,numeric,numeric,text,boolean,text,integer,integer) TO service_role;
