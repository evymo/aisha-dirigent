-- View: public.distribution_adjustments_overview
-- Description: Distribution adjustment summary with study and product context.

CREATE OR REPLACE VIEW public.distribution_adjustments_overview AS
SELECT
  da.id,
  da.adjustment_type,
  da.reason,
  da.new_dose_amount,
  da.new_doses_per_day,
  da.new_arm_code,
  da.effective_from,
  da.effective_until,
  da.consultant_note,
  da.is_active,
  da.created_at,
  da.member_token,
  u.email::text AS authorized_by_email,
  p.name AS product_name,
  s.name AS study_name
FROM distribution_adjustments da
LEFT JOIN aisha_auth.users u ON u.id = da.authorized_by
LEFT JOIN study_distribution_protocols sdp ON sdp.id = da.protocol_id
LEFT JOIN products p ON p.id = sdp.product_id
LEFT JOIN studies s ON s.id = sdp.study_id;
