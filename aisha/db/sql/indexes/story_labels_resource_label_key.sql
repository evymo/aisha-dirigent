-- Index: story_labels_resource_label_key
-- Table: story_labels
-- Jedinečnost štítku nad ZDROJEM (účet, kampaň, kohorta): tentýž label nad týmž
-- resource_type/resource_id jen jednou. Částečný — legacy štítky příběhů mají
-- resource_id NULL a kryje je story_labels_story_id_label_key. Cíl ON CONFLICT
-- v audience_tag_resource / audience_admin_bulk_tag (2026-09-06, ADR-003 K4).
CREATE UNIQUE INDEX IF NOT EXISTS story_labels_resource_label_key
  ON public.story_labels USING btree (resource_type, resource_id, label)
  WHERE resource_id IS NOT NULL;
