export const UPLOAD_HEALTH_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export const UPLOAD_HEALTH_DOCUMENT_ALLOWED_CATEGORIES = new Set([
  'lab_results',
  'imaging',
  'prescription',
  'medical_report',
  'consultation_notes',
  'diagnostic_test',
  'vaccination_record',
  'other',
]);

export const RECORD_BLOCKCHAIN_AUDIT_ALLOWED_EVENT_TYPES = new Set([
  'batch_created',
  'batch_qc_approved',
  'batch_released',
  'study_started',
  'study_unblinded',
  'study_completed',
  'milestone_achieved',
  'token_event',
  'policy_change',
]);

export const RECORD_BLOCKCHAIN_AUDIT_ALLOWED_REFERENCE_TABLES = new Set([
  'production_batches',
  'production_milestones',
  'studies',
]);
