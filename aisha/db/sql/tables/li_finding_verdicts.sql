-- ============================================================================
-- Source of Truth: li_finding_verdicts
-- Popis: Odpověď člověka na DOTAZ NA PRAVDU — jeden řádek na pravidlo × druh
--        nálezu, ne na doklad.
--
-- ⭐ PROČ NE SLOUPEC V li_findings. Nález je jeden na DOKLAD (79 řádků na
-- produkci 2026-09-28, z toho 43× „součet položek nesedí" nad vydanými
-- fakturami). Člověk se ale nerozhoduje o dokladu, rozhoduje o TVRZENÍ PRAVIDLA:
-- „DUZP má být dřív než vystavení" buď u nájmů platí, nebo ne — a platí to
-- stejně pro první i pro čtyřicátý doklad. Verdikt u jednotlivého nálezu by
-- znamenal odpovídat 43× na tutéž otázku a nový doklad od ingestu by se ptal
-- znovu. Klíčem je proto (rule_key, finding); nálezy dokladů zůstávají
-- v li_findings jako důkaz pod dotazem.
--
-- question_id = li_finding_question_id(rule_key, finding) — deterministický,
-- takže ho vydá čtecí blok i bez řádku v téhle tabulce (dotaz bez odpovědi
-- tu řádek NEMÁ). Zápis jen submit_evidence_review_audited (větev 'finding').
-- RLS: ENABLED — čtení admin/staff (jako li_findings), zápis jen přes RPC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.li_finding_verdicts (
  question_id     uuid         PRIMARY KEY,
  rule_key        text,
  finding         text         NOT NULL,
  decision        text         NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz  NOT NULL DEFAULT now(),
  decided_note    text,
  -- Kolik dokladů dotaz v okamžiku odpovědi zahrnoval a na jakém příkladu se
  -- odpovídalo. Bez toho by po dalším ingestu nešlo zpětně říct, o čem člověk
  -- vlastně rozhodl.
  documents_count integer      NOT NULL DEFAULT 0,
  example         jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT li_finding_verdicts_decision_check
    CHECK (decision IN ('confirmed', 'rejected'))
);

COMMENT ON TABLE public.li_finding_verdicts IS 'Odpověď na dotaz na pravdu nad skupinou nálezů (rule_key × finding); zápis jen submit_evidence_review_audited, větev finding';
COMMENT ON COLUMN public.li_finding_verdicts.question_id IS 'li_finding_question_id(rule_key, finding) — deterministický, dotaz bez odpovědi řádek nemá';
COMMENT ON COLUMN public.li_finding_verdicts.decision IS 'confirmed = nález platí (je to chyba v dokladech); rejected = pravidlo tu neplatí (planý poplach)';
COMMENT ON COLUMN public.li_finding_verdicts.documents_count IS 'Počet dotčených dokladů v okamžiku odpovědi';
COMMENT ON COLUMN public.li_finding_verdicts.example IS 'Příklad, nad kterým člověk odpovídal (položka dotazu v okamžiku odpovědi)';

ALTER TABLE public.li_finding_verdicts ENABLE ROW LEVEL SECURITY;
