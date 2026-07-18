BEGIN;

CREATE TABLE mcp_protocol_tasks (
  task_id text PRIMARY KEY CHECK (task_id ~ '^mpt_[A-Za-z0-9_-]{43}$'),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  session_id text,
  request_id jsonb NOT NULL,
  original_request jsonb NOT NULL,
  expert_task_id uuid UNIQUE REFERENCES expert_tasks(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (
    status IN ('working', 'input_required', 'completed', 'failed', 'cancelled')
  ),
  status_message text,
  ttl_ms integer CHECK (ttl_ms IS NULL OR ttl_ms BETWEEN 60000 AND 86400000),
  poll_interval_ms integer CHECK (
    poll_interval_ms IS NULL OR poll_interval_ms BETWEEN 500 AND 60000
  ),
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX mcp_protocol_tasks_tenant_idx
  ON mcp_protocol_tasks (tenant_id, created_at DESC);
CREATE INDEX mcp_protocol_tasks_expiry_idx
  ON mcp_protocol_tasks (expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;
