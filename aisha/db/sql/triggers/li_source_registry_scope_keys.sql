-- Trigger: li_source_registry_scope_keys
-- Source of truth pair: aisha/db/sql/functions/fn_li_source_registry_scope_keys.sql
-- AFTER (klíč odkazuje na source_sha256 řádku, který už musí existovat); jen při
-- změně sloupců, na kterých klíče závisí (raw_data nese původ — source_path) — ostatní zápisy ho nespouští.

DROP TRIGGER IF EXISTS li_source_registry_scope_keys ON public.li_source_registry;
CREATE TRIGGER li_source_registry_scope_keys
  AFTER INSERT OR UPDATE OF source_sha256, doc_slug, doc_type, doc_class, fields, raw_data, superseded_by
  ON public.li_source_registry
  FOR EACH ROW EXECUTE FUNCTION public.fn_li_source_registry_scope_keys();
