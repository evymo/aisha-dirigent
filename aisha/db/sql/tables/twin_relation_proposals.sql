-- Table: twin_relation_proposals — NÁVRH hrany twinsverse čekající na člověka
--
-- DOKTRÍNA (majitel 2026-09-28): vazby mezi zdroji NAVRHUJE systém sám
-- a SCHVALUJE člověk. Návrh je DŮKAZ, ne fakt: z tohohle řádku nikdy nevzniká
-- hrana sama od sebe. Hranu v twin_relations otevře až rozhodnutí
-- (twin_relation_proposal_decide) — a to týmž zápisovým místem jako ruční
-- vazba (twin_relation_open_admin), takže platí jedno pravidlo překryvu
-- a jedna auditní stopa.
--
-- PROČ NE li_relation_suggestions: ta nese souběh PARAMETRŮ uvnitř dokladu
-- („protistrana souvisí s plochou"), tedy tvrzení o slovníku, ne hranu mezi
-- dvěma konkrétními dvojčaty. Naměřeno 2026-09-28: 1 735 řádků, žádný čtenář,
-- žádný stav rozhodnutí. Míchat do ní hrany by spojilo dvě otázky pod jednu
-- tabulku a obě by se četly špatně.
--
-- PROČ NE stav přímo na twin_relations: každý čtenář hran (twin_graph_
-- descendants, publikum, bloky) by musel začít filtrovat „jen potvrzené"
-- a první, kdo zapomene, prohlásí návrh za fakt. Fakt a návrh bydlí zvlášť.
--
-- ROZHODNUTÍ JE LEPKAVÉ: opakovaný návrh téhož proposal_key NEOŽIVÍ zamítnutý
-- ani nepřepíše schválený — lidské „ne" se nevrací (týž princip jako
-- twin_propose_identity_by_signals). Aktualizuje se jen ČEKAJÍCÍ návrh.
--
-- relation_kind je volný slug jako v twin_relations (druhy definují instance
-- data); tvar hlídá CHECK stejný jako li_relation_suggestions.

CREATE TABLE IF NOT EXISTS public.twin_relation_proposals (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid         NOT NULL REFERENCES public.twin_relation_proposal_groups(id) ON DELETE CASCADE,
  proposal_key    text         NOT NULL,
  source_twin_id  uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  target_twin_id  uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  relation_kind   text         NOT NULL,
  valid_from      timestamptz,
  confidence      numeric,
  evidence        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  state           text         NOT NULL DEFAULT 'proposed',
  relation_id     uuid         REFERENCES public.twin_relations(id) ON DELETE SET NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_relation_proposals_key_unique UNIQUE (proposal_key),
  CONSTRAINT twin_relation_proposals_key_not_blank CHECK (btrim(proposal_key) <> ''),
  CONSTRAINT twin_relation_proposals_kind_shape CHECK (relation_kind ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT twin_relation_proposals_no_self_loop CHECK (source_twin_id <> target_twin_id),
  CONSTRAINT twin_relation_proposals_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- 'superseded' = v okamžiku návrhu už totéž PLATILO jako fakt (hrana existuje);
  -- návrh se neztrácí, ale do fronty nepatří — nic k rozhodnutí.
  CONSTRAINT twin_relation_proposals_state_vocab
    CHECK (state IN ('proposed', 'approved', 'rejected', 'superseded')),
  CONSTRAINT twin_relation_proposals_decision_complete
    CHECK (state <> 'approved' OR relation_id IS NOT NULL)
);

COMMENT ON TABLE public.twin_relation_proposals IS
  'Návrh hrany mezi dvojčaty s důkazem — advisory, dokud ho člověk nerozhodne. Hranu otevře jen twin_relation_proposal_decide.';
COMMENT ON COLUMN public.twin_relation_proposals.proposal_key IS
  'Idempotentní klíč navrhovatele; opakovaný návrh aktualizuje jen ČEKAJÍCÍ řádek, rozhodnutí je lepkavé.';
COMMENT ON COLUMN public.twin_relation_proposals.valid_from IS
  'Od kdy zdroj vazbu tvrdí (např. začátek období sešitu). NULL = od okamžiku schválení.';
COMMENT ON COLUMN public.twin_relation_proposals.evidence IS
  'Co se s čím shodlo a kde (doklad, list, řádek, druh shody). Hodnota ze zdroje, ne závěr.';
COMMENT ON COLUMN public.twin_relation_proposals.relation_id IS
  'Hrana, kterou schválení otevřelo (nebo která už platila). NULL u čekajících a zamítnutých.';

ALTER TABLE public.twin_relation_proposals ENABLE ROW LEVEL SECURITY;
