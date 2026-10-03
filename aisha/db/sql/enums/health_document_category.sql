-- Enum: health_document_category

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'health_document_category') THEN
    CREATE TYPE health_document_category AS ENUM (
      'lab_results',
  'imaging',
  'prescription',
  'medical_report',
  'consultation_notes',
  'diagnostic_test',
  'vaccination_record',
  'other'
    );
  END IF;
END $$;

-- Values: lab_results, imaging, prescription, medical_report, consultation_notes, diagnostic_test, vaccination_record, other
