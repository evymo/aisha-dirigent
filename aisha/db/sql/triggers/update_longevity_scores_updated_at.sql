-- Trigger: update_longevity_scores_updated_at
-- Table: longevity_scores

CREATE TRIGGER update_longevity_scores_updated_at
    BEFORE UPDATE ON public.longevity_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
