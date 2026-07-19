ALTER FUNCTION current_knowledge_validation(uuid)
  SECURITY DEFINER;

ALTER FUNCTION current_knowledge_validation(uuid)
  SET search_path TO pg_catalog, public;

REVOKE ALL ON FUNCTION current_knowledge_validation(uuid) FROM PUBLIC;
