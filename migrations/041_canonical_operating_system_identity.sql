BEGIN;

CREATE OR REPLACE FUNCTION canonical_network_os_key(
  p_vendor_slug text,
  p_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT
      regexp_replace(lower(p_vendor_slug), '[^a-z0-9]+', '', 'g') AS vendor_key,
      regexp_replace(lower(p_value), '[^a-z0-9]+', '', 'g') AS os_key
  )
  SELECT CASE
    WHEN vendor_key <> '' AND os_key LIKE vendor_key || '%'
      THEN regexp_replace(os_key, '^(' || vendor_key || ')+', '')
    ELSE os_key
  END
  FROM normalized;
$$;

-- Repair the known IOS XE split. Keep the old catalog rows as aliases for
-- historical references, but move published knowledge and applicability to
-- the canonical Cisco IOS XE identity.
DO $$
DECLARE
  cisco_vendor_id uuid;
  canonical_os_id uuid;
  canonical_family_id uuid;
BEGIN
  SELECT id INTO cisco_vendor_id
  FROM vendors
  WHERE slug = 'cisco';

  IF cisco_vendor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO canonical_os_id
  FROM operating_systems
  WHERE vendor_id = cisco_vendor_id
    AND slug = 'ios-xe';

  IF canonical_os_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO software_families (
    slug, display_name, portability_mode, version_strategy
  ) VALUES (
    'cisco-ios-xe', 'Cisco IOS XE', 'vendor_specific', 'major_minor'
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name = excluded.display_name,
    portability_mode = excluded.portability_mode,
    version_strategy = excluded.version_strategy,
    updated_at = now()
  RETURNING id INTO canonical_family_id;

  UPDATE knowledge_revisions revision
  SET operating_system_id = canonical_os_id
  FROM operating_systems operating_system
  WHERE revision.vendor_id = cisco_vendor_id
    AND revision.operating_system_id = operating_system.id
    AND operating_system.vendor_id = cisco_vendor_id
    AND canonical_network_os_key('cisco', operating_system.slug) = 'iosxe';

  UPDATE knowledge_applicability_index applicability
  SET family_id = canonical_family_id,
      classifier_version = 'canonical-os-v1',
      classification_source = 'canonical_os_migration',
      classified_at = now()
  FROM knowledge_revisions revision
  WHERE applicability.revision_id = revision.id
    AND revision.vendor_id = cisco_vendor_id
    AND revision.operating_system_id = canonical_os_id
    AND applicability.family_id IN (
      SELECT id
      FROM software_families
      WHERE slug IN ('ios-xe', 'cisco-ios-xe', 'cisco-cisco-ios-xe')
    );

  INSERT INTO operating_system_family_memberships (
    operating_system_id, family_id, membership_kind
  ) VALUES (canonical_os_id, canonical_family_id, 'native')
  ON CONFLICT DO NOTHING;

  INSERT INTO software_family_aliases (family_id, alias)
  VALUES
    (canonical_family_id, 'Cisco IOS XE'),
    (canonical_family_id, 'Cisco IOS-XE'),
    (canonical_family_id, 'IOS XE'),
    (canonical_family_id, 'IOS-XE'),
    (canonical_family_id, 'ios-xe'),
    (canonical_family_id, 'cisco-ios-xe')
  ON CONFLICT (family_id, normalized_alias) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_deterministic_coverage_context(
  p_vendor_slug text,
  p_operating_system_slug text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  vendor_id_value uuid;
BEGIN
  IF p_vendor_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$'
     OR p_operating_system_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'DETERMINISTIC_CONTEXT_SLUG_INVALID';
  END IF;

  INSERT INTO vendors (slug, display_name)
  VALUES (
    p_vendor_slug,
    initcap(replace(p_vendor_slug, '-', ' '))
  )
  ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
  RETURNING id INTO vendor_id_value;

  IF NOT EXISTS (
    SELECT 1
    FROM operating_systems operating_system
    WHERE operating_system.vendor_id = vendor_id_value
      AND canonical_network_os_key(
        p_vendor_slug,
        operating_system.slug
      ) = canonical_network_os_key(
        p_vendor_slug,
        p_operating_system_slug
      )
  ) THEN
    INSERT INTO operating_systems (
      vendor_id,
      slug,
      display_name,
      version_scheme
    ) VALUES (
      vendor_id_value,
      p_operating_system_slug,
      initcap(replace(p_operating_system_slug, '-', ' ')),
      'vendor'
    )
    ON CONFLICT (vendor_id, slug) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION ensure_deterministic_coverage_context(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_deterministic_coverage_context(text, text)
TO clideck_mcp_worker;

COMMIT;
