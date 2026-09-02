BEGIN;

-- IOS XE has appeared in source material as both `ios-xe` and
-- `cisco-ios-xe`. Keep the immutable operating-system rows for provenance,
-- but make every equivalent row a member of one canonical software family.
DO $$
DECLARE
  cisco_vendor_id uuid;
  canonical_family_id uuid;
BEGIN
  SELECT id INTO cisco_vendor_id
  FROM vendors
  WHERE slug = 'cisco';

  IF cisco_vendor_id IS NULL THEN
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

  INSERT INTO operating_system_family_memberships (
    operating_system_id, family_id, membership_kind
  )
  SELECT operating_system.id, canonical_family_id, 'native'
  FROM operating_systems operating_system
  WHERE operating_system.vendor_id = cisco_vendor_id
    AND canonical_network_os_key('cisco', operating_system.slug) = 'iosxe'
  ON CONFLICT DO NOTHING;

  INSERT INTO software_family_aliases (family_id, alias)
  SELECT canonical_family_id, alias.alias
  FROM software_family_aliases alias
  JOIN software_families family ON family.id = alias.family_id
  WHERE family.slug IN ('ios-xe', 'cisco-cisco-ios-xe')
  ON CONFLICT (family_id, normalized_alias) DO NOTHING;

  INSERT INTO software_family_aliases (family_id, alias)
  VALUES
    (canonical_family_id, 'Cisco IOS XE'),
    (canonical_family_id, 'Cisco IOS-XE'),
    (canonical_family_id, 'IOS XE'),
    (canonical_family_id, 'IOS-XE'),
    (canonical_family_id, 'ios-xe'),
    (canonical_family_id, 'cisco-ios-xe')
  ON CONFLICT (family_id, normalized_alias) DO NOTHING;

  UPDATE knowledge_applicability_index applicability
  SET family_id = canonical_family_id,
      classified_at = now()
  FROM knowledge_revisions revision
  JOIN operating_systems operating_system
    ON operating_system.id = revision.operating_system_id
  WHERE applicability.revision_id = revision.id
    AND revision.vendor_id = cisco_vendor_id
    AND operating_system.vendor_id = cisco_vendor_id
    AND canonical_network_os_key('cisco', operating_system.slug) = 'iosxe'
    AND applicability.family_id <> canonical_family_id;

  DELETE FROM operating_system_family_memberships membership
  USING operating_systems operating_system, software_families family
  WHERE membership.operating_system_id = operating_system.id
    AND membership.family_id = family.id
    AND operating_system.vendor_id = cisco_vendor_id
    AND canonical_network_os_key('cisco', operating_system.slug) = 'iosxe'
    AND family.slug IN ('ios-xe', 'cisco-cisco-ios-xe');

  DELETE FROM software_family_aliases alias
  USING software_families family
  WHERE alias.family_id = family.id
    AND family.slug IN ('ios-xe', 'cisco-cisco-ios-xe');
END;
$$;

COMMIT;
