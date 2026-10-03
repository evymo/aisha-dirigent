-- ============================================================================
-- Index: idx_twin_relations_source_kind — „kam patří TENHLE subjekt"
-- ============================================================================
-- Pohled od zdroje hrany: do jakých celků/skupin subjekt patří. Tenhle směr
-- se ptá povrch (co vidí přihlášený člověk) a nárok na doklady.
--
-- Částečný (WHERE valid_to IS NULL): aktivní hrany jsou naprostá většina
-- dotazů, kdežto uzavřené hrany rostou donekonečna (uzavření NENÍ smazání).
-- Plný index by je nesl s sebou a zdražoval každý zápis; historické dotazy
-- k datu obsluhuje rozsahový index nad druhým koncem.
CREATE INDEX IF NOT EXISTS idx_twin_relations_source_kind
  ON public.twin_relations (source_twin_id, relation_kind) WHERE valid_to IS NULL;
