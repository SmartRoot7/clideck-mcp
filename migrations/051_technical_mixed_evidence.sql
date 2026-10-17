-- A private incident-evidence request must not block outstanding public research.
-- Reclassify only the latest reviewed mixed gap. Preserve pure private holds,
-- published demands, task attempts, fresh leases and immutable revisions.
UPDATE knowledge_demands demand
SET last_error_code = 'TECHNICAL_EVIDENCE_INCOMPLETE'
FROM (
  SELECT DISTINCT ON (demand_id) demand_id,missing_capabilities,next_searches
  FROM technical_demand_answers
  WHERE status IN ('published','unresolved')
  ORDER BY demand_id,created_at DESC,id DESC
) reviewed
WHERE demand.id=reviewed.demand_id
  AND demand.domain_id='technical-operations'
  AND demand.status<>'published'
  AND demand.last_error_code='CONTEXT_REQUIRED'
  AND cardinality(reviewed.missing_capabilities)>0
  AND cardinality(reviewed.next_searches)>0;
