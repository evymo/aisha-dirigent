-- Index: idx_knowledge_chunks_text_trgm
--
-- Doslovné hledání ve znění dokumentů. Do 2026-07-30 nad chunky NEEXISTOVAL
-- žádný textový index (změřeno: 0 indexů s `to_tsvector`) — každý dotaz nad
-- knowledge_chunks byl sekvenční průchod.
--
-- PROČ TRIGRAMY, NE tsvector
-- Postgres na tomhle serveru nemá český slovník (pg_ts_config: 29 jazyků, čeština
-- mezi nimi není), takže `to_tsvector('czech', …)` neexistuje a `simple` by
-- neuměl skloňování — „nájemce / nájemci / nájemcem" by byla tři různá slova.
-- Trigramy skloňování snesou (společný kmen se shoduje) a nepotřebují slovník.
--
-- norm_text() je IMMUTABLE (ověřeno: provolatile='i'), takže smí být ve výrazu
-- indexu; skládá diakritiku a velikost písmen, aby „NÁJEMCE" našlo „najemce".
-- Hledání MUSÍ volat tentýž výraz, jinak index neplatí — proto je vedle indexu
-- v SoT i vyhledávací funkce, která ho používá.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_text_trgm
  ON public.knowledge_chunks
  USING gin (public.norm_text(chunk_text) gin_trgm_ops);
