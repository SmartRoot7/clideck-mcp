BEGIN;

-- Production owns exactly eight isolated executor processes. Capacity is a
-- physical invariant, not an operator throttle or a stage-specific quota.
UPDATE pipeline_settings
SET max_concurrent_ai_runs = 8,
    max_deep_review_runs = 8,
    max_active_sources = 8,
    updated_at = now(),
    updated_by = '038_fixed_executor_capacity'
WHERE singleton;

COMMIT;
