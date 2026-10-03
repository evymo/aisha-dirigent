-- View: public.audience_actor_tier_v
-- Computed member tier per user — DERIVED, never stored.

CREATE OR REPLACE VIEW public.audience_actor_tier_v AS
 SELECT p.user_id,
    p.display_name,
    p.email,
        CASE
            WHEN pp.is_visible AND pp.is_production_provider THEN 'partner'::text
            WHEN pp.is_certified THEN 'qualified'::text
            WHEN COALESCE(ea.app_accesses_30d, 0) > 0 THEN 'active'::text
            ELSE 'registered'::text
        END AS member_tier,
    m.tier AS membership_tier,
    m.status AS membership_status,
    pp.certification_level,
    pp.certification_passed_at,
    pp.business_name,
    pp.services AS specializations,
    ea.audience_size,
    ea.last_active_at
   FROM profiles p
     LEFT JOIN partner_profiles pp ON pp.user_id = p.user_id
     LEFT JOIN memberships m ON m.user_id = p.user_id
     LEFT JOIN audience_actor_aggregate_latest_v ea ON ea.user_id = p.user_id;

COMMENT ON VIEW public.audience_actor_tier_v IS
  'Computed member tier per user (anonymous|registered|active|qualified|partner).
   Tier is DERIVED, never stored — single source of truth via this view.';
