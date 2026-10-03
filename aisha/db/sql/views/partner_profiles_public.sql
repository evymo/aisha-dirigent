-- View: public.partner_profiles_public
-- Description: Public subset of partner profiles.

CREATE OR REPLACE VIEW public.partner_profiles_public AS
SELECT
  id,
  user_id,
  display_name,
  avatar_url,
  business_name,
  description,
  website,
  city,
  country,
  certification_level,
  certification_passed_at,
  certification_score,
  is_production_provider,
  services,
  accepts_online_appointments,
  accepts_in_person_appointments,
  is_visible,
  created_at
FROM partner_profiles
WHERE is_visible = true;
