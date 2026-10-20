-- Claim ordering checks only the latest completed search for each user demand.
CREATE INDEX pipeline_tasks_demand_discovery_progress_idx
  ON pipeline_tasks (knowledge_demand_id, completed_at DESC)
  WHERE task_type = 'source_discovery' AND status = 'completed';
