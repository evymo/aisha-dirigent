-- ============================================================================
-- Public implementation seed: aisha
-- ============================================================================
-- This is public, non-sensitive SoT for the "aisha" implementation of the
-- AISHA platform. It intentionally avoids production operators, customer data,
-- private web templates and upgrade-only rebrand UPDATEs.
-- ============================================================================

-- Ensure the implementation has the stack default story expected by public web
-- bootstrapping. Client implementations seed their own equivalent story in
-- their private implementation layer or hook.
SELECT public.ensure_stack_default_story();

INSERT INTO public.audit_journal (user_id, action_type, action, area, severity, summary, metadata)
VALUES (
  NULL,
  'bootstrap',
  'our_aisha_default_story.seed',
  'content',
  'info',
  'Ensured stack default story for our aisha implementation',
  jsonb_build_object(
    'source', 'seed/implementations/aisha/05_our_aisha_default_story.sql',
    'implementation', 'aisha',
    'private_data', false
  )
)
ON CONFLICT DO NOTHING;
