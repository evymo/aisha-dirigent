-- ==============================================================================
-- Generic process templates — canonical seed (core layer)
-- ==============================================================================
-- ADR-003 (Jeden svět), program K2: WORK IS A RUN FROM A TEMPLATE. The kernel
-- ships exactly one template, and it carries no domain noun: `follow-up` is a
-- single human milestone owed by an assignee by a due date. The audience
-- module's audience_admin_create_followup opens a run from it, so a follow-up
-- is the same kind of thing as an onboarding step or a delivery handover —
-- visible in the tower, in "my steps" and in progress, settled through the one
-- write path (complete_workflow_step) — instead of a row in a task table.
--
-- Instances name their own journeys (onboarding, care cycle, re-engagement…)
-- in their overlay; they may also override this one by name.
--
-- The whole node travels into production_workflow_steps.input_data (see
-- create_production_workflow_steps_from_template), so `beat_type` here is what
-- the step↔beat joint (workflow_step_open_beat) reads.
--
-- Idempotent: `name` has no unique constraint, so the guard is NOT EXISTS.
-- ==============================================================================

INSERT INTO public.production_workflow_templates
  (id, name, description, product_type, steps, workflow_steps, is_active, is_default, version,
   name_key, description_key, current_version_number)
SELECT
  '00000000-0000-4000-8000-00000000f011'::uuid,
  'follow-up',
  'Generic single-node follow-up: one human milestone owed by an assignee by a due date. Kernel template for the audience module; instances name their own journeys.',
  'generic',
  '[{"step_code":"follow_up","step_name":"Follow-up","step_order":1,"description":"Reach the subject and record the outcome.","beat_type":"follow_up"}]'::jsonb,
  '[{"step_code":"follow_up","step_name":"Follow-up","step_order":1,"description":"Reach the subject and record the outcome.","beat_type":"follow_up"}]'::jsonb,
  true,
  false,
  '1',
  'workflow.templates.follow_up.name',
  'workflow.templates.follow_up.description',
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public.production_workflow_templates t WHERE t.name = 'follow-up'
);
