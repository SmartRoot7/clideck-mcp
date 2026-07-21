\set ON_ERROR_STOP on

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
  clideck_mcp_api,
  clideck_mcp_admin,
  clideck_mcp_worker,
  clideck_mcp_researcher,
  clideck_mcp_quarantine;

GRANT SELECT ON
  vendors,
  platforms,
  operating_systems,
  device_models,
  context_aliases,
  public_active_knowledge,
  public_active_domain_knowledge,
  public_active_release_summary,
  public_lab_validation_summary,
  public_latest_eval_result,
  domain_packs,
  knowledge_items,
  knowledge_revisions,
  knowledge_public_trust,
  knowledge_conflicts,
  active_release,
  release_items,
  release_changes,
  active_knowledge_state,
  pipeline_transition_events,
  public_stats_cache,
  knowledge_demands,
  demand_topics,
  knowledge_demand_topic_memberships,
  knowledge_demand_diagnostics,
  software_families,
  software_family_aliases,
  software_family_inheritance,
  operating_system_family_memberships,
  platform_architectures,
  knowledge_applicability_index,
  knowledge_applicability_exclusions,
  vendor_software_families
TO clideck_mcp_api;
GRANT SELECT, UPDATE ON principals TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON expert_tasks TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON verification_sessions TO clideck_mcp_api;
GRANT SELECT, INSERT ON task_messages TO clideck_mcp_api;
GRANT SELECT, INSERT ON task_public_events TO clideck_mcp_api;
GRANT INSERT ON feedback TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON public_usage_daily TO clideck_mcp_api;
GRANT INSERT ON mcp_request_logs TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON mcp_protocol_tasks TO clideck_mcp_api;
GRANT USAGE, SELECT ON SEQUENCE
  task_messages_id_seq,
  task_public_events_id_seq
TO clideck_mcp_api;

GRANT SELECT ON
  active_release,
  public_active_knowledge,
  public_active_domain_knowledge,
  public_active_release_summary,
  public_lab_validation_summary,
  public_latest_eval_result,
  domain_packs,
  expert_tasks,
  knowledge_conflicts,
  releases,
  release_items,
  release_changes,
  active_knowledge_state,
  feedback,
  source_documents,
  revision_sources,
  knowledge_items,
  knowledge_revisions,
  knowledge_revision_contracts,
  knowledge_validations,
  knowledge_public_trust,
  public_usage_daily,
  product_eval_runs,
  snapshot_contributions,
  task_public_events,
  device_models,
  context_aliases,
  vendors,
  platforms,
  operating_systems,
  code_change_approvals,
  coverage_targets,
  source_candidates,
  source_artifacts,
  source_fragments,
  pipeline_settings,
  pipeline_tasks,
  pipeline_events,
  knowledge_candidates,
  candidate_verifications,
  agent_runs,
  active_source_slots,
  source_collections,
  import_runs,
  import_items,
  legacy_revision_metadata,
  admin_audit_events,
  worker_heartbeats,
  pipeline_transition_events,
  verification_sessions,
  public_stats_cache,
  pipeline_reconciliation_snapshots,
  knowledge_demands,
  knowledge_demand_source_attempts,
  demand_topics,
  knowledge_demand_topic_memberships,
  knowledge_demand_diagnostics,
  mcp_request_logs,
  software_families,
  software_family_aliases,
  software_family_inheritance,
  operating_system_family_memberships,
  platform_architectures,
  knowledge_applicability_index,
  knowledge_applicability_exclusions,
  vendor_software_families,
  applicability_reindex_runs,
  pipeline_ai_circuits
TO clideck_mcp_admin;
GRANT INSERT ON product_eval_runs TO clideck_mcp_admin;
GRANT INSERT ON
  admin_audit_events,
  pipeline_events,
  pipeline_tasks
TO clideck_mcp_admin;
GRANT USAGE, SELECT ON SEQUENCE
  product_eval_runs_id_seq,
  pipeline_events_id_seq,
  admin_audit_events_id_seq
TO clideck_mcp_admin;
GRANT INSERT, UPDATE ON active_release TO clideck_mcp_admin;
GRANT INSERT, UPDATE, DELETE ON active_knowledge_state TO clideck_mcp_admin;
GRANT INSERT, UPDATE, DELETE ON active_source_slots
TO clideck_mcp_admin;
GRANT UPDATE ON
  code_change_approvals,
  pipeline_settings,
  coverage_targets,
  source_candidates,
  source_fragments,
  pipeline_tasks,
  knowledge_candidates,
  expert_tasks,
  knowledge_conflicts,
  agent_runs
TO clideck_mcp_admin;

GRANT SELECT, INSERT ON
  knowledge_items,
  knowledge_revisions,
  software_family_aliases,
  software_family_inheritance,
  operating_system_family_memberships,
  platform_architectures,
  knowledge_applicability_exclusions
TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON
  software_families,
  knowledge_applicability_index
TO clideck_mcp_worker;
GRANT SELECT ON
  domain_packs,
  public_active_domain_knowledge
TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON
  source_documents,
  releases,
  active_release,
  active_knowledge_state,
  worker_heartbeats,
  public_stats_cache
TO clideck_mcp_worker;
GRANT SELECT, INSERT ON
  revision_sources,
  release_items,
  release_changes,
  task_artifacts,
  knowledge_revision_contracts,
  knowledge_validations,
  knowledge_public_trust,
  task_public_events
TO clideck_mcp_worker;
GRANT SELECT, UPDATE ON expert_tasks TO clideck_mcp_worker;
GRANT SELECT ON
  vendors,
  platforms,
  operating_systems,
  device_models,
  context_aliases,
  public_active_knowledge,
  public_active_release_summary,
  software_families,
  software_family_aliases,
  software_family_inheritance,
  operating_system_family_memberships,
  platform_architectures,
  knowledge_applicability_index,
  knowledge_applicability_exclusions,
  vendor_software_families,
  public_lab_validation_summary,
  public_latest_eval_result,
  knowledge_conflicts,
  coverage_targets,
  source_candidates,
  source_artifacts,
  source_fragments,
  pipeline_settings,
  pipeline_tasks,
  pipeline_events,
  pipeline_transition_events,
  knowledge_candidates,
  candidate_verifications,
  agent_runs,
  active_source_slots,
  source_collections,
  knowledge_demands,
  knowledge_demand_source_attempts,
  demand_topics,
  knowledge_demand_topic_memberships,
  knowledge_demand_diagnostics,
  pipeline_ai_circuits,
  mcp_request_logs
TO clideck_mcp_worker;
GRANT INSERT, UPDATE, DELETE ON active_source_slots
TO clideck_mcp_worker;
GRANT INSERT, UPDATE ON
  source_artifacts,
  source_fragments,
  source_candidates,
  pipeline_tasks,
  pipeline_events,
  pipeline_transition_events,
  knowledge_candidates
TO clideck_mcp_worker;
GRANT INSERT ON candidate_verifications TO clideck_mcp_worker;
GRANT UPDATE ON
  coverage_targets,
  source_candidates,
  pipeline_settings,
  knowledge_candidates,
  agent_runs,
  source_collections
TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON public_stats_cache TO clideck_mcp_worker;
GRANT SELECT, DELETE ON verification_sessions TO clideck_mcp_worker;
GRANT UPDATE ON knowledge_demands TO clideck_mcp_worker;
GRANT INSERT, UPDATE ON demand_topics TO clideck_mcp_worker;
GRANT INSERT, UPDATE ON knowledge_demand_topic_memberships
TO clideck_mcp_worker;
GRANT INSERT, UPDATE ON knowledge_demand_diagnostics
TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON knowledge_demand_source_attempts
TO clideck_mcp_worker;
GRANT DELETE ON mcp_request_logs TO clideck_mcp_worker;
GRANT SELECT, INSERT ON pipeline_reconciliation_snapshots
TO clideck_mcp_worker;
GRANT SELECT, UPDATE, DELETE ON snapshot_contributions TO clideck_mcp_worker;
GRANT UPDATE ON knowledge_public_trust TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON public_usage_daily TO clideck_mcp_worker;
GRANT SELECT, DELETE ON rate_limit_buckets TO clideck_mcp_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clideck_mcp_worker;

GRANT EXECUTE ON FUNCTION current_knowledge_validation(uuid) TO
  clideck_mcp_api,
  clideck_mcp_admin,
  clideck_mcp_worker,
  clideck_mcp_researcher;
GRANT EXECUTE ON FUNCTION queue_network_knowledge_demand(
  text,
  text,
  jsonb,
  bytea
) TO clideck_mcp_api;
GRANT EXECUTE ON FUNCTION queue_network_knowledge_gap(
  text,
  text,
  jsonb,
  bytea
) TO clideck_mcp_api;

GRANT SELECT, UPDATE ON expert_tasks TO clideck_mcp_researcher;
GRANT SELECT, INSERT ON task_messages TO clideck_mcp_researcher;
GRANT SELECT, INSERT ON task_public_events TO clideck_mcp_researcher;
GRANT INSERT ON task_artifacts TO clideck_mcp_researcher;
GRANT SELECT, INSERT ON code_change_approvals TO clideck_mcp_researcher;
GRANT SELECT ON
  coverage_targets,
  source_candidates,
  source_artifacts,
  source_fragments,
  pipeline_settings,
  pipeline_tasks,
  pipeline_events,
  pipeline_transition_events,
  knowledge_candidates,
  candidate_verifications,
  agent_runs,
  active_source_slots,
  source_collections,
  worker_heartbeats,
  pipeline_ai_circuits,
  vendors,
  platforms,
  operating_systems,
  knowledge_items,
  knowledge_conflicts,
  task_artifacts,
  knowledge_demands,
  knowledge_demand_source_attempts,
  demand_topics,
  knowledge_demand_topic_memberships,
  knowledge_demand_diagnostics
TO clideck_mcp_researcher;
GRANT INSERT ON
  source_candidates,
  pipeline_tasks,
  pipeline_events,
  pipeline_transition_events,
  knowledge_candidates,
  candidate_verifications,
  agent_runs,
  active_source_slots,
  worker_heartbeats,
  pipeline_ai_circuits
TO clideck_mcp_researcher;
GRANT INSERT, UPDATE ON
  demand_topics,
  knowledge_demand_topic_memberships,
  knowledge_demand_diagnostics
TO clideck_mcp_researcher;
GRANT UPDATE ON
  coverage_targets,
  source_candidates,
  source_fragments,
  pipeline_settings,
  pipeline_tasks,
  knowledge_candidates,
  active_source_slots,
  agent_runs,
  worker_heartbeats,
  pipeline_ai_circuits,
  knowledge_demands
TO clideck_mcp_researcher;
GRANT INSERT, UPDATE ON knowledge_demand_source_attempts
TO clideck_mcp_researcher;
GRANT DELETE ON active_source_slots TO clideck_mcp_researcher;
GRANT DELETE ON pipeline_ai_circuits TO clideck_mcp_researcher;
GRANT USAGE, SELECT ON SEQUENCE
  task_messages_id_seq,
  task_public_events_id_seq,
  pipeline_events_id_seq,
  pipeline_transition_events_id_seq
TO clideck_mcp_researcher;

GRANT USAGE, SELECT ON SEQUENCE
  mcp_request_logs_id_seq
TO clideck_mcp_api, clideck_mcp_admin, clideck_mcp_worker;

GRANT SELECT, INSERT, UPDATE ON
  snapshot_contributions
TO clideck_mcp_quarantine;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO clideck_mcp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO clideck_mcp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE clideck_mcp_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE clideck_mcp_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE clideck_mcp_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO clideck_mcp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE clideck_mcp_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO clideck_mcp_backup;
