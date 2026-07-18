\set ON_ERROR_STOP on

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
  clideck_mcp_api,
  clideck_mcp_admin,
  clideck_mcp_worker,
  clideck_mcp_researcher;

GRANT SELECT ON
  vendors,
  platforms,
  operating_systems,
  context_aliases,
  public_active_knowledge,
  knowledge_conflicts,
  active_release
TO clideck_mcp_api;
GRANT SELECT, UPDATE ON principals TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON expert_tasks TO clideck_mcp_api;
GRANT SELECT, INSERT ON task_messages TO clideck_mcp_api;
GRANT INSERT ON feedback TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO clideck_mcp_api;
GRANT SELECT, INSERT, UPDATE ON mcp_protocol_tasks TO clideck_mcp_api;
GRANT USAGE, SELECT ON SEQUENCE task_messages_id_seq TO clideck_mcp_api;

GRANT SELECT ON
  active_release,
  public_active_knowledge,
  expert_tasks,
  knowledge_conflicts,
  releases,
  release_items,
  feedback,
  source_documents,
  revision_sources,
  vendors,
  code_change_approvals
TO clideck_mcp_admin;
GRANT INSERT, UPDATE ON active_release TO clideck_mcp_admin;
GRANT UPDATE ON code_change_approvals TO clideck_mcp_admin;

GRANT SELECT, INSERT ON
  knowledge_items,
  knowledge_revisions
TO clideck_mcp_worker;
GRANT SELECT, INSERT, UPDATE ON
  source_documents,
  releases,
  active_release,
  worker_heartbeats
TO clideck_mcp_worker;
GRANT SELECT, INSERT ON
  revision_sources,
  release_items,
  task_artifacts
TO clideck_mcp_worker;
GRANT SELECT, UPDATE ON expert_tasks TO clideck_mcp_worker;
GRANT SELECT ON
  vendors,
  platforms,
  operating_systems,
  knowledge_conflicts
TO clideck_mcp_worker;
GRANT SELECT, DELETE ON rate_limit_buckets TO clideck_mcp_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clideck_mcp_worker;

GRANT SELECT, UPDATE ON expert_tasks TO clideck_mcp_researcher;
GRANT SELECT, INSERT ON task_messages TO clideck_mcp_researcher;
GRANT INSERT ON task_artifacts TO clideck_mcp_researcher;
GRANT SELECT, INSERT ON code_change_approvals TO clideck_mcp_researcher;
GRANT USAGE, SELECT ON SEQUENCE task_messages_id_seq TO clideck_mcp_researcher;

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
