-- ============================================================================
-- PostgreSQL Seed: discussion post types (the STACK universals)
-- ============================================================================
-- The catalog that drives story_entries.entry_type (see entry_type_definitions).
-- These are the universal types every deployment gets. An IMPLEMENTATION adds
-- its own under aisha/db/seed/implementations/<impl>/ (same registry, ON CONFLICT).
-- Idempotent (ON CONFLICT upsert).
-- ============================================================================

INSERT INTO public.entry_type_definitions (entry_type, name_key, description_key, applies_to, sort_order) VALUES
  ('comment',  'discussion.type.comment.name',  'discussion.type.comment.desc',  '{}'::text[], 10),
  ('question', 'discussion.type.question.name', 'discussion.type.question.desc', '{}'::text[], 20)
ON CONFLICT (entry_type) DO UPDATE
  SET name_key = EXCLUDED.name_key, description_key = EXCLUDED.description_key,
      applies_to = EXCLUDED.applies_to, sort_order = EXCLUDED.sort_order, updated_at = now();

INSERT INTO public.translations (key, locale, namespace, value) VALUES
  ('discussion.type.comment.name',  'en', 'discussion', 'Comment'),
  ('discussion.type.comment.name',  'cs', 'discussion', 'Komentář'),
  ('discussion.type.comment.desc',  'en', 'discussion', 'A reply or remark in the thread.'),
  ('discussion.type.comment.desc',  'cs', 'discussion', 'Odpověď nebo poznámka ve vlákně.'),
  ('discussion.type.question.name', 'en', 'discussion', 'Question'),
  ('discussion.type.question.name', 'cs', 'discussion', 'Otázka'),
  ('discussion.type.question.desc', 'en', 'discussion', 'Ask the community a question.'),
  ('discussion.type.question.desc', 'cs', 'discussion', 'Položit komunitě otázku.')
ON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
