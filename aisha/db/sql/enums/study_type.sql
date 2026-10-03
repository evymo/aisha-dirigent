-- Enum: study_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'study_type') THEN
    CREATE TYPE study_type AS ENUM (
      'observational',
      'operational_trial',
      'community',
      'source_retreat',
      'marketing_segment',
      'event_audience',
      'course_cohort'
    );
  END IF;
END $$;

-- Values: observational, operational_trial, community, source_retreat,
--         marketing_segment, event_audience, course_cohort
-- source_retreat/marketing_segment/event_audience/course_cohort added by migration
-- 20260523100500_audience_cohort_aliases (ALTER TYPE ... ADD VALUE IF NOT EXISTS).
