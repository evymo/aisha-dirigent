-- Table: approval_requests
-- Local ledger of governance / agent-change approval requests raised by
-- WF_APPROVAL_GATE. A request is CREATED (fn_create_approval_request) with a
-- caller-supplied id + classification/risk context, then RESOLVED
-- (fn_resolve_approval_request) with a human decision. This is the persistent
-- state the approval gate reads/writes so a decision survives beyond the workflow
-- run (previously the gate had no backing store).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_description text,
  severity text,
  computed_risk numeric,
  agent_slug text,
  category text,
  source text,
  context jsonb DEFAULT '{}'::jsonb,
  context_hash text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  decision text,
  comment text,
  -- Approver identity reference. Kept as text (not a uuid FK) because the resolve
  -- caller (WF_APPROVAL_GATE, service_role) supplies an actor identifier that may
  -- be a user id OR a system/agent actor label.
  responded_by text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.approval_requests IS
  'Local approval-request ledger for WF_APPROVAL_GATE. Created by '
  'fn_create_approval_request, resolved by fn_resolve_approval_request. '
  'Reads/writes are admin/staff or service_role only (RLS + SECURITY DEFINER RPCs).';
