BEGIN;

CREATE TABLE software_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
  ),
  display_name text NOT NULL CHECK (
    char_length(display_name) BETWEEN 1 AND 120
  ),
  portability_mode text NOT NULL CHECK (
    portability_mode IN ('portable', 'vendor_specific')
  ),
  version_strategy text NOT NULL DEFAULT 'vendor' CHECK (
    version_strategy IN (
      'vendor', 'major_minor', 'calendar', 'semantic', 'exact'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE software_family_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES software_families(id)
    ON DELETE CASCADE,
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 120),
  normalized_alias text GENERATED ALWAYS AS (
    lower(regexp_replace(alias, '[^[:alnum:]._-]+', '', 'g'))
  ) STORED,
  UNIQUE (family_id, normalized_alias)
);
CREATE INDEX software_family_aliases_lookup_idx
  ON software_family_aliases (normalized_alias, family_id);

CREATE TABLE software_family_inheritance (
  child_family_id uuid NOT NULL REFERENCES software_families(id)
    ON DELETE CASCADE,
  parent_family_id uuid NOT NULL REFERENCES software_families(id)
    ON DELETE CASCADE,
  compatibility text NOT NULL DEFAULT 'curated' CHECK (
    compatibility IN ('native', 'curated')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_family_id, parent_family_id),
  CHECK (child_family_id <> parent_family_id)
);

CREATE TABLE operating_system_family_memberships (
  operating_system_id uuid NOT NULL REFERENCES operating_systems(id)
    ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES software_families(id)
    ON DELETE CASCADE,
  membership_kind text NOT NULL DEFAULT 'native' CHECK (
    membership_kind IN ('native', 'compatible')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operating_system_id, family_id)
);
CREATE INDEX operating_system_family_memberships_family_idx
  ON operating_system_family_memberships (family_id, operating_system_id);

CREATE TABLE platform_architectures (
  platform_id uuid PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
  architecture_slug text NOT NULL CHECK (
    architecture_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
  ),
  classification_source text NOT NULL DEFAULT 'curated' CHECK (
    classification_source IN ('curated', 'vendor_documented')
  ),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_architectures_architecture_idx
  ON platform_architectures (architecture_slug, platform_id);

CREATE TABLE knowledge_applicability_index (
  revision_id uuid PRIMARY KEY REFERENCES knowledge_revisions(id)
    ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES software_families(id)
    ON DELETE RESTRICT,
  scope_level text NOT NULL CHECK (
    scope_level IN ('model', 'vendor_os', 'architecture', 'os_family')
  ),
  capability_slug text CHECK (
    capability_slug IS NULL OR
    capability_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
  ),
  vendor_id uuid REFERENCES vendors(id) ON DELETE RESTRICT,
  platform_id uuid REFERENCES platforms(id) ON DELETE RESTRICT,
  architecture_slug text,
  version_scope text NOT NULL CHECK (
    version_scope IN ('exact', 'range', 'branch', 'unbounded')
  ),
  version_branch text,
  portable_semantic_key bytea NOT NULL,
  requires_platform_confirmation boolean NOT NULL DEFAULT false,
  classifier_version text NOT NULL CHECK (
    classifier_version ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
  ),
  classification_source text NOT NULL CHECK (
    classification_source IN (
      'publication', 'deterministic_backfill', 'reviewed'
    )
  ),
  classified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_level = 'model' AND platform_id IS NOT NULL) OR
    (scope_level <> 'model' AND platform_id IS NULL)
  ),
  CHECK (
    (scope_level = 'vendor_os' AND vendor_id IS NOT NULL) OR
    scope_level <> 'vendor_os'
  ),
  CHECK (
    (scope_level = 'architecture' AND architecture_slug IS NOT NULL) OR
    scope_level <> 'architecture'
  ),
  CHECK (
    (version_scope = 'branch' AND version_branch IS NOT NULL) OR
    version_scope <> 'branch'
  )
);
CREATE INDEX knowledge_applicability_family_scope_idx
  ON knowledge_applicability_index (
    family_id, scope_level, vendor_id, platform_id, version_scope
  );
CREATE INDEX knowledge_applicability_semantic_idx
  ON knowledge_applicability_index (
    family_id, portable_semantic_key, scope_level
  );
CREATE INDEX knowledge_applicability_architecture_idx
  ON knowledge_applicability_index (
    family_id, architecture_slug, version_scope
  ) WHERE scope_level = 'architecture';

CREATE TABLE knowledge_applicability_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES knowledge_revisions(id)
    ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  platform_id uuid REFERENCES platforms(id) ON DELETE CASCADE,
  version_min text,
  version_max text,
  version_normalized_min integer[],
  version_normalized_max integer[],
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 1_000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(vendor_id, platform_id, version_min, version_max) > 0),
  CHECK (version_min IS NULL OR version_normalized_min IS NOT NULL),
  CHECK (version_max IS NULL OR version_normalized_max IS NOT NULL)
);
CREATE INDEX knowledge_applicability_exclusions_lookup_idx
  ON knowledge_applicability_exclusions (
    revision_id, vendor_id, platform_id
  );

CREATE TABLE applicability_reindex_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classifier_version text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('running', 'completed', 'failed')
  ),
  revisions_expected integer NOT NULL DEFAULT 0,
  revisions_indexed integer NOT NULL DEFAULT 0,
  last_revision_id uuid,
  portable_revisions integer NOT NULL DEFAULT 0,
  manifest_hash text,
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(breakdown) = 'array'
  ),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);
CREATE INDEX applicability_reindex_runs_recent_idx
  ON applicability_reindex_runs (started_at DESC);

ALTER TABLE knowledge_demands
  ADD COLUMN demand_kind text NOT NULL DEFAULT 'unknown' CHECK (
    demand_kind IN ('unknown', 'specificity_gap')
  );

CREATE OR REPLACE FUNCTION queue_network_knowledge_gap(
  p_tool_name text,
  p_question text,
  p_context jsonb,
  p_demand_key bytea
)
RETURNS TABLE (
  demand_id uuid,
  discovery_task_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_demand_id uuid;
  current_task_id uuid;
  was_created boolean;
  current_kind text;
BEGIN
  SELECT
    queued.demand_id,
    queued.discovery_task_id,
    queued.created
  INTO current_demand_id, current_task_id, was_created
  FROM queue_network_knowledge_demand(
    p_tool_name,
    p_question,
    p_context,
    p_demand_key
  ) queued;

  SELECT demand_kind
  INTO current_kind
  FROM knowledge_demands
  WHERE id = current_demand_id
  FOR UPDATE;

  IF was_created OR current_kind = 'specificity_gap' THEN
    UPDATE knowledge_demands
    SET demand_kind = 'specificity_gap',
        priority = 90
    WHERE id = current_demand_id;

    UPDATE pipeline_tasks
    SET priority = 90,
        payload = jsonb_set(
          payload,
          '{knowledge_demand,coverage_gap}',
          'true'::jsonb,
          true
        )
    WHERE id = current_task_id;

    UPDATE pipeline_events
    SET message = 'Queued discovery for a more specific applicability match.',
        metadata = metadata || jsonb_build_object(
          'priority', 90,
          'specificity_gap', true
        )
    WHERE pipeline_task_id = current_task_id
      AND event_type = 'queued';
  END IF;

  RETURN QUERY
  SELECT current_demand_id, current_task_id, was_created;
END;
$$;

REVOKE ALL ON FUNCTION queue_network_knowledge_gap(
  text,
  text,
  jsonb,
  bytea
) FROM PUBLIC;

INSERT INTO software_families (
  slug, display_name, portability_mode, version_strategy
)
VALUES
  ('onie', 'ONIE', 'portable', 'calendar'),
  ('sonic', 'SONiC', 'portable', 'calendar'),
  ('openwrt', 'OpenWrt', 'portable', 'major_minor'),
  ('debian', 'Debian', 'portable', 'major_minor'),
  ('linux-userspace', 'Linux userspace', 'portable', 'major_minor'),
  ('linux-iproute2', 'Linux iproute2', 'portable', 'major_minor'),
  ('linux-netfilter', 'Linux netfilter', 'portable', 'major_minor'),
  ('cumulus-linux', 'Cumulus Linux / NVUE', 'portable', 'major_minor'),
  ('cisco-nx-os', 'Cisco NX-OS', 'vendor_specific', 'major_minor'),
  ('cisco-ios-xe', 'Cisco IOS-XE', 'vendor_specific', 'major_minor')
ON CONFLICT (slug) DO UPDATE
SET display_name = EXCLUDED.display_name,
    portability_mode = EXCLUDED.portability_mode,
    version_strategy = EXCLUDED.version_strategy,
    updated_at = now();

WITH aliases(family_slug, alias) AS (
  VALUES
    ('onie', 'onie'),
    ('sonic', 'sonic'),
    ('openwrt', 'openwrt'),
    ('openwrt', 'openwrt-gl-inet-firmware'),
    ('debian', 'debian'),
    ('debian', 'debian-linux'),
    ('linux-userspace', 'linux'),
    ('linux-iproute2', 'linux-iproute2'),
    ('linux-netfilter', 'linux-netfilter'),
    ('cumulus-linux', 'cumulus-linux'),
    ('cumulus-linux', 'cumulus-linux-nvue'),
    ('cumulus-linux', 'nvidia-cumulus-linux'),
    ('cisco-nx-os', 'nx-os'),
    ('cisco-nx-os', 'nxos'),
    ('cisco-ios-xe', 'ios-xe'),
    ('cisco-ios-xe', 'iosxe')
)
INSERT INTO software_family_aliases (family_id, alias)
SELECT family.id, aliases.alias
FROM aliases
JOIN software_families family ON family.slug = aliases.family_slug
ON CONFLICT (family_id, normalized_alias) DO NOTHING;

INSERT INTO software_family_inheritance (
  child_family_id, parent_family_id, compatibility
)
SELECT child.id, parent.id, 'curated'
FROM software_families child
CROSS JOIN software_families parent
WHERE child.slug = 'debian'
  AND parent.slug IN (
    'linux-userspace', 'linux-iproute2', 'linux-netfilter'
  )
ON CONFLICT DO NOTHING;

INSERT INTO operating_system_family_memberships (
  operating_system_id, family_id, membership_kind
)
SELECT
  os.id,
  family.id,
  'native'
FROM operating_systems os
JOIN vendors vendor ON vendor.id = os.vendor_id
JOIN software_families family ON family.slug = CASE
  WHEN os.slug = 'onie' THEN 'onie'
  WHEN os.slug = 'sonic' THEN 'sonic'
  WHEN os.slug = 'openwrt' OR os.slug LIKE 'openwrt-%' THEN 'openwrt'
  WHEN os.slug = 'linux' THEN 'linux-userspace'
  WHEN os.slug = 'linux-iproute2' THEN 'linux-iproute2'
  WHEN os.slug = 'linux-netfilter' THEN 'linux-netfilter'
  WHEN os.slug LIKE '%cumulus-linux%' THEN 'cumulus-linux'
  WHEN vendor.slug = 'cisco' AND os.slug = 'nx-os' THEN 'cisco-nx-os'
  WHEN vendor.slug = 'cisco' AND os.slug = 'ios-xe' THEN 'cisco-ios-xe'
  ELSE NULL
END
ON CONFLICT DO NOTHING;

COMMIT;
