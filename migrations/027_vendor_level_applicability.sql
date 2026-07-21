BEGIN;

CREATE TABLE vendor_software_families (
  vendor_id uuid PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  family_id uuid NOT NULL UNIQUE REFERENCES software_families(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
