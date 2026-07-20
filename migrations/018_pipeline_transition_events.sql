BEGIN;

CREATE TABLE pipeline_transition_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('source', 'record')),
  from_stage text NOT NULL CHECK (
    from_stage ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  to_stage text NOT NULL CHECK (
    to_stage ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  item_count integer NOT NULL CHECK (item_count > 0),
  transition_kind text NOT NULL CHECK (
    transition_kind IN ('progress', 'escalation', 'retry', 'terminal')
  ),
  pipeline_task_id uuid REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pipeline_transition_events_occurred_idx
  ON pipeline_transition_events (occurred_at DESC);

GRANT SELECT ON pipeline_transition_events TO
  clideck_mcp_admin,
  clideck_mcp_api;
GRANT INSERT ON pipeline_transition_events TO
  clideck_mcp_worker,
  clideck_mcp_researcher;
GRANT USAGE, SELECT ON SEQUENCE pipeline_transition_events_id_seq TO
  clideck_mcp_worker,
  clideck_mcp_researcher;

COMMIT;
