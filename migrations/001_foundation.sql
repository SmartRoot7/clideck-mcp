BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('tenant_client', 'super_admin', 'researcher')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  token_hash bytea NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  slug text NOT NULL,
  display_name text NOT NULL,
  model_pattern text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, slug)
);

CREATE TABLE operating_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  slug text NOT NULL,
  display_name text NOT NULL,
  version_scheme text NOT NULL DEFAULT 'vendor' CHECK (version_scheme IN ('vendor', 'semver', 'date', 'lexical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, slug)
);

CREATE TABLE context_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id uuid REFERENCES vendors(id),
  platform_id uuid REFERENCES platforms(id),
  operating_system_id uuid REFERENCES operating_systems(id),
  alias text NOT NULL,
  normalized_alias text GENERATED ALWAYS AS (lower(regexp_replace(alias, '[^[:alnum:]._-]+', '', 'g'))) STORED,
  CHECK (num_nonnulls(vendor_id, platform_id, operating_system_id) = 1)
);
CREATE INDEX context_aliases_trgm_idx ON context_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE CHECK (stable_key ~ '^[a-z0-9][a-z0-9._-]{2,159}$'),
  kind text NOT NULL CHECK (kind IN ('command', 'workflow', 'diagnostic', 'concept')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid NOT NULL REFERENCES knowledge_items(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('quarantine', 'candidate', 'validated', 'rejected')),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  platform_id uuid REFERENCES platforms(id),
  operating_system_id uuid NOT NULL REFERENCES operating_systems(id),
  version_min text,
  version_max text,
  version_normalized_min integer[],
  version_normalized_max integer[],
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  question_patterns text[] NOT NULL DEFAULT '{}',
  cli_mode text,
  command_text text,
  procedure_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  dangerous boolean NOT NULL DEFAULT false,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  quality_score numeric(4,3) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  confidence_reason text NOT NULL,
  last_verified_at date NOT NULL,
  search_document tsvector NOT NULL DEFAULT ''::tsvector,
  created_by text NOT NULL CHECK (created_by IN ('seed', 'researcher', 'legacy_import', 'super_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_item_id, revision_number),
  CHECK (version_min IS NULL OR version_normalized_min IS NOT NULL),
  CHECK (version_max IS NULL OR version_normalized_max IS NOT NULL),
  CHECK (jsonb_typeof(procedure_steps) = 'array'),
  CHECK (jsonb_typeof(prerequisites) = 'array'),
  CHECK (jsonb_typeof(risks) = 'array'),
  CHECK (jsonb_typeof(verification_steps) = 'array'),
  CHECK (jsonb_typeof(rollback_steps) = 'array'),
  CHECK (jsonb_typeof(limitations) = 'array')
);
CREATE INDEX knowledge_revisions_fts_idx ON knowledge_revisions USING gin (search_document);
CREATE INDEX knowledge_revisions_context_idx
  ON knowledge_revisions (vendor_id, operating_system_id, platform_id, status);

CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url text NOT NULL,
  document_type text NOT NULL,
  title text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  document_version text,
  document_date date,
  verified_at date NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_fragment text NOT NULL CHECK (char_length(evidence_fragment) BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_url, content_hash)
);

CREATE TABLE revision_sources (
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  evidence_role text NOT NULL CHECK (evidence_role IN ('primary', 'corroborating', 'conflict')),
  confidence_reason text NOT NULL,
  PRIMARY KEY (revision_id, source_document_id)
);

CREATE TABLE knowledge_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_revision_id uuid NOT NULL REFERENCES knowledge_revisions(id),
  right_revision_id uuid NOT NULL REFERENCES knowledge_revisions(id),
  severity text NOT NULL CHECK (severity IN ('informational', 'warning', 'blocking')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (left_revision_id <> right_revision_id)
);

CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  status text NOT NULL CHECK (status IN ('published', 'superseded', 'rolled_back')),
  reason text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE release_items (
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
  knowledge_item_id uuid NOT NULL REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (release_id, knowledge_item_id),
  UNIQUE (release_id, revision_id)
);

CREATE TABLE active_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
  switched_at timestamptz NOT NULL DEFAULT now(),
  switched_by text NOT NULL
);

CREATE TABLE expert_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^ekt_[A-Za-z0-9_-]{32}$'),
  access_token_hash bytea,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'claimed', 'researching', 'input_required', 'validating', 'completed', 'failed', 'cancelled', 'expired')
  ),
  question text NOT NULL CHECK (char_length(question) BETWEEN 8 AND 2000),
  network_context jsonb NOT NULL,
  requested_by text NOT NULL DEFAULT 'public_mcp',
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10 AND 10),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  claim_owner text,
  lease_token_hash bytea,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  input_request text,
  result_revision_id uuid REFERENCES knowledge_revisions(id),
  result_payload jsonb,
  failure_code text,
  failure_message text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((tenant_id IS NOT NULL AND access_token_hash IS NULL) OR
         (tenant_id IS NULL AND access_token_hash IS NOT NULL))
);
CREATE INDEX expert_tasks_queue_idx ON expert_tasks (priority DESC, created_at)
  WHERE status = 'queued';
CREATE INDEX expert_tasks_lease_idx ON expert_tasks (lease_until)
  WHERE status IN ('claimed', 'researching', 'validating');

CREATE TABLE task_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES expert_tasks(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('client_to_researcher', 'researcher_to_client', 'system')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES expert_tasks(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('candidate_revision', 'validation_report')),
  payload jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  revision_id uuid REFERENCES knowledge_revisions(id) ON DELETE SET NULL,
  task_id uuid REFERENCES expert_tasks(id) ON DELETE SET NULL,
  rating smallint CHECK (rating BETWEEN -1 AND 1),
  category text NOT NULL CHECK (category IN ('correct', 'incorrect', 'outdated', 'unsafe', 'incomplete', 'other')),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revision_id IS NOT NULL OR task_id IS NOT NULL)
);

CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  records_seen integer NOT NULL DEFAULT 0,
  records_quarantined integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE TABLE import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  legacy_key text,
  payload jsonb NOT NULL,
  trust_level text NOT NULL DEFAULT 'unknown' CHECK (trust_level IN ('unknown', 'low', 'verified')),
  status text NOT NULL DEFAULT 'quarantine' CHECK (status IN ('quarantine', 'accepted', 'rejected')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limit_buckets (
  bucket_key bytea NOT NULL,
  route_class text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket_key, route_class, window_start)
);

CREATE TABLE worker_heartbeats (
  worker_name text PRIMARY KEY,
  instance_id text NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION build_revision_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.question_patterns, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.command_text, '')), 'B');
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_revisions_search_document
  BEFORE INSERT ON knowledge_revisions
  FOR EACH ROW EXECUTE FUNCTION build_revision_search_document();

CREATE OR REPLACE FUNCTION prevent_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'knowledge revisions are immutable';
END;
$$;

CREATE TRIGGER knowledge_revisions_immutable
  BEFORE UPDATE OR DELETE ON knowledge_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_revision_mutation();

CREATE VIEW public_active_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.stable_key,
  ki.kind,
  v.slug AS vendor_slug,
  v.display_name AS vendor_name,
  p.slug AS platform_slug,
  p.display_name AS platform_name,
  os.slug AS operating_system_slug,
  os.display_name AS operating_system_name,
  kr.version_min,
  kr.version_max,
  kr.version_normalized_min,
  kr.version_normalized_max,
  kr.title,
  kr.summary,
  kr.question_patterns,
  kr.cli_mode,
  kr.command_text,
  kr.procedure_steps,
  kr.prerequisites,
  kr.risks,
  kr.verification_steps,
  kr.rollback_steps,
  kr.limitations,
  kr.dangerous,
  kr.confidence,
  kr.quality_score,
  kr.last_verified_at,
  kr.search_document
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
JOIN operating_systems os ON os.id = kr.operating_system_id;

COMMIT;
