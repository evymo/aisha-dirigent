-- View: public.audience_actor_overlay_v
-- Per-actor marketer overlay (notes, follow-ups, tags, assigned partner) composed from reused signals.

CREATE OR REPLACE VIEW public.audience_actor_overlay_v AS
 SELECT user_id AS actor_user_id,
    display_name,
    email,
    ( SELECT array_agg(jsonb_build_object('id', se.id, 'content', se.content, 'created_at', se.created_at, 'created_by', se.created_by) ORDER BY se.created_at DESC) AS array_agg
           FROM story_entries se
             JOIN partner_stories ps ON ps.id = se.story_id
          WHERE ps.user_id = p.user_id AND se.entry_type = 'actor_note'::text) AS notes,
    ( SELECT array_agg(jsonb_build_object('id', b.id, 'due_at', b.due_at, 'note', b.note, 'status', b.status, 'source_type', b.source_type) ORDER BY b.due_at) AS array_agg
           FROM story_pulse_beats b
          WHERE b.status = 'open'
            AND ((b.subject_type = 'actor' AND b.subject_id = p.user_id)
              OR (b.subject_type = 'twin' AND b.subject_id IN (
                    SELECT r.twin_id FROM twin_external_refs r
                     WHERE r.ref_kind = 'account' AND r.source_key = p.user_id::text
                       AND r.state = 'confirmed' AND r.valid_to IS NULL)))) AS pending_followups,
    ( SELECT array_agg(DISTINCT sl.label) AS array_agg
           FROM story_labels sl
          WHERE sl.resource_type = 'actor'::text AND sl.resource_id = p.user_id) AS tags,
    ( SELECT sc.partner_id
           FROM study_consultants sc
          WHERE sc.scope_type = 'actor'::text AND sc.study_id = p.user_id AND sc.role = 'account_manager'::consultant_role_enum AND sc.status = 'approved'::consultant_status_enum
         LIMIT 1) AS assigned_to_partner_id
   FROM profiles p;

COMMENT ON VIEW public.audience_actor_overlay_v IS
  'Composite "overlay" view emulating a per-actor marketer context record.
   Joins story_entries (notes), story_pulse_beats (open beats = follow-ups, ADR-003 K2), story_labels (tags),
   study_consultants (assigned_to). One row per actor. No new table needed.';
