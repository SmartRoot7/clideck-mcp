BEGIN;

ALTER TABLE knowledge_public_trust
  DROP CONSTRAINT knowledge_public_trust_validation_level_check;
ALTER TABLE knowledge_public_trust
  ADD CONSTRAINT knowledge_public_trust_validation_level_check CHECK (
    validation_level IN (
      'legacy_migrated',
      'documentation_reviewed',
      'deterministic_validation',
      'batfish_modeled',
      'runtime_lab_validated'
    )
  ) NOT VALID;
ALTER TABLE knowledge_public_trust
  VALIDATE CONSTRAINT knowledge_public_trust_validation_level_check;

INSERT INTO domain_packs (
  id,
  manifest_schema_version,
  pack_version,
  display_name,
  description,
  manifest
)
VALUES (
  'engineering-measurements',
  '1',
  '1.0.0',
  'Engineering Measurements',
  'Exact engineering values, units, tolerances, conversions, and verification procedures.',
  '{
    "schema_version": "1",
    "id": "engineering-measurements",
    "version": "1.0.0",
    "display_name": "Engineering Measurements",
    "description": "Exact engineering values, units, tolerances, conversions, and verification procedures.",
    "core_compatibility": {"minimum": "1.0.0", "maximum": "1.0.0"},
    "context_dimensions": [
      {"key": "discipline", "display_name": "Discipline", "description": "Engineering discipline.", "value_type": "string", "required": true},
      {"key": "quantity", "display_name": "Quantity", "description": "Measured or controlled quantity.", "value_type": "string", "required": true},
      {"key": "material", "display_name": "Material", "description": "Applicable material.", "value_type": "string", "required": false},
      {"key": "system", "display_name": "System", "description": "Applicable component or system.", "value_type": "string", "required": false},
      {"key": "conditions", "display_name": "Conditions", "description": "Environmental or test conditions.", "value_type": "json", "required": false}
    ],
    "record_types": [
      {"id": "measurement", "display_name": "Measurement", "description": "An exact observed or reference value."},
      {"id": "tolerance", "display_name": "Tolerance", "description": "A nominal value with explicit allowed bounds."},
      {"id": "procedure", "display_name": "Procedure", "description": "A reproducible measurement procedure."},
      {"id": "conversion", "display_name": "Conversion", "description": "An exact unit conversion rule."}
    ],
    "capabilities": {
      "search": true,
      "workflows": true,
      "continuous_learning": false,
      "artifacts": false,
      "spatial": false,
      "relations": false,
      "lab_validation": true
    }
  }'::jsonb
);

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
  coalesce(kpt.validation_level, 'documentation_reviewed') AS validation_level,
  coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
  coalesce(
    kpt.confidence_explanation,
    'Verified structured knowledge with bounded applicability.'
  ) AS confidence_explanation,
  coalesce(kpt.next_review_at, kr.last_verified_at + 180) AS next_review_at,
  kr.revision_number,
  r.sequence AS release_sequence
FROM active_release ar
JOIN releases r ON r.id = ar.release_id
JOIN release_items ri ON ri.release_id = ar.release_id
JOIN knowledge_items ki ON ki.id = ri.knowledge_item_id
JOIN knowledge_revisions kr ON kr.id = ri.revision_id
JOIN domain_packs dp ON dp.id = ki.domain_id AND dp.enabled
LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
WHERE ki.domain_id = kr.domain_id;

COMMIT;
