-- Index: idx_li_relation_suggestions_reach
-- Table: li_relation_suggestions

CREATE INDEX IF NOT EXISTS idx_li_relation_suggestions_reach ON public.li_relation_suggestions (entities_reached DESC NULLS LAST);
