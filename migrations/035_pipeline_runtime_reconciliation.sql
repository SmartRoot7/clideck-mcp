BEGIN;

ALTER TABLE knowledge_candidates
  DROP CONSTRAINT IF EXISTS knowledge_candidates_exclusion_status_check;

ALTER TABLE knowledge_candidates
  ADD CONSTRAINT knowledge_candidates_exclusion_status_check CHECK (
    exclusion_status IS NULL OR exclusion_status IN (
      'unsupported', 'hallucinated', 'non_knowledge', 'superseded',
      'operator_excluded', 'malformed'
    )
  ),
  ADD COLUMN publication_failure_fingerprint text CHECK (
    publication_failure_fingerprint IS NULL OR
    publication_failure_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  );

COMMIT;
