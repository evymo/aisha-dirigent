-- Index: idx_knowledge_items_source_slug_locale_unique
--
-- Structural prevention of source-identified knowledge_item duplication (the
-- chat-delegation x17 class, #547). A knowledge_item identified by source_slug is
-- unique PER LOCALE: two rows with the same (source_slug, locale) are duplicates,
-- while Brick4 locale variants of one slug coexist (same slug, different locale).
--
-- Partial WHERE source_slug IS NOT NULL — items without a source_slug (ad-hoc/manual
-- notes) are not slug-identified and are intentionally unconstrained. locale is
-- NOT NULL DEFAULT 'global', so the key has no NULL holes (a NULL locale would let
-- duplicates slip through, since SQL treats NULL as distinct).
--
-- A bare UNIQUE(source_slug) would be WRONG — it would forbid legitimate locale
-- variants. The existing idx_knowledge_items_source_unique constrains only guild_db
-- on (source_type, source_id, locale); manual items have NULL source_id and escape it
-- (that NULL-never-collides gap is exactly how chat-delegation duplicated). This index
-- closes the gap on the slug axis, for every source_type.
--
-- DROP first so re-application (baseline + the heals.sql \ir for existing DBs) is
-- idempotent. Existing DBs with pre-#547 duplicates are collapsed by the guarded heal
-- in aisha/db/heals.sql BEFORE this index is created.
DROP INDEX IF EXISTS public.idx_knowledge_items_source_slug_locale_unique;
CREATE UNIQUE INDEX idx_knowledge_items_source_slug_locale_unique
  ON public.knowledge_items USING btree (source_slug, locale)
  WHERE (source_slug IS NOT NULL);
