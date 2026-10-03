-- ============================================================================
-- Source of Truth: knowledge_embedding_vynechani
-- Popis: Chunky, které platformní dopočet vektorů (POST /embeddings/v1-backfill)
--        pro danou ŽIVOU identitu embeddingu ZÁMĚRNĚ nezakódoval — a proč.
--
-- ⛔ PROČ (naměřeno na riq 2026-09-29): llama.cpp (svc-model) kóduje nejvýš n_batch
-- = 512 tokenů a delší vstup TIŠE ořízne — vektor by pak tvrdil, že nese celý chunk.
-- Dopočet proto text nad `declared.max_tokens` nezakóduje a zapíše ho SEM: bez
-- záznamu by ho vybíral v každé dávce znovu a frontu by ucpal. Klíčem je identita
-- (`gguf:<sha>`): nové váhy = nový pokus. Přeskládaný dokument dostane nová chunk_id
-- (clear_knowledge_item_chunks + zápis), takže starý záznam se ho netýká.
-- Pokrytí vektory (broker, metadata.pokryti_vektoru) je počítá zvlášť jako `nad_limitem`.
-- RLS: ENABLED — jen service_role (zápis fn_record_embedding_vynechani).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.knowledge_embedding_vynechani (
  chunk_id    uuid         NOT NULL,
  locale      text         NOT NULL DEFAULT 'global',
  identita    text         NOT NULL,
  duvod       text         NOT NULL,
  tokenu      integer,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, locale, identita),
  CONSTRAINT knowledge_embedding_vynechani_duvod_check CHECK (duvod IN ('nad_limitem'))
);

ALTER TABLE public.knowledge_embedding_vynechani ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.knowledge_embedding_vynechani IS 'Chunky, které dopočet vektorů pro živou identitu (gguf:<sha>) záměrně nezakódoval (nad_limitem = delší než max_tokens, llama.cpp by tiše ořízl)';
