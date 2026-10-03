-- ============================================================================
-- Index: idx_twin_relation_proposals_group_state — „co v té skupině ještě čeká"
-- ============================================================================
-- Obě cesty, které návrhy čtou, jdou přes skupinu: fronta počítá čekající členy
-- per skupina a rozhodnutí prochází členy jedné skupiny. Bez indexu by každé
-- kliknutí i každé vykreslení fronty četlo všechny návrhy všech zdrojů.
CREATE INDEX IF NOT EXISTS idx_twin_relation_proposals_group_state
  ON public.twin_relation_proposals (group_id, state);
