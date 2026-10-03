/**
 * Determines if an entry type has a special block renderer
 */
export function isBlockEntry(entryType: string): boolean {
  return [
    'meeting_request',
    'questionnaire_request',
    'consent_request',
    'lab_order',
    'distribution_adjustment',
    'blood_matrix_analysis',
    'email',
    'web_artifact_upload',
    'web_artifact_scrape',
    'web_artifact_aisha_proposal',
    'web_artifact_applied',
    'web_artifact_published',
    'web_artifact_failed',
    'qa_playwright_requested',
    'qa_playwright_approved',
    'qa_playwright_passed',
    'qa_playwright_failed',
    'flow_run',
    'automation_step',
    'reprice_proposal',
  ].includes(entryType);
}
