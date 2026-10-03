-- Index: idx_kmm_pages_embedding_v2
--
-- NB: the opclass is referenced UNQUALIFIED, matching its sibling
-- idx_knowledge_embeddings_v2_vector. The `vector` extension lives in `extensions`
-- on a fresh baseline (CREATE EXTENSION … WITH SCHEMA "extensions"), so the opclass
-- is extensions-resident; a `public.`-qualified reference is unresolvable on a
-- from-zero DB. Unqualified + the DB-level search_path (public, extensions) resolves
-- it whether vector ended up in public (image init) or extensions (baseline) — the
-- prerequisite for AISHA_DB_FORCE_BASELINE_RESET to work without a manual recipe.

CREATE INDEX idx_kmm_pages_embedding_v2 ON public.knowledge_multimodal_pages USING hnsw (embedding_v2 halfvec_cosine_ops) WITH (m='16', ef_construction='64');
