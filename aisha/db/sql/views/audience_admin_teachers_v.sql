-- View: public.audience_admin_teachers_v
-- Lovable-compat: instructor/partner-tier contacts with a specialization.

CREATE OR REPLACE VIEW public.audience_admin_teachers_v AS
 SELECT user_id,
    display_name,
    email,
    preferred_language AS language,
    member_tier,
    specializations,
    business_name,
    audience_size,
    last_active_at,
    tags
   FROM audience_admin_contact_directory_v c
  WHERE (member_tier = ANY (ARRAY['qualified'::text, 'partner'::text])) OR specializations IS NOT NULL;
