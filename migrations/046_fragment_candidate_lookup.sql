BEGIN;

-- Analyze needs all historical keys for one selected evidence fragment,
-- including published/rejected candidates omitted by the open-work indexes.
CREATE INDEX knowledge_candidates_fragment_keys_idx
  ON knowledge_candidates (source_fragment_id, stable_key)
  WHERE source_fragment_id IS NOT NULL;

COMMIT;
