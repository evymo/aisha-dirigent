-- Table: plugin_transition_rules

CREATE TABLE IF NOT EXISTS public.plugin_transition_rules (
  id integer DEFAULT nextval('plugin_transition_rules_id_seq'::regclass) NOT NULL,
  from_status public.plugin_status NOT NULL,
  to_status public.plugin_status NOT NULL,
  requires_role text,
  description text,
  PRIMARY KEY (id),
  CONSTRAINT plugin_transition_rules_from_status_to_status_key UNIQUE (from_status, to_status)
);

ALTER TABLE public.plugin_transition_rules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_transition_rules IS 'State machine rules for plugin status transitions.';
