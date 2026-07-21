BEGIN;

-- An unanswered request may rediscover an official document that is already
-- present locally.  Record each targeted reuse so the same demand cannot
-- repeatedly spend Luna tokens on unchanged fragments.
CREATE TABLE knowledge_demand_source_attempts (
  knowledge_demand_id uuid NOT NULL
    REFERENCES knowledge_demands(id) ON DELETE CASCADE,
  source_candidate_id uuid NOT NULL
    REFERENCES source_candidates(id) ON DELETE CASCADE,
  source_content_hash text NOT NULL CHECK (
    source_content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  fragment_count integer NOT NULL DEFAULT 0 CHECK (fragment_count >= 0),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_demand_id, source_candidate_id)
);

CREATE INDEX knowledge_demand_source_attempts_recent_idx
  ON knowledge_demand_source_attempts (attempted_at DESC);

COMMIT;
