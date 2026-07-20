-- The deterministic publisher resolves vendor/model/OS aliases while it
-- creates a revision. This permission must travel with the schema, rather
-- than relying only on the production grants replay.
GRANT SELECT ON context_aliases TO clideck_mcp_worker;
