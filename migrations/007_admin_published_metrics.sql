CREATE INDEX knowledge_candidates_published_updated_idx
  ON knowledge_candidates (updated_at)
  WHERE status = 'published';
