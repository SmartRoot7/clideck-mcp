BEGIN;

CREATE TABLE domain_packs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  manifest_schema_version text NOT NULL,
  pack_version text NOT NULL CHECK (
    pack_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
  ),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 500),
  manifest jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(manifest) = 'object')
);

INSERT INTO domain_packs (
  id,
  manifest_schema_version,
  pack_version,
  display_name,
  description,
  manifest
)
VALUES (
  'network',
  '1',
  '1.0.0',
  'Network Knowledge',
  'Version-aware commands, diagnostics, workflows, changes, and upgrades for network infrastructure.',
  '{
    "schema_version": "1",
    "id": "network",
    "version": "1.0.0",
    "display_name": "Network Knowledge",
    "description": "Version-aware commands, diagnostics, workflows, changes, and upgrades for network infrastructure.",
    "core_compatibility": {"minimum": "1.0.0", "maximum": "1.0.0"},
    "context_dimensions": [
      {"key": "vendor", "display_name": "Vendor", "description": "Equipment vendor.", "value_type": "string", "required": true},
      {"key": "model", "display_name": "Model", "description": "Device model or product family.", "value_type": "string", "required": false},
      {"key": "operating_system", "display_name": "Operating system", "description": "Network operating system.", "value_type": "string", "required": true},
      {"key": "version", "display_name": "Version", "description": "Vendor-specific software version.", "value_type": "string", "required": false}
    ],
    "record_types": [
      {"id": "command", "display_name": "Command", "description": "A version-scoped command."},
      {"id": "workflow", "display_name": "Workflow", "description": "A multi-step operational workflow."},
      {"id": "diagnostic", "display_name": "Diagnostic", "description": "A diagnostic procedure or interpretation."},
      {"id": "concept", "display_name": "Concept", "description": "A bounded technical concept."},
      {"id": "change", "display_name": "Change", "description": "A guarded configuration change."},
      {"id": "upgrade", "display_name": "Upgrade", "description": "A model and version-specific upgrade procedure."}
    ],
    "capabilities": {
      "search": true,
      "workflows": true,
      "continuous_learning": true,
      "artifacts": false,
      "spatial": false,
      "relations": true,
      "lab_validation": true
    }
  }'::jsonb
);

ALTER TABLE knowledge_items
  ADD COLUMN domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT;

ALTER TABLE knowledge_items
  DROP CONSTRAINT knowledge_items_kind_check;

ALTER TABLE knowledge_items
  ADD CONSTRAINT knowledge_items_record_type_check
    CHECK (kind ~ '^[a-z][a-z0-9._-]{1,63}$') NOT VALID;

ALTER TABLE knowledge_items
  VALIDATE CONSTRAINT knowledge_items_record_type_check;

ALTER TABLE knowledge_items
  ADD CONSTRAINT knowledge_items_id_domain_unique UNIQUE (id, domain_id);

CREATE INDEX knowledge_items_domain_kind_idx
  ON knowledge_items (domain_id, kind, created_at DESC);

ALTER TABLE knowledge_revisions
  ADD COLUMN domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT,
  ADD COLUMN domain_schema_version text NOT NULL DEFAULT 'legacy-network-v1',
  ADD COLUMN domain_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN domain_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_revisions
  ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE knowledge_revisions
  ADD CONSTRAINT knowledge_revisions_item_domain_fkey
    FOREIGN KEY (knowledge_item_id, domain_id)
    REFERENCES knowledge_items(id, domain_id) ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT knowledge_revisions_domain_context_object_check
    CHECK (jsonb_typeof(domain_context) = 'object') NOT VALID,
  ADD CONSTRAINT knowledge_revisions_domain_payload_object_check
    CHECK (jsonb_typeof(domain_payload) = 'object') NOT VALID,
  ADD CONSTRAINT knowledge_revisions_network_vendor_check
    CHECK (domain_id <> 'network' OR vendor_id IS NOT NULL) NOT VALID;

ALTER TABLE knowledge_revisions
  VALIDATE CONSTRAINT knowledge_revisions_item_domain_fkey;
ALTER TABLE knowledge_revisions
  VALIDATE CONSTRAINT knowledge_revisions_domain_context_object_check;
ALTER TABLE knowledge_revisions
  VALIDATE CONSTRAINT knowledge_revisions_domain_payload_object_check;
ALTER TABLE knowledge_revisions
  VALIDATE CONSTRAINT knowledge_revisions_network_vendor_check;

CREATE INDEX knowledge_revisions_domain_context_gin_idx
  ON knowledge_revisions USING gin (domain_context jsonb_path_ops);
CREATE INDEX knowledge_revisions_domain_payload_gin_idx
  ON knowledge_revisions USING gin (domain_payload jsonb_path_ops);
CREATE INDEX knowledge_revisions_domain_status_idx
  ON knowledge_revisions (domain_id, status, created_at DESC);

ALTER TABLE source_documents
  ADD COLUMN domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT;

ALTER TABLE source_documents
  ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_network_vendor_check
    CHECK (domain_id <> 'network' OR vendor_id IS NOT NULL) NOT VALID;

ALTER TABLE source_documents
  VALIDATE CONSTRAINT source_documents_network_vendor_check;

CREATE INDEX source_documents_domain_verified_idx
  ON source_documents (domain_id, verified_at DESC);

ALTER TABLE knowledge_candidates
  ADD COLUMN domain_id text NOT NULL DEFAULT 'network'
    REFERENCES domain_packs(id) ON DELETE RESTRICT;

CREATE INDEX knowledge_candidates_domain_status_idx
  ON knowledge_candidates (domain_id, status, created_at);

CREATE OR REPLACE FUNCTION build_revision_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.question_patterns, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.command_text, '')), 'B') ||
    setweight(jsonb_to_tsvector('simple', coalesce(NEW.domain_context, '{}'::jsonb), '["string"]'), 'B') ||
    setweight(jsonb_to_tsvector('simple', coalesce(NEW.domain_payload, '{}'::jsonb), '["string"]'), 'C');
  RETURN NEW;
END;
$$;

DROP VIEW public_active_knowledge;

CREATE VIEW public_active_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.stable_key,
  ki.kind,
  kr.created_by AS origin,
  kr.risk_level,
  v.slug AS vendor_slug,
  v.display_name AS vendor_name,
  p.slug AS platform_slug,
  p.display_name AS platform_name,
  os.slug AS operating_system_slug,
  coalesce(os.display_name, 'Not specified') AS operating_system_name,
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
  kr.created_at AS revision_created_at,
  kr.search_document,
  coalesce(kpt.validation_level, 'documentation_reviewed') AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kpt.lab_validated_at
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
WHERE ki.domain_id = 'network'
  AND kr.domain_id = 'network';

CREATE VIEW public_active_domain_knowledge AS
SELECT
  kr.id AS revision_id,
  ki.domain_id,
  dp.display_name AS domain_name,
  ki.stable_key,
  ki.kind AS record_type,
  kr.domain_schema_version,
  kr.domain_context,
  kr.domain_payload,
  kr.title,
  kr.summary,
  kr.question_patterns,
  kr.prerequisites,
  kr.risks,
  kr.verification_steps,
  kr.rollback_steps,
  kr.limitations,
  kr.dangerous,
  kr.confidence,
  kr.quality_score,
  kr.last_verified_at,
  kr.created_at AS revision_created_at,
  kr.search_document,
  coalesce(kpt.validation_level, 'documentation_reviewed') AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN domain_packs dp ON dp.id = ki.domain_id AND dp.enabled
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
WHERE ki.domain_id = kr.domain_id;

COMMIT;
