BEGIN;

ALTER TABLE pipeline_settings
  ADD COLUMN max_active_sources smallint NOT NULL DEFAULT 4 CHECK (
    max_active_sources BETWEEN 1 AND 8
  ),
  ADD COLUMN max_deep_review_runs smallint NOT NULL DEFAULT 1 CHECK (
    max_deep_review_runs BETWEEN 1 AND 2
  ),
  ADD COLUMN source_buffer_target smallint NOT NULL DEFAULT 20 CHECK (
    source_buffer_target BETWEEN 4 AND 100
  ),
  ADD COLUMN manual_exception_daily_cap smallint NOT NULL DEFAULT 3 CHECK (
    manual_exception_daily_cap BETWEEN 0 AND 10
  );

UPDATE pipeline_settings
SET max_concurrent_ai_runs = 4,
    max_active_sources = 4,
    max_deep_review_runs = 1,
    source_buffer_target = 20,
    manual_exception_daily_cap = 3,
    updated_at = now(),
    updated_by = '014_high_throughput_pipeline'
WHERE singleton;

ALTER TABLE pipeline_tasks
  DROP CONSTRAINT IF EXISTS pipeline_tasks_task_type_check,
  DROP CONSTRAINT IF EXISTS pipeline_tasks_stage_check;

ALTER TABLE pipeline_tasks
  ADD CONSTRAINT pipeline_tasks_task_type_check CHECK (
    task_type IN (
      'expert_research',
      'source_discovery',
      'source_acquisition',
      'source_conversion',
      'source_chunking',
      'fragment_analysis',
      'candidate_verification',
      'candidate_deep_review',
      'source_publication',
      'source_refresh'
    )
  ),
  ADD CONSTRAINT pipeline_tasks_stage_check CHECK (
    stage IN (
      'discover',
      'acquire',
      'convert',
      'chunk',
      'analyze',
      'verify',
      'deep_review',
      'publish'
    )
  ),
  ADD COLUMN requested_reasoning_effort text NOT NULL DEFAULT 'low' CHECK (
    requested_reasoning_effort = 'low'
    OR (
      task_type = 'candidate_deep_review'
      AND requested_reasoning_effort = 'medium'
    )
  );

ALTER TABLE pipeline_events
  DROP CONSTRAINT IF EXISTS pipeline_events_stage_check;

ALTER TABLE pipeline_events
  ADD CONSTRAINT pipeline_events_stage_check CHECK (
    stage IN (
      'discover',
      'acquire',
      'convert',
      'chunk',
      'analyze',
      'verify',
      'deep_review',
      'publish',
      'system'
    )
  );

ALTER TABLE knowledge_candidates
  DROP CONSTRAINT IF EXISTS knowledge_candidates_status_check;

ALTER TABLE knowledge_candidates
  ADD CONSTRAINT knowledge_candidates_status_check CHECK (
    status IN (
      'analyzed',
      'verified',
      'rejected',
      'conflict',
      'manual_review',
      'deep_review',
      'quarantined',
      'manual_exception',
      'published'
    )
  ),
  ADD COLUMN deep_review_task_id uuid
    REFERENCES pipeline_tasks(id) ON DELETE SET NULL,
  ADD COLUMN resolution_attempts smallint NOT NULL DEFAULT 0 CHECK (
    resolution_attempts BETWEEN 0 AND 10
  ),
  ADD COLUMN resolution_reason text,
  ADD COLUMN next_review_at timestamptz;

CREATE INDEX knowledge_candidates_deep_review_reservation_idx
  ON knowledge_candidates (deep_review_task_id)
  WHERE deep_review_task_id IS NOT NULL;

CREATE INDEX knowledge_candidates_quarantine_retry_idx
  ON knowledge_candidates (next_review_at, created_at)
  WHERE status = 'quarantined';

CREATE INDEX knowledge_candidates_automatic_review_queue_idx
  ON knowledge_candidates (
    status,
    deep_review_task_id,
    resolution_attempts,
    next_review_at,
    created_at
  )
  WHERE status IN ('deep_review', 'quarantined');

CREATE INDEX knowledge_candidates_manual_exception_updated_idx
  ON knowledge_candidates (updated_at DESC)
  WHERE status = 'manual_exception';

ALTER TABLE candidate_verifications
  DROP CONSTRAINT IF EXISTS candidate_verifications_decision_check;

ALTER TABLE candidate_verifications
  ADD CONSTRAINT candidate_verifications_decision_check CHECK (
    decision IN (
      'verified',
      'rejected',
      'conflict',
      'manual_review',
      'deep_review',
      'quarantined',
      'manual_exception'
    )
  ),
  ADD COLUMN review_type text NOT NULL DEFAULT 'standard' CHECK (
    review_type IN ('standard', 'deep_low', 'deep_medium', 'human')
  ),
  ADD COLUMN repaired_payload_hash text CHECK (
    repaired_payload_hash IS NULL
    OR repaired_payload_hash ~ '^sha256:[0-9a-f]{64}$'
  );

CREATE INDEX candidate_verifications_recent_outcome_idx
  ON candidate_verifications (
    created_at DESC,
    review_type,
    decision
  );

CREATE INDEX pipeline_tasks_completed_type_idx
  ON pipeline_tasks (completed_at DESC, task_type)
  WHERE status = 'completed';

CREATE INDEX agent_runs_completed_recent_idx
  ON agent_runs (completed_at DESC)
  WHERE status = 'completed';

ALTER TABLE source_candidates
  DROP CONSTRAINT IF EXISTS source_candidates_status_check;

ALTER TABLE source_candidates
  ADD CONSTRAINT source_candidates_status_check CHECK (
    status IN (
      'discovered',
      'approved',
      'acquiring',
      'acquired',
      'converting',
      'converted',
      'chunking',
      'analyzing',
      'verifying',
      'publishing',
      'completed',
      'completed_with_exceptions',
      'duplicate',
      'rejected',
      'failed'
    )
  );

CREATE TABLE active_source_slots (
  slot_number smallint PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 8),
  source_candidate_id uuid NOT NULL UNIQUE
    REFERENCES source_candidates(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO active_source_slots (slot_number, source_candidate_id)
SELECT 1, active_source_id
FROM pipeline_settings
WHERE singleton AND active_source_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX active_source_slots_heartbeat_idx
  ON active_source_slots (heartbeat_at);

CREATE TABLE source_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_target_id uuid NOT NULL REFERENCES coverage_targets(id),
  canonical_url text NOT NULL UNIQUE,
  vendor_domain text NOT NULL CHECK (
    vendor_domain ~ '^[a-z0-9.-]+$'
  ),
  collection_type text NOT NULL CHECK (
    collection_type IN ('manual_root', 'sitemap', 'document_index')
  ),
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'refreshing', 'paused', 'failed')
  ),
  crawl_depth smallint NOT NULL DEFAULT 2 CHECK (
    crawl_depth BETWEEN 0 AND 2
  ),
  link_limit smallint NOT NULL DEFAULT 200 CHECK (
    link_limit BETWEEN 1 AND 200
  ),
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(cursor) = 'object'
  ),
  last_scanned_at timestamptz,
  next_scan_at timestamptz NOT NULL DEFAULT now(),
  consecutive_empty_scans smallint NOT NULL DEFAULT 0 CHECK (
    consecutive_empty_scans BETWEEN 0 AND 100
  ),
  unique_yield bigint NOT NULL DEFAULT 0 CHECK (unique_yield >= 0),
  duplicates_avoided bigint NOT NULL DEFAULT 0 CHECK (
    duplicates_avoided >= 0
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX source_collections_scheduler_idx
  ON source_collections (status, next_scan_at, updated_at);

INSERT INTO source_collections (
  coverage_target_id,
  canonical_url,
  vendor_domain,
  collection_type
)
SELECT
  target.id,
  'https://www.cisco.com/c/en/us/support/switches/catalyst-9300-series-switches/series.html',
  'cisco.com',
  'manual_root'
FROM coverage_targets target
WHERE target.vendor_slug = 'cisco'
  AND target.operating_system_slug = 'ios-xe'
ORDER BY target.priority DESC, target.created_at
LIMIT 1
ON CONFLICT (canonical_url) DO NOTHING;

UPDATE knowledge_candidates
SET status = 'deep_review',
    resolution_reason = coalesce(
      resolution_reason,
      'Migrated from legacy manual review to automatic deep review.'
    ),
    next_review_at = now(),
    updated_at = now()
WHERE status = 'manual_review';

UPDATE source_candidates source
SET status = 'verifying',
    failure_code = NULL,
    failure_message = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE source.status = 'failed'
  AND EXISTS (
    SELECT 1
    FROM knowledge_candidates candidate
    JOIN pipeline_tasks task
      ON task.id = candidate.pipeline_task_id
    WHERE task.source_candidate_id = source.id
      AND candidate.status IN (
        'verified',
        'deep_review',
        'quarantined'
      )
  );

INSERT INTO pipeline_events (
  pipeline_task_id,
  source_candidate_id,
  stage,
  event_type,
  message,
  metadata
)
SELECT
  task.id,
  task.source_candidate_id,
  'publish',
  'skipped',
  'Failed publication was reconciled for automatic candidate recovery.',
  jsonb_build_object(
    'reconciliation', '014_high_throughput_pipeline'
  )
FROM pipeline_tasks task
WHERE task.task_type = 'source_publication'
  AND task.status = 'failed'
  AND task.source_candidate_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM knowledge_candidates candidate
    JOIN pipeline_tasks candidate_task
      ON candidate_task.id = candidate.pipeline_task_id
    WHERE candidate_task.source_candidate_id = task.source_candidate_id
      AND candidate.status IN (
        'verified',
        'deep_review',
        'quarantined'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pipeline_events event
    WHERE event.pipeline_task_id = task.id
      AND event.metadata @> jsonb_build_object(
        'reconciliation',
        '014_high_throughput_pipeline'
      )
  );

UPDATE pipeline_tasks
SET result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
      'reconciled_by',
      '014_high_throughput_pipeline'
    ),
    updated_at = now()
WHERE task_type = 'source_publication'
  AND status = 'failed'
  AND source_candidate_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM source_candidates source
    WHERE source.id = pipeline_tasks.source_candidate_id
      AND source.status = 'verifying'
  );

COMMIT;
