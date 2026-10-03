/**
 * Shared types for PartnerUsers page and its sub-components.
 */

/**
 * Cohort statistics aggregated per study.
 */
export interface CohortStatistics {
  study_id: string;
  total_participants: number;
  active_participants: number;
  completed_participants: number;
  avg_pain_level: number | null;
  avg_energy_level: number | null;
  avg_mood_level: number | null;
  avg_sleep_quality: number | null;
  avg_sleep_hours: number | null;
  avg_crp: number | null;
  avg_vitamin_d: number | null;
  avg_glucose: number | null;
  total_check_ins: number;
  total_lab_results: number;
  total_dosing_logs: number;
}
