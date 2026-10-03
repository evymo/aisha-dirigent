-- Enum: journal_action_type
-- Last synchronized: 2026-01-09

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_action_type') THEN
    CREATE TYPE journal_action_type AS ENUM (
      'access',
      'approve',
      'assign',
      'cancel',
      'complete',
      'consent_granted',
      'consent_revoked',
      'create',
      'delete',
      'error',
      'export',
      'insert',
      'integration',
      'login',
      'logout',
      'read',
      'reject',
      'scheduled_task',
      'submit',
      'system_event',
      'update',
      'view'
    );
  END IF;
END $$;

-- Values (alphabetical): access, approve, assign, cancel, complete, consent_granted, consent_revoked, create, delete, error, export, insert, integration, login, logout, read, reject, scheduled_task, submit, system_event, update, view
