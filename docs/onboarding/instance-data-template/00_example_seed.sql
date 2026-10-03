-- =============================================================================
-- 00_example_seed.sql — TEMPLATE instance SQL overlay
-- =============================================================================
-- Copy into your PRIVATE instance-data repo as a top-level NN_*.sql file. Files
-- apply in filename order (00_, 01_, 02_ …) inside the core `migrate` container
-- on EVERY deploy, via scripts/deploy/instance-data-hook.sh.
--
-- CONTRACT — this runs many times, so it MUST be idempotent:
--   • every INSERT guarded with ON CONFLICT … DO UPDATE (or DO NOTHING)
--   • every DDL guarded with IF NOT EXISTS
--   • write ONLY your instance's own rows — never TRUNCATE/DROP platform tables
--   • no secrets as literals — reference env/Vault, never hardcode
--
-- The examples below are illustrative placeholders. Delete them and add your
-- instance's real content (adjust column lists to the live schema).
-- =============================================================================

-- Example A — a settings/config row keyed by a stable name (idempotent upsert).
-- Replace `instance_settings` + columns with a table that exists in your schema.
--
--   INSERT INTO public.instance_settings (key, value)
--   VALUES ('welcome_headline', 'Welcome to the Example instance')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Example B — seed a knowledge item. Author is a stable system actor resolved by
-- the platform seed; look up its id rather than hardcoding a UUID.
--
--   INSERT INTO public.knowledge_items (id, title, body, author_id)
--   VALUES (
--     'a0000000-0000-0000-0000-000000000001',  -- your own stable id
--     'Example knowledge item',
--     'Body text for the example instance.',
--     (SELECT id FROM aisha_auth.users WHERE email = 'system@aisha' LIMIT 1)
--   )
--   ON CONFLICT (id) DO UPDATE
--     SET title = EXCLUDED.title,
--         body  = EXCLUDED.body;

-- No-op guard so an all-commented template applies cleanly (0 rows, idempotent).
SELECT 1 WHERE false;
