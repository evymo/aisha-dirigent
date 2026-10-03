-- Archive document translation keys population
-- Populates _key columns on archive_documents from slug
-- Actual translation values are in 02_archive.sql
-- ============================================================================

-- 1. Populate all _key columns on archive_documents from slug
-- ============================================================================

UPDATE archive_documents SET title_key = 'archive.' || slug || '.title' WHERE title_key IS NULL;
UPDATE archive_documents SET description_key = 'archive.' || slug || '.description' WHERE description_key IS NULL;
UPDATE archive_documents SET summary_key = 'archive.' || slug || '.summary' WHERE summary_key IS NULL;
UPDATE archive_documents SET editorial_note_key = 'archive.' || slug || '.editorial_note' WHERE editorial_note_key IS NULL;
UPDATE archive_documents SET what_you_are_looking_at_key = 'archive.' || slug || '.what_you_are_looking_at' WHERE what_you_are_looking_at_key IS NULL;
UPDATE archive_documents SET standards_context_key = 'archive.' || slug || '.standards_context' WHERE standards_context_key IS NULL;
