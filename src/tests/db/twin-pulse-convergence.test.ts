// ─────────────────────────────────────────────────────────────────────
// Twin pulse — the BEAT carrier, subject-side authorization, and the
// follow-up convergence (V4 gaps F2c + F18a)
// ─────────────────────────────────────────────────────────────────────
//
// Three things are pinned here, all of which were previously either broken or
// unprovable:
//
//   1. ATTRIBUTION (F18a). An operator action on an actor must land on THAT
//      ACTOR's timeline, authored by the operator. It used to land on the
//      operator's own story — the audit-to-story promotion can only build a
//      partner_story for partner-tier actors, so for everyone else the record
//      either went to the acting admin or nowhere. The polymorphic axis
//      (subject_type='actor') removes the need for a story row entirely.
//
//   2. AUTHORIZATION. create_pulse_beat_audited binds the SUBJECT, never the
//      addressee. Gating on "the beat is addressed to me" would let any caller
//      write onto a stranger's twin by addressing it to themselves — the
//      caller-controlled-id class closed in #797. Both refusals are asserted.
//
//   3. COMPLETION (F2c → ADR-003 K2). A follow-up is a RUN from the `follow-up`
//      template: creating it opens the run and the beat of its human node,
//      completing it goes through complete_workflow_step (the single write path
//      of work) and the step↔beat joint settles the beat. The old compatibility
//      ai_tasks row is gone — two truths about one piece of work were exactly
//      what K2 removed.
//
// Everything runs inside a transaction that ROLLs BACK — no persistent mutation.
// Offline (no reachable PG) the suite skips cleanly, exactly like its siblings.

import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

const OP = "a0000000-1111-4000-8000-00000000000a"; // operator (admin/staff)
const SUBJ = "b0000000-2222-4000-8000-00000000000b"; // the actor being worked on

/** Seed two users, make OP an admin, and act as `sub` via the PostgREST path. */
function asUser(sub: string): string {
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
}

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${OP}', 'pulse-op@test.local'),
  ('${SUBJ}', 'pulse-subject@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}

-- 1. operator opens a beat on the subject's twin
SELECT 'beat=' || public.create_pulse_beat_audited(
  'actor', '${SUBJ}', 'follow_up', now() + interval '2 days',
  '${OP}', 'manual', NULL, 'ring them back') AS out;

-- 2. the opening is a typed record on the SUBJECT's axis, authored by the operator
SELECT 'attribution=' || se.subject_type || '/' ||
       (se.subject_id = '${SUBJ}')::text || '/' ||
       (se.created_by = '${OP}')::text AS out
FROM public.story_entries se
WHERE se.entry_type = 'pulse_beat_opened' AND se.subject_id = '${SUBJ}'
ORDER BY se.created_at DESC LIMIT 1;

-- 3. re-opening the identical slot is idempotent (partial UNIQUE on the open slot)
SELECT 'reopen_same=' || (public.create_pulse_beat_audited(
  'actor', '${SUBJ}', 'follow_up',
  (SELECT due_at FROM public.story_pulse_beats WHERE subject_id = '${SUBJ}' ORDER BY created_at LIMIT 1),
  '${OP}', 'manual', NULL, 'ring them back')
  = (SELECT id FROM public.story_pulse_beats WHERE subject_id = '${SUBJ}' ORDER BY created_at LIMIT 1))::text AS out;
SELECT 'open_beats=' || count(*) AS out FROM public.story_pulse_beats WHERE subject_id = '${SUBJ}';

-- 4. closing writes the confirmation and links the beat to its own proof
SELECT 'closed_entry=' || (public.close_pulse_beat_audited(
  (SELECT id FROM public.story_pulse_beats WHERE subject_id = '${SUBJ}' ORDER BY created_at LIMIT 1),
  'done', 'spoke to them') IS NOT NULL)::text AS out;
SELECT 'beat_settled=' || b.status || '/' || (b.closing_entry_id IS NOT NULL)::text AS out
FROM public.story_pulse_beats b WHERE b.subject_id = '${SUBJ}' ORDER BY b.created_at LIMIT 1;
RESET ROLE;
ROLLBACK;
`);
}

// The verdicts are collected into a table rather than raised as NOTICEs:
// psqlMultiline returns stdout only, and a NOTICE goes to stderr — an assertion
// against it would pass while proving nothing.
function denyProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
CREATE TEMP TABLE pulse_probe(k text, v text) ON COMMIT DROP;
GRANT INSERT ON pulse_probe TO authenticated;
${asUser(SUBJ)}
DO $$
BEGIN
  PERFORM public.create_pulse_beat_audited('actor', '${OP}', 'follow_up', now(), NULL, 'manual', NULL, 'x');
  INSERT INTO pulse_probe VALUES ('cross_subject', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO pulse_probe VALUES ('cross_subject', 'DENIED');
END $$;
DO $$
BEGIN
  -- self-assignment must not buy authority over a stranger's twin
  PERFORM public.create_pulse_beat_audited('actor', '${OP}', 'follow_up', now(), '${SUBJ}', 'manual', NULL, 'x');
  INSERT INTO pulse_probe VALUES ('self_assign', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO pulse_probe VALUES ('self_assign', 'DENIED');
END $$;
RESET ROLE;
SELECT k || '=' || v AS out FROM pulse_probe ORDER BY k;
ROLLBACK;
`);
}

function followupProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
SELECT 'beat=' || public.audience_admin_create_followup('${SUBJ}', now() + interval '3 days', 'check in', '${OP}') AS out;
-- Od ADR-003 K2 je follow-up BĚH: takt visí na jeho kroku, ne na ai_tasks řádku.
SELECT 'linked_beat=' || count(*) AS out
FROM public.story_pulse_beats b
WHERE b.source_type = 'workflow_step' AND b.status = 'open'
  AND b.subject_id IN ('${SUBJ}', public.twin_for_account('${SUBJ}'));
SELECT 'no_ai_task=' || (count(*) = 0)::text AS out FROM public.ai_tasks WHERE task_type = 'follow_up';
SELECT 'completed=' || public.audience_admin_complete_followup(
  (SELECT id FROM public.story_pulse_beats WHERE status = 'open' ORDER BY created_at DESC LIMIT 1),
  'done and noted')::text AS out;
SELECT 'beat_status=' || b.status AS out
FROM public.story_pulse_beats b ORDER BY b.created_at DESC LIMIT 1;
SELECT 'step_status=' || s.status AS out
FROM public.production_workflow_steps s
  JOIN public.production_batches ba ON ba.id = s.batch_id
WHERE ba.batch_code LIKE 'follow-up:${SUBJ}%' ORDER BY s.step_order LIMIT 1;
RESET ROLE;
ROLLBACK;
`);
}

describe("twin pulse — beat carrier + follow-up convergence", () => {
  beforeAll(async () => {
    await reportTestCapabilities("twin pulse convergence");
  });

  it.skipIf(!dbAvailable)("records an operator action on the SUBJECT's timeline, not the operator's", () => {
    const out = probe();
    expect(out).toContain("attribution=actor/true/true");
  });

  it.skipIf(!dbAvailable)("is idempotent per open slot and settles with a linked confirmation", () => {
    const out = probe();
    expect(out).toContain("reopen_same=true");
    expect(out).toContain("open_beats=1");
    expect(out).toContain("closed_entry=true");
    expect(out).toContain("beat_settled=done/true");
  });

  it.skipIf(!dbAvailable)("binds authorization to the subject — self-assignment grants nothing", () => {
    const out = denyProbe();
    expect(out).toContain("cross_subject=DENIED");
    expect(out).toContain("self_assign=DENIED");
  });

  it.skipIf(!dbAvailable)("creates and completes a follow-up as a RUN, not a task row (F2c → ADR-003 K2)", () => {
    const out = followupProbe();
    expect(out).toContain("linked_beat=1");
    expect(out).toContain("no_ai_task=true");
    expect(out).toContain("completed=true");
    expect(out).toContain("beat_status=done");
    expect(out).toContain("step_status=completed");
  });
});
