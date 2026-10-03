-- View: public.audience_admin_contact_directory_v
-- Marketer contact directory (tier, overlay, engagement + communication stats).

CREATE OR REPLACE VIEW public.audience_admin_contact_directory_v AS
 SELECT p.user_id,
    p.display_name,
    p.email,
    p.phone,
    p.preferred_language,
    tier.member_tier,
    tier.membership_tier,
    tier.membership_status,
    tier.business_name,
    tier.specializations,
    tier.audience_size,
    tier.last_active_at,
    ovl.notes,
    ovl.pending_followups,
    ovl.tags,
    ovl.assigned_to_partner_id,
    ( SELECT count(*) AS count
           FROM openclaw_notifications o
          WHERE o.user_id = p.user_id AND o.created_at > (now() - '90 days'::interval)) AS communications_90d,
    ( SELECT max(o.created_at) AS max
           FROM openclaw_notifications o
          WHERE o.user_id = p.user_id) AS last_communication_at
   FROM profiles p
     LEFT JOIN audience_actor_tier_v tier ON tier.user_id = p.user_id
     LEFT JOIN audience_actor_overlay_v ovl ON ovl.actor_user_id = p.user_id;

COMMENT ON VIEW public.audience_admin_contact_directory_v IS
  'Main contact directory for marketer. One row per actor with tier, overlay
   (notes/tags/follow-ups/assigned_to), engagement summary, communication stats.
   Drives Appsmith "Contact Directory" template.';
