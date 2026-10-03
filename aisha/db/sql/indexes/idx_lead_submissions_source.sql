-- Index: idx_lead_submissions_source
-- Table: lead_submissions
-- Purpose: Segment leads by originating page/template (source column) so the
--          operator inbox can group/filter by which web page produced the lead.

CREATE INDEX IF NOT EXISTS idx_lead_submissions_source
  ON public.lead_submissions (source);
