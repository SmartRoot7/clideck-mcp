ALTER TABLE expert_tasks
  DROP CONSTRAINT IF EXISTS expert_tasks_status_check;

ALTER TABLE knowledge_revisions
  ADD COLUMN public_ref uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX knowledge_revisions_public_ref_idx
  ON knowledge_revisions (public_ref);

ALTER TABLE feedback
  ADD COLUMN public_ref uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX feedback_public_ref_idx
  ON feedback (public_ref);

ALTER TABLE snapshot_contributions
  ADD COLUMN public_ref uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX snapshot_contributions_public_ref_idx
  ON snapshot_contributions (public_ref);

ALTER TABLE expert_tasks
  ADD CONSTRAINT expert_tasks_status_check
  CHECK (
    status IN (
      'queued',
      'claimed',
      'researching',
      'input_required',
      'validating',
      'publishing',
      'completed',
      'failed',
      'cancelled',
      'expired'
    )
  ) NOT VALID;

ALTER TABLE expert_tasks
  VALIDATE CONSTRAINT expert_tasks_status_check;

DROP INDEX IF EXISTS expert_tasks_lease_idx;

CREATE INDEX expert_tasks_lease_idx ON expert_tasks (lease_until)
  WHERE status IN ('claimed', 'researching', 'validating', 'publishing');

ALTER TABLE source_documents
  DROP CONSTRAINT IF EXISTS source_documents_canonical_url_content_hash_key;

ALTER TABLE source_documents
  ADD CONSTRAINT source_documents_domain_url_hash_key
  UNIQUE (domain_id, canonical_url, content_hash);

UPDATE knowledge_public_trust
SET validation_level = 'documentation_reviewed',
    lab_validated_at = NULL
WHERE validation_level IN ('batfish_modeled', 'runtime_lab_validated');

CREATE OR REPLACE FUNCTION current_knowledge_validation(
  requested_revision_id uuid
)
RETURNS TABLE (
  validation_level text,
  lab_validated_at timestamptz
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    validation_type::text AS validation_level,
    executed_at AS lab_validated_at
  FROM knowledge_validations
  WHERE revision_id = requested_revision_id
    AND status = 'passed'
    AND expires_at > now()
  ORDER BY
    CASE validation_type
      WHEN 'runtime_lab_validated' THEN 1
      WHEN 'batfish_modeled' THEN 2
      ELSE 3
    END,
    executed_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE VIEW public_active_knowledge AS
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
  coalesce(
    current_validation.validation_level,
    CASE
      WHEN kpt.validation_level IN (
        'batfish_modeled',
        'runtime_lab_validated'
      )
        THEN 'documentation_reviewed'
      ELSE kpt.validation_level
    END,
    'documentation_reviewed'
  ) AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  current_validation.lab_validated_at
FROM active_release ar
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN vendors v ON v.id = kr.vendor_id
LEFT JOIN platforms p ON p.id = kr.platform_id
LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
LEFT JOIN LATERAL current_knowledge_validation(kr.id)
  current_validation ON true
WHERE ki.domain_id = 'network'
  AND kr.domain_id = 'network';

CREATE OR REPLACE VIEW public_active_domain_knowledge AS
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
  coalesce(
    current_validation.validation_level,
    CASE
      WHEN kpt.validation_level IN (
        'batfish_modeled',
        'runtime_lab_validated'
      )
        THEN 'documentation_reviewed'
      ELSE kpt.validation_level
    END,
    'documentation_reviewed'
  ) AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kr.revision_number,
  release.sequence AS release_sequence
FROM active_release ar
JOIN releases release ON release.id = ar.release_id
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN domain_packs dp ON dp.id = ki.domain_id AND dp.enabled
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
LEFT JOIN LATERAL current_knowledge_validation(kr.id)
  current_validation ON true
WHERE ki.domain_id = kr.domain_id;
