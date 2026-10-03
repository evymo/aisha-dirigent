-- Index: idx_media_assets_created
-- Galerie vypisuje živé (nesmazané) záznamy od nejnovějšího.

CREATE INDEX IF NOT EXISTS idx_media_assets_created
  ON public.media_assets USING btree (created_at DESC) WHERE deleted_at IS NULL;
