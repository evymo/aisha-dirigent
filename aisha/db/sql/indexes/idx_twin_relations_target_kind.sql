-- ============================================================================
-- Index: idx_twin_relations_target_kind — „kdo patří POD tenhle uzel"
-- ============================================================================
-- Pohled od cíle hrany — tudy jezdí rekurzivní sjezd `twin_graph_descendants`
-- (JOIN r.target_twin_id = w.twin_id) a na něm bude stát derive_audience:
-- publikum, auditorium i elektorát. Bez něj je každá úroveň sjezdu sekvenční
-- průchod celou hranovou tabulkou.
--
-- Částečný (WHERE valid_to IS NULL) ze stejného důvodu jako sesterský index nad
-- zdrojem: aktivní hrany jsou většina dotazů, uzavřené rostou donekonečna.
CREATE INDEX IF NOT EXISTS idx_twin_relations_target_kind
  ON public.twin_relations (target_twin_id, relation_kind) WHERE valid_to IS NULL;
