-- Table: story_sync_operations
-- Provenance ledger: tracks export, import, promote, reconcile actions

CREATE TABLE IF NOT EXISTS public.story_sync_operations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  bundle_id uuid,
  bundle_version integer,
  operation_type text NOT NULL,
  source_instance_id uuid,
  target_instance_id uuid,
  ruleset_fingerprint text,
  actor_ref text NOT NULL,
  actor_type text NOT NULL DEFAULT 'human',
  outcome sync_operation_outcome NOT NULL DEFAULT 'pending',
  outcome_detail text,
  parent_operation_id uuid,
  started_at timestamptz DEFAULT now() NOT NULL,
  committed_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT story_sync_operations_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT story_sync_operations_bundle_fkey
    FOREIGN KEY (bundle_id) REFERENCES story_bundles(id) ON DELETE SET NULL,
  CONSTRAINT story_sync_operations_source_fkey
    FOREIGN KEY (source_instance_id) REFERENCES story_instances(id) ON DELETE SET NULL,
  CONSTRAINT story_sync_operations_target_fkey
    FOREIGN KEY (target_instance_id) REFERENCES story_instances(id) ON DELETE SET NULL,
  CONSTRAINT story_sync_operations_parent_fkey
    FOREIGN KEY (parent_operation_id) REFERENCES story_sync_operations(id) ON DELETE SET NULL
);

ALTER TABLE public.story_sync_operations ENABLE ROW LEVEL SECURITY;
