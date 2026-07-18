BEGIN;

CREATE TABLE code_change_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES expert_tasks(id) ON DELETE SET NULL,
  repository text NOT NULL CHECK (repository = 'SmartRoot7/clideck-mcp'),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 2000),
  proposed_diff text NOT NULL CHECK (char_length(proposed_diff) BETWEEN 1 AND 20000),
  risk_assessment text NOT NULL CHECK (char_length(risk_assessment) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'approval_required' CHECK (
    status IN ('approval_required', 'approved', 'rejected', 'applied')
  ),
  requested_by text NOT NULL,
  decided_by text,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

COMMIT;
