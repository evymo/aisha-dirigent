-- Table: twin_relations — hrany twinsverse S PLATNOSTÍ (osa B: příslušnost)
--
-- Vztah mezi dvojčaty je FAKT S INTERVALEM PLATNOSTI, ne vlastnost entity.
-- Čte se „source —relation_kind→ target" (místo —part_of→ nadřazené místo,
-- osoba —member_of→ skupina, subjekt —responsible_for→ uzel).
--
-- PROČ HRANA A NE SLOUPEC: příslušnost jako hodnota na entitě umí říct jen
-- „teď". Neumí souběh (subjekt patří do N skupin najednou), neumí historii
-- („kam patřil k rozhodnému dni") a přesun znamená PŘEPIS — stará pravda
-- zmizí. Hrana s platností umí všechno trojí: přesun = uzavřít starou hranu
-- + založit novou; historie zůstává zdarma; publikum, auditorium i elektorát
-- se pak odvozují K DATU (derive_audience), ne ze snapshotu.
--
-- PROČ NE graph_edges: to je znalostní graf (Hippocampus RAG) — uzavřený výčet
-- vztahů, confidence, bez platnosti. Tohle je substrát reality; jiná otázka,
-- jiná tabulka.
--
-- relation_kind je VOLNÝ SLUG jako twin_entities.entity_type: druhy vztahů
-- definují instance data, ne jádro. Platforma vynucuje jen tvar (neprázdný).
--
-- EXCLUDE brání PŘEKRYVU téže hrany (source, target, kind) v čase — dvě
-- současně platné kopie téhož vztahu jsou duplicitní pravda, ne souběh.
-- Souběh je legitimní přes RŮZNÉ cíle nebo RŮZNÉ druhy. Vyžaduje btree_gist
-- (v baseline je).
--
-- Zápis: POUZE přes definer RPC (twin_relation_open_admin/_close_admin, ingest
-- driver) — přímý zápis nemá INSERT policy záměrně; hrana bez auditní stopy
-- by byla nárok bez důkazu.

CREATE TABLE IF NOT EXISTS public.twin_relations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_twin_id  uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  target_twin_id  uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  relation_kind   text         NOT NULL,
  valid_from      timestamptz  NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_relations_kind_not_blank CHECK (btrim(relation_kind) <> ''),
  CONSTRAINT twin_relations_no_self_loop   CHECK (source_twin_id <> target_twin_id),
  CONSTRAINT twin_relations_interval_sane  CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- táž hrana nesmí platit dvakrát současně; '[)' aby na sebe intervaly
  -- navazovaly beze spáry i bez překryvu (uzavřít v T a založit od T je legální)
  CONSTRAINT twin_relations_no_overlap EXCLUDE USING gist (
    source_twin_id WITH =,
    target_twin_id WITH =,
    relation_kind  WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  )
);

COMMENT ON TABLE public.twin_relations IS
  'Hrany twinsverse s intervalem platnosti (osa B: příslušnost). Přesun = uzavřít + založit; historie zůstává. Čte se source —kind→ target.';
COMMENT ON COLUMN public.twin_relations.relation_kind IS
  'Volný slug druhu vztahu (part_of/member_of/responsible_for…) — druhy definují instance data, ne jádro; stejný princip jako twin_entities.entity_type.';
COMMENT ON COLUMN public.twin_relations.valid_to IS
  'NULL = hrana platí. Uzavření hrany NENÍ smazání — „kam patřil k rozhodnému dni" musí zůstat zodpověditelné.';
COMMENT ON COLUMN public.twin_relations.metadata IS
  'Důkazní stopa a doplňky (odkud hrana pochází — návrh, potvrzení, zdroj). Autoritativní hodnoty parametrů patří do observations, ne sem.';

-- Indexy mají VLASTNÍ soubory (sql/indexes/idx_twin_relations_*) — dva částečné
-- nad oběma konci hrany a jeden rozsahový GiST pro dotazy k datu. Oddělení
-- vynucuje brána sql-source-separation a je to správně: index je samostatné
-- rozhodnutí s vlastním zdůvodněním, ne detail tabulky.

ALTER TABLE public.twin_relations ENABLE ROW LEVEL SECURITY;
