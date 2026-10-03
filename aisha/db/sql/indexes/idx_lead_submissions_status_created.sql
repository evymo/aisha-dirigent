-- Index: idx_lead_submissions_status_created
-- Table: lead_submissions
-- Purpose: Operator inbox — newest unread first, filtered by status. Backs the
--          admin/staff triage list (status filter + created_at DESC ordering)
--          read via is_admin_or_staff(); see policies/Public_web_leads_readable_by_admin_staff.sql.

CREATE INDEX IF NOT EXISTS idx_lead_submissions_status_created
  ON public.lead_submissions (status, created_at DESC);
