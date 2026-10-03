-- Table: plugin_versions

CREATE TABLE IF NOT EXISTS public.plugin_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  version text NOT NULL,
  artifact_sha256 text NOT NULL,
  artifact_url text NOT NULL,
  changelog text,
  resolved_deps jsonb,
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_versions_plugin_id_version_key UNIQUE (plugin_id, version),
  CONSTRAINT plugin_versions_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE,
  CONSTRAINT plugin_versions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT plugin_versions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE public.plugin_versions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_versions IS 'Version history and artifact references for each plugin.';
