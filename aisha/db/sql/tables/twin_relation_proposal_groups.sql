-- Table: twin_relation_proposal_groups — JEDNOTKA ROZHODNUTÍ nad návrhy hran
--
-- Návrh vazby mezi dvojčaty se rozhoduje PO SKUPINÁCH (rozhodnutí majitele
-- 2026-09-28: „po skupinách"). Skupina je to, co člověk umí posoudit jedním
-- pohledem: „těchto 19 podružných měřidel visí pod elektroměrem zásuvek
-- v Mlýně" je JEDNA otázka se stejným důkazem, ne devatenáct. Nejistý návrh
-- (smlouva ↔ jednotka podle plochy) je prostě skupina o jednom členu — tvar
-- zůstává jeden, liší se jen velikost.
--
-- PROČ VLASTNÍ ŘÁDEK A NE JEN group_key NA NÁVRZÍCH: fronta (review_queue)
-- a dispečer rozhodnutí (submit_evidence_review_audited) adresují položku
-- UUID-em. Skupina tedy potřebuje identitu, kterou lze poslat tam a zpátky;
-- odvozovat ji z nejmenšího id členů by znamenalo, že přidání člena změní,
-- o čem člověk rozhoduje.
--
-- group_key je idempotentní klíč NAVRHOVATELE (zdroj + pravidlo + předmět):
-- opakovaný běh téhož navrhovatele trefí tutéž skupinu, nevyrobí druhou.
-- Stav skupiny se NEUKLÁDÁ — odvozuje se ze členů (kolik čeká, kolik
-- rozhodnuto). Uložený stav by se rozešel se členy při prvním dalším návrhu.
--
-- Zápis: POUZE přes definer RPC (twin_relation_propose). Bez INSERT policy.

CREATE TABLE IF NOT EXISTS public.twin_relation_proposal_groups (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key   text         NOT NULL,
  source      text         NOT NULL,
  rule_key    text         NOT NULL,
  title       text,
  evidence    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_relation_proposal_groups_key_unique UNIQUE (group_key),
  CONSTRAINT twin_relation_proposal_groups_key_not_blank CHECK (btrim(group_key) <> ''),
  CONSTRAINT twin_relation_proposal_groups_source_not_blank CHECK (btrim(source) <> ''),
  CONSTRAINT twin_relation_proposal_groups_rule_not_blank CHECK (btrim(rule_key) <> '')
);

COMMENT ON TABLE public.twin_relation_proposal_groups IS
  'Jednotka rozhodnutí nad návrhy hran (review_queue položka). Stav se odvozuje ze členů, neukládá se.';
COMMENT ON COLUMN public.twin_relation_proposal_groups.group_key IS
  'Idempotentní klíč navrhovatele (zdroj + pravidlo + předmět) — opakovaný běh trefí tutéž skupinu.';
COMMENT ON COLUMN public.twin_relation_proposal_groups.source IS
  'Kdo navrhuje (kanál/zdroj, např. sez-vyuctovani, local-ingest). Skupinu jednoho navrhovatele jiný nepřepíše.';
COMMENT ON COLUMN public.twin_relation_proposal_groups.title IS
  'Čitelný popis předmětu skupiny od navrhovatele (DATA ze zdroje, ne prezentace platformy).';
COMMENT ON COLUMN public.twin_relation_proposal_groups.evidence IS
  'Důkaz společný celé skupině (list, řádky, kontrolní součty zdroje…). Hodnota, ne závěr.';

ALTER TABLE public.twin_relation_proposal_groups ENABLE ROW LEVEL SECURITY;
