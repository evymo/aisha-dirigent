-- Function: public.calculate_domain_scores
-- Description: Calculate domain scores from responses JSONB for Longevity Score
-- Security: STABLE (no DEFINER needed - helper function)
-- Related: Part of Longevity Score calculation system
-- Note: This file also defines custom types used by longevity score functions

-- ============================================================================
-- Type: longevity_domain_score
-- ============================================================================
DROP TYPE IF EXISTS public.longevity_domain_score CASCADE;

CREATE TYPE public.longevity_domain_score AS (
  domain_code TEXT,
  domain_name_key TEXT,
  questions_answered INTEGER,
  raw_score NUMERIC,
  max_possible NUMERIC,
  percentage NUMERIC  -- 0-100
);

COMMENT ON TYPE public.longevity_domain_score IS 'Domain score result for Longevity Score (CLS) calculation';

-- ============================================================================
-- Type: longevity_score_result
-- ============================================================================
DROP TYPE IF EXISTS public.longevity_score_result CASCADE;

CREATE TYPE public.longevity_score_result AS (
  response_id UUID,
  user_id UUID,
  completed_at TIMESTAMPTZ,
  cls_score NUMERIC,           -- Celkový Longevity Score (0-100)
  domain_scores JSONB,         -- Array of domain scores
  trend_vs_baseline NUMERIC,   -- Difference from baseline (NULL if first)
  trend_direction TEXT         -- 'improving', 'stable', 'declining'
);

COMMENT ON TYPE public.longevity_score_result IS 'Complete Longevity Score (CLS) result with trend information';

-- ============================================================================
-- Function: calculate_domain_scores
-- Spec: "DOTAZNÍK – SUBJEKTIVNÍ HODNOCENÍ ÚČASTNÍKA" (28 items, 10 domains A-J + pain)
-- Domains aligned with seed STEP 15 scoring_domain values.
-- Scale: 0-10 per question. Reversed questions already oriented 0=bad,10=good by UI.
-- change_perception (section J) is optional (from 2nd measurement) — NULL percentage
-- when unanswered is naturally excluded from CLS average.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_domain_scores(
  p_responses JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_domains JSONB := '[]'::JSONB;
  v_domain_keys TEXT[] := ARRAY[
    'vitality',           -- A) Celkový stav a vitalita
    'energy',             -- B) Energie a únava
    'sleep',              -- C) Spánek a regenerace
    'physical',           -- D) Fyzické tělo
    'metabolism',         -- E) Metabolismus a trávení
    'immunity',           -- F) Imunita a odolnost
    'psyche',             -- G) Psychika a stres
    'cognition',          -- H) Kognice a mentální výkon
    'mood',               -- I) Nálada a motivace
    'pain',               -- extra: Bolest (kept for operational value)
    'change_perception'   -- J) Celkové vnímání změny (from 2nd measurement)
  ];
  v_domain_name_keys TEXT[] := ARRAY[
    'longevityScore.domains.vitality',
    'longevityScore.domains.energy',
    'longevityScore.domains.sleep',
    'longevityScore.domains.physical',
    'longevityScore.domains.metabolism',
    'longevityScore.domains.immunity',
    'longevityScore.domains.psyche',
    'longevityScore.domains.cognition',
    'longevityScore.domains.mood',
    'longevityScore.domains.pain',
    'longevityScore.domains.change_perception'
  ];
  v_question_prefixes TEXT[] := ARRAY[
    'os_vitality_',                       -- os_vitality_overall, os_vitality_vs_peers, os_vitality_trend
    'os_energy_|os_fatigue_',             -- os_energy_morning, os_energy_afternoon, os_fatigue_frequency
    'os_sleep_',                          -- os_sleep_quality_subj, os_sleep_falling_asleep, os_sleep_waking_refreshed
    'os_physical_',                       -- os_physical_endurance, os_physical_strength, os_physical_flexibility
    'os_digestion_|os_appetite',          -- os_digestion_quality, os_digestion_regularity, os_appetite
    'os_immunity_',                       -- os_immunity_resistance, os_immunity_recovery, os_immunity_sickness_freq
    'os_emotional_',                      -- os_emotional_mood, os_emotional_stress, os_emotional_resilience
    'os_cognitive_',                      -- os_cognitive_concentration, os_cognitive_memory, os_cognitive_clarity
    'os_overall_',                        -- os_overall_health, os_overall_life_quality, os_overall_optimism
    'os_pain_',                           -- os_pain_intensity, os_pain_frequency, os_pain_impact
    'os_change_perception'                -- os_change_perception (single item, section J)
  ];
  v_domain_key TEXT;
  v_prefix TEXT;
  v_raw_score NUMERIC := 0;
  v_count INTEGER := 0;
  v_value NUMERIC;
  v_key TEXT;
  v_max_possible NUMERIC;
  v_percentage NUMERIC;
BEGIN
  -- Iterate through each domain
  FOR i IN 1..array_length(v_domain_keys, 1) LOOP
    v_domain_key := v_domain_keys[i];
    v_prefix := v_question_prefixes[i];
    v_raw_score := 0;
    v_count := 0;
    
    -- Sum all matching question responses
    FOR v_key IN SELECT jsonb_object_keys(p_responses) LOOP
      -- Handle multiple prefixes (separated by |)
      IF v_key ~ ('^(' || replace(v_prefix, '|', '|^') || ')') THEN
        v_value := (p_responses->v_key)::NUMERIC;
        IF v_value IS NOT NULL THEN
          v_raw_score := v_raw_score + v_value;
          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
    
    -- Calculate percentage (scale 0-10, so max = 10 * count)
    IF v_count > 0 THEN
      v_max_possible := 10.0 * v_count;
      v_percentage := (v_raw_score / v_max_possible) * 100.0;
    ELSE
      v_max_possible := 0;
      v_percentage := NULL;
    END IF;
    
    -- Add to domains array
    v_domains := v_domains || jsonb_build_object(
      'domain_code', v_domain_key,
      'domain_name_key', v_domain_name_keys[i],
      'questions_answered', v_count,
      'raw_score', v_raw_score,
      'max_possible', v_max_possible,
      'percentage', ROUND(v_percentage, 1)
    );
  END LOOP;
  
  RETURN v_domains;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_domain_scores(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_domain_scores(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_domain_scores(jsonb) TO authenticated;

COMMENT ON FUNCTION public.calculate_domain_scores(jsonb) IS 'Calculate domain scores from OS-SUBJECTIVE responses JSONB. Domains: vitality, energy, sleep, physical, metabolism, immunity, psyche, cognition, mood, pain, change_perception.';
