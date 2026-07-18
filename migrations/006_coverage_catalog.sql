BEGIN;

INSERT INTO vendors (slug, display_name)
SELECT DISTINCT
  target.vendor_slug,
  CASE target.vendor_slug
    WHEN 'cisco' THEN 'Cisco'
    WHEN 'dell' THEN 'Dell'
    WHEN 'arista' THEN 'Arista'
    WHEN 'juniper' THEN 'Juniper'
    WHEN 'fortinet' THEN 'Fortinet'
    WHEN 'sonic' THEN 'SONiC'
    WHEN 'nokia' THEN 'Nokia'
    WHEN 'fs' THEN 'FS'
    WHEN 'lantronix' THEN 'Lantronix'
    ELSE initcap(replace(target.vendor_slug, '-', ' '))
  END
FROM coverage_targets target
ON CONFLICT (slug) DO UPDATE
SET display_name = excluded.display_name;

INSERT INTO operating_systems (
  vendor_id,
  slug,
  display_name,
  version_scheme
)
SELECT DISTINCT
  vendor.id,
  target.operating_system_slug,
  CASE
    WHEN target.vendor_slug = 'cisco'
      AND target.operating_system_slug = 'ios-xe'
      THEN 'Cisco IOS XE'
    WHEN target.vendor_slug = 'cisco'
      AND target.operating_system_slug = 'nx-os'
      THEN 'Cisco NX-OS'
    WHEN target.vendor_slug = 'cisco'
      AND target.operating_system_slug = 'asa'
      THEN 'Cisco ASA Software'
    WHEN target.vendor_slug = 'cisco'
      AND target.operating_system_slug = 'ios-xr'
      THEN 'Cisco IOS XR'
    WHEN target.vendor_slug = 'dell'
      AND target.operating_system_slug = 'os10'
      THEN 'Dell SmartFabric OS10'
    WHEN target.vendor_slug = 'dell'
      AND target.operating_system_slug = 'os9'
      THEN 'Dell Networking OS9'
    WHEN target.vendor_slug = 'arista'
      AND target.operating_system_slug = 'eos'
      THEN 'Arista EOS'
    WHEN target.vendor_slug = 'juniper'
      AND target.operating_system_slug = 'junos'
      THEN 'Juniper Junos'
    WHEN target.vendor_slug = 'fortinet'
      AND target.operating_system_slug = 'fortios'
      THEN 'Fortinet FortiOS'
    WHEN target.vendor_slug = 'sonic'
      AND target.operating_system_slug = 'sonic'
      THEN 'SONiC'
    WHEN target.vendor_slug = 'nokia'
      AND target.operating_system_slug = 'sros'
      THEN 'Nokia SR OS'
    WHEN target.vendor_slug = 'fs'
      AND target.operating_system_slug = 'fsos'
      THEN 'FSOS'
    WHEN target.vendor_slug = 'lantronix'
      AND target.operating_system_slug = 'slc-os'
      THEN 'Lantronix SLC OS'
    ELSE initcap(replace(target.operating_system_slug, '-', ' '))
  END,
  'vendor'
FROM coverage_targets target
JOIN vendors vendor ON vendor.slug = target.vendor_slug
ON CONFLICT (vendor_id, slug) DO UPDATE
SET display_name = excluded.display_name;

COMMIT;
