\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE clideck_mcp_migrator LOGIN PASSWORD %L',
  :'migrator_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_migrator'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_api LOGIN PASSWORD %L',
  :'api_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_api'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_admin LOGIN PASSWORD %L',
  :'admin_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_admin'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_worker LOGIN PASSWORD %L',
  :'worker_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_worker'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_researcher LOGIN PASSWORD %L',
  :'researcher_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_researcher'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_quarantine LOGIN PASSWORD %L',
  :'quarantine_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_quarantine'
)
\gexec

SELECT format(
  'CREATE ROLE clideck_mcp_backup LOGIN PASSWORD %L',
  :'backup_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'clideck_mcp_backup'
)
\gexec

SELECT format(
  'ALTER ROLE clideck_mcp_migrator PASSWORD %L',
  :'migrator_password'
)
\gexec
SELECT format('ALTER ROLE clideck_mcp_api PASSWORD %L', :'api_password')
\gexec
SELECT format(
  'ALTER ROLE clideck_mcp_admin PASSWORD %L',
  :'admin_db_password'
)
\gexec
SELECT format('ALTER ROLE clideck_mcp_worker PASSWORD %L', :'worker_password')
\gexec
SELECT format(
  'ALTER ROLE clideck_mcp_researcher PASSWORD %L',
  :'researcher_db_password'
)
\gexec
SELECT format(
  'ALTER ROLE clideck_mcp_quarantine PASSWORD %L',
  :'quarantine_password'
)
\gexec
SELECT format(
  'ALTER ROLE clideck_mcp_backup PASSWORD %L',
  :'backup_password'
)
\gexec

ALTER ROLE clideck_mcp_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_admin NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_researcher NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_quarantine NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE clideck_mcp_backup NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

SELECT 'CREATE DATABASE clideck_mcp OWNER clideck_mcp_migrator'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'clideck_mcp'
)
\gexec

ALTER DATABASE clideck_mcp OWNER TO clideck_mcp_migrator;
REVOKE ALL ON DATABASE clideck_mcp FROM PUBLIC;
GRANT CONNECT ON DATABASE clideck_mcp TO
  clideck_mcp_migrator,
  clideck_mcp_api,
  clideck_mcp_admin,
  clideck_mcp_worker,
  clideck_mcp_researcher,
  clideck_mcp_quarantine,
  clideck_mcp_backup;
