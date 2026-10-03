-- Table: story_pulse_beats
-- RLS: ENABLED
--
-- The BEAT — the missing carrier of the twin pulse.
--
-- A digital twin is not a passive card: it carries a REGIME (what should hold
-- — a dosing plan, a practice programme, a service interval, a campaign
-- cadence), and from that regime the system generates work. The four strokes
-- are REGIME → BEAT → CONFIRMATION → RECOMPUTE, and three of them already had
-- carriers here: the regime stays legitimately domain-shaped (member_product_
-- plans, production_milestones, operational_assessments, questionnaires…), the
-- confirmation is a typed row on the polymorphic story_entries axis, and the
-- recompute is the existing per-domain scoring (member_compliance_scores, tier
-- derivation, health states).
--
-- The BEAT had none. It is the domain-free statement "subject X owes an action
-- of type T by time D, and person P is the one who owes it". Neither existing
-- reminder table can express it:
--   * user_reminders.user_id is NOT NULL and is simultaneously the subject and
--     the addressee. That conflation is fine while the subject is the person
--     who acts, and impossible the moment it is not: a machine's service cycle
--     has no user_id, and its beat is owed by a technician. Same for a batch
--     awaiting an assessment, or a member a coordinator must call.
--   * story_reminders is story-axis only (story_id + partner_id, both NOT NULL)
--     and carries no addressee at all.
-- Hence one new carrier, deliberately generic: the SAME polymorphic axis as
-- story_entries (subject_type, subject_id — no FK, integrity enforced by the
-- writing RPC per subject_type), an open beat_type discriminator, and an
-- addressee that is separate from the subject.
--
-- Delivery is NOT this table's job. A beat is the ledger of what is owed;
-- how someone is told (push, e-mail, an operator queue screen) stays with the
-- existing notification paths, so introducing beats cannot double-send.
--
-- assigned_to_user_id carries a real FK ON DELETE SET NULL on purpose: any
-- consumer that fans a beat out to notifications would otherwise be one
-- dangling uuid away from a permanent failure, and an unroutable beat must
-- degrade to "unassigned", never to a poisoned queue.

CREATE TABLE IF NOT EXISTS story_pulse_beats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  beat_type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz NOT NULL,
  assigned_to_user_id uuid,
  source_type text,
  source_id uuid,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  closing_entry_id uuid,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT story_pulse_beats_status_chk CHECK (status IN ('open', 'done', 'cancelled')),
  CONSTRAINT story_pulse_beats_closed_chk CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT story_pulse_beats_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT story_pulse_beats_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT story_pulse_beats_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT story_pulse_beats_closing_entry_id_fkey FOREIGN KEY (closing_entry_id) REFERENCES story_entries(id) ON DELETE SET NULL
);

COMMENT ON TABLE story_pulse_beats IS 'The BEAT of the twin pulse: subject X owes an action of type T by time D, owed by person P. Domain-free; the regime that generated it stays domain-shaped and is referenced by (source_type, source_id).';
COMMENT ON COLUMN story_pulse_beats.subject_type IS 'Polymorphic subject kind, same axis as story_entries: actor | story | equipment | batch | … (no FK — the writing RPC validates per kind).';
COMMENT ON COLUMN story_pulse_beats.subject_id IS 'Polymorphic subject id — the twin that owes the action.';
COMMENT ON COLUMN story_pulse_beats.beat_type IS 'Open discriminator of what is owed (follow_up, dose, service_check, assessment, …). Seeded per implementation, never CHECKed here.';
COMMENT ON COLUMN story_pulse_beats.assigned_to_user_id IS 'WHO owes the action — separate from the subject on purpose (a machine cannot act for itself). NULL = not routed yet.';
COMMENT ON COLUMN story_pulse_beats.source_type IS 'Provenance: which regime produced this beat (member_product_plan, production_milestone, audience_followup, …).';
COMMENT ON COLUMN story_pulse_beats.closing_entry_id IS 'The story_entries row that recorded the confirmation — the beat points at its own proof.';

ALTER TABLE story_pulse_beats ENABLE ROW LEVEL SECURITY;
