-- View: public.audience_admin_accounts_v
-- Lovable-compat: cohorts/programs projected as member-bearing accounts (over audience_admin_cohort_overview_v).

CREATE OR REPLACE VIEW public.audience_admin_accounts_v AS
 SELECT cohort_id AS account_id,
    cohort_name AS name,
    cohort_type AS type,
    status,
    current_registration AS members,
    target_registration,
    avg_audience_size,
    starts_at,
    ends_at
   FROM audience_admin_cohort_overview_v a;
