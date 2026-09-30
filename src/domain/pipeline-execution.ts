import {
  executionCatalogReportSchema,
  executionSettingsInputSchema,
  type ExecutionCatalogReport,
  type ExecutionProfile,
  type ExecutionSettingsInput,
  type ModelPrice
} from '@clideck/admin-contracts'

import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'

export const capacityLockSql = "SELECT pg_advisory_xact_lock(hashtext('clideck-mcp:ai-capacity'))"
export const catalogMaxAgeMs = 15 * 60_000
export const pricingSource = 'https://learn.chatgpt.com/docs/pricing'

export function fidelityExecutionProfileKey(
  extractionModel: string, extractionEffort: string, verifierModel: string, verifierEffort: string,
) {
  if (extractionModel === 'gpt-5.6-luna' && extractionEffort === 'low' &&
    verifierModel === 'gpt-5.6-luna' && verifierEffort === 'low') return 'pipeline-v2-default'
  return JSON.stringify(['extract-1', 'fidelity-1', extractionModel, extractionEffort, verifierModel, verifierEffort])
}

export async function ensureFidelityExecutionProfile(client: DatabaseClient, key: string, extractionModel: string) {
  const query = `SELECT id, checked_count, material_error_count, forced_full_batches_remaining
    FROM pipeline_quality_profiles WHERE stage = 'extract_fidelity' AND profile_key = $1`
  type QualityProfile = { id: string; checked_count: string; material_error_count: string; forced_full_batches_remaining: number }
  let existing = await client.query<QualityProfile>(query, [key])
  if (existing.rows[0]) return existing.rows[0]
  // Do not re-enter the hot unique index on every batch while counters change.
  await client.query(`INSERT INTO pipeline_quality_profiles (stage, profile_key, extractor_version, prompt_version, model)
    VALUES ('extract_fidelity', $1, 'pipeline-v2-extract-1', 'pipeline-v2-fidelity-1', $2)
    ON CONFLICT (stage, profile_key) DO NOTHING`, [key, extractionModel])
  existing = await client.query<QualityProfile>(query, [key])
  return existing.rows[0]!
}

export async function readExecutionProfiles(client: Database | DatabaseClient) {
  const result = await client.query<ExecutionProfile>(
    'SELECT * FROM pipeline_execution_profiles ORDER BY profile_id',
  )
  return result.rows
}

export async function getExecutionSettings(database: Database) {
  // Version and profiles must come from the same MVCC snapshot; mixing separate
  // reads could let an old form overwrite profiles using a newer version.
  const settings = await database.query<{
    settings_version: number; max_concurrent_ai_runs: number; enabled: boolean;
    profiles: ExecutionProfile[]; active_runs: number
  }>(`SELECT settings_version, max_concurrent_ai_runs, enabled,
    (SELECT jsonb_agg(to_jsonb(profile) ORDER BY profile_id) FROM pipeline_execution_profiles profile) AS profiles,
    (SELECT count(*)::int FROM agent_runs WHERE status = 'running') AS active_runs
    FROM pipeline_settings WHERE singleton`)
  const value = settings.rows[0]!
  return { ...value, draining_runs: Math.max(0, value.active_runs - value.max_concurrent_ai_runs) }
}

export async function publishExecutionCatalog(
  database: Database,
  input: ExecutionCatalogReport,
  publisherId: string,
) {
  const report = executionCatalogReportSchema.parse(input)
  // The old successful catalog survives a transient CLI/auth/network failure.
  await database.query(
    `UPDATE pipeline_runtime_catalog SET
       protocol_version = $1, cli_version = $2,
       models = CASE WHEN $3::text IS NULL THEN $4::jsonb ELSE models END,
       supports_structured_output = $5, supports_web_research = $6,
       error = $3, updated_at = now(),
       last_success_at = CASE WHEN $3::text IS NULL THEN now() ELSE last_success_at END,
       publisher_id = $7 WHERE singleton`,
    [report.protocol_version, report.cli_version, report.error,
      JSON.stringify(report.models), report.supports_structured_output,
      report.supports_web_research, publisherId],
  )
  return { accepted: true }
}

export async function setExecutionSettings(
  database: Database,
  input: ExecutionSettingsInput,
  actor: { id: string; role: string },
) {
  const settings = executionSettingsInputSchema.parse(input)
  await withTransaction(database, async (client) => {
    await client.query(capacityLockSql)
    const current = await client.query<{ settings_version: number; max_concurrent_ai_runs: number }>(
      'SELECT settings_version, max_concurrent_ai_runs FROM pipeline_settings WHERE singleton FOR UPDATE',
    )
    if (current.rows[0]?.settings_version !== settings.expected_version) {
      throw new Error('EXECUTION_SETTINGS_CONFLICT')
    }
    const beforeProfiles = await readExecutionProfiles(client)
    const changed = settings.profiles.filter((profile) =>
      JSON.stringify(profile) !== JSON.stringify(beforeProfiles.find((old) => old.profile_id === profile.profile_id)),
    )
    if (changed.length) {
      const catalog = await client.query<{
        models: ExecutionCatalogReport['models']; last_success_at: Date | null;
        error: string | null; supports_structured_output: boolean; supports_web_research: boolean
      }>('SELECT * FROM pipeline_runtime_catalog WHERE singleton')
      const value = catalog.rows[0]
      if (!value?.last_success_at || value.error ||
        Date.now() - new Date(value.last_success_at).getTime() > catalogMaxAgeMs) {
        throw new Error('EXECUTION_CATALOG_STALE')
      }
      if (!value.supports_structured_output || !value.supports_web_research) {
        throw new Error('CODEX_INCOMPATIBLE')
      }
      for (const profile of changed) {
        for (const [model, effort] of [
          [profile.model, profile.reasoning_effort],
          [profile.fallback_model, profile.fallback_reasoning_effort]
        ]) {
          if (!model || !effort) continue
          const available = value.models.find((candidate) => candidate.model === model)
          if (!available || !available.reasoning_efforts.includes(effort as ExecutionProfile['reasoning_effort'])) {
            throw new Error('EXECUTION_MODEL_UNSUPPORTED')
          }
        }
        await client.query(
          `UPDATE pipeline_execution_profiles SET model = $2, reasoning_effort = $3,
             fallback_model = $4, fallback_reasoning_effort = $5 WHERE profile_id = $1`,
          [profile.profile_id, profile.model, profile.reasoning_effort,
            profile.fallback_model, profile.fallback_reasoning_effort],
        )
      }
    }
    await client.query(
      `UPDATE pipeline_settings SET max_concurrent_ai_runs = $1,
         settings_version = settings_version + 1, updated_at = now(), updated_by = $2 WHERE singleton`,
      [settings.max_concurrent_ai_runs, actor.id],
    )
    const metadata = JSON.stringify({ before: { ...current.rows[0], profiles: beforeProfiles }, after: settings })
    await client.query(
      `INSERT INTO admin_audit_events (actor_id, actor_role, action, target_type, metadata)
       VALUES ($1, $2, 'pipeline.execution_settings', 'pipeline', $3::jsonb)`,
      [actor.id, actor.role, metadata],
    )
    await client.query(
      `INSERT INTO pipeline_events (stage, event_type, message, metadata)
       VALUES ('system', 'progress', 'Agent capacity and execution profiles updated.', $1::jsonb)`,
      [metadata],
    )
  })
  return getExecutionSettings(database)
}

// All aliases below are internal SQL identifiers, never request input.
export function claimableExecutionSql(alias: string) {
  return `NOT EXISTS (
    SELECT 1 FROM pipeline_execution_profiles profile
    JOIN pipeline_model_circuits circuit
      ON circuit.execution_profile = profile.profile_id
      AND circuit.model = profile.model AND circuit.reasoning_effort = profile.reasoning_effort
    WHERE profile.profile_id = ${alias}.execution_profile
      AND circuit.task_type = ${alias}.task_type
      AND (circuit.configuration_error OR circuit.open_until > now() OR circuit.probe_executor_id IS NOT NULL)
      AND NOT (
        profile.fallback_model IS NOT NULL
        AND ${alias}.payload->>'model_fallback_attempted_for' IS DISTINCT FROM
          (profile.model || ':' || profile.reasoning_effort)
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_model_circuits fallback
          WHERE fallback.execution_profile = profile.profile_id
            AND fallback.task_type = ${alias}.task_type
            AND fallback.model = profile.fallback_model
            AND fallback.reasoning_effort = profile.fallback_reasoning_effort
            AND (fallback.configuration_error OR fallback.open_until > now() OR fallback.probe_executor_id IS NOT NULL)
        )
      )
  )`
}

export async function clearStaleModelProbes(client: DatabaseClient) {
  await client.query(`UPDATE pipeline_model_circuits circuit SET probe_executor_id = NULL, updated_at = now()
    WHERE probe_executor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agent_runs run JOIN pipeline_tasks task ON task.id = run.pipeline_task_id
      WHERE run.executor_id = circuit.probe_executor_id
        AND run.model = circuit.model AND run.reasoning_effort = circuit.reasoning_effort
        AND run.execution_profile = circuit.execution_profile AND task.task_type = circuit.task_type
        AND run.status = 'running' AND task.status IN ('claimed', 'running') AND task.lease_until > now()
    )`)
}

function priceModelId(name: string) {
  if (name === 'Daybreak Blue') return 'gpt-daybreak-blue-latest'
  if (name === 'Daybreak Red') return 'gpt-daybreak-red-latest'
  return name.toLowerCase().replaceAll(/\s+/g, '-')
}

export function parseCodexPrices(source: string): ModelPrice[] {
  const section = source.split('#### Token rates')[1]
  const table = section?.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1]
  if (!table || !/Credits per 1M tokens/.test(table)) throw new Error('PRICING_FORMAT_CHANGED')
  const prices: ModelPrice[] = []
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => cell[1]!.replaceAll(/<[^>]*>/g, '').trim())
    if (cells.length !== 4 || !/^(GPT-|Daybreak )/.test(cells[0]!)) continue
    const values = cells.slice(1).map((cell) => {
      if (!/^[\d,.]+ credits$/.test(cell)) throw new Error('PRICING_FORMAT_CHANGED')
      return Number(cell.replaceAll(',', '').replace(' credits', ''))
    })
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('PRICING_FORMAT_CHANGED')
    prices.push({ model: priceModelId(cells[0]!), display_name: cells[0]!,
      input: values[0]!, cached_input: values[1]!, output: values[2]! })
  }
  if (!prices.length) throw new Error('PRICING_FORMAT_CHANGED')
  return prices
}

const pricingRefreshes = new WeakMap<Database, Promise<void>>()
export async function refreshModelPricing(database: Database, force = false) {
  const running = pricingRefreshes.get(database)
  if (running) return running
  const operation = (async () => {
    const cache = await database.query<{ checked_at: Date | null }>('SELECT checked_at FROM pipeline_model_pricing WHERE singleton')
    if (!force && cache.rows[0]?.checked_at &&
      Date.now() - new Date(cache.rows[0].checked_at).getTime() < 6 * 3_600_000) return
    try {
      const response = await fetch(`${pricingSource}.md`, {
        signal: AbortSignal.timeout(8_000), redirect: 'error',
        headers: { accept: 'text/markdown' }
      })
      if (!response.ok) throw new Error('PRICING_SOURCE_UNAVAILABLE')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('PRICING_SOURCE_UNAVAILABLE')
      let source = ''
      let size = 0
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 1024 * 1024) throw new Error('PRICING_SOURCE_TOO_LARGE')
          source += decoder.decode(part.value, { stream: true })
        }
      } finally { await reader.cancel() }
      const prices = parseCodexPrices(source)
      await database.query(`UPDATE pipeline_model_pricing SET prices = $1::jsonb,
        updated_at = now(), checked_at = now(), error = NULL WHERE singleton`, [JSON.stringify(prices)])
    } catch {
      await database.query(`UPDATE pipeline_model_pricing SET checked_at = now(),
        error = 'PRICING_REFRESH_FAILED' WHERE singleton`)
    }
  })()
  pricingRefreshes.set(database, operation)
  try { await operation } finally { pricingRefreshes.delete(database) }
}

export async function getExecutionModels(database: Database) {
  const [catalogResult, pricingResult, metrics, circuits] = await Promise.all([
    database.query('SELECT * FROM pipeline_runtime_catalog WHERE singleton'),
    database.query('SELECT * FROM pipeline_model_pricing WHERE singleton'),
    database.query(`WITH runs AS (
      SELECT model, reasoning_effort, count(*)::int AS runs,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status IN ('failed', 'timed_out'))::int AS failed,
        avg(duration_ms)::float8 AS avg_duration_ms,
        sum(input_tokens)::float8 AS input_tokens, sum(cached_input_tokens)::float8 AS cached_input_tokens,
        sum(output_tokens)::float8 AS output_tokens, sum(reasoning_output_tokens)::float8 AS reasoning_output_tokens
      FROM agent_runs WHERE started_at >= now() - interval '7 days'
      GROUP BY model, reasoning_effort
    ), quality AS (
      SELECT qc.extraction_model AS model, qc.extraction_reasoning_effort AS reasoning_effort, count(*)::int AS quality_checks,
        count(*) FILTER (WHERE qc.material_error)::int AS material_errors
      FROM pipeline_quality_checks qc
      WHERE qc.created_at >= now() - interval '7 days' AND qc.extraction_model IS NOT NULL
      GROUP BY qc.extraction_model, qc.extraction_reasoning_effort
    ) SELECT runs.*, coalesce(quality.quality_checks, 0)::int AS quality_checks,
      coalesce(quality.material_errors, 0)::int AS material_errors
      FROM runs LEFT JOIN quality USING (model, reasoning_effort) ORDER BY runs.model, runs.reasoning_effort`),
    database.query(`SELECT circuit.execution_profile, circuit.task_type, circuit.model, circuit.reasoning_effort,
      circuit.open_until, circuit.configuration_error FROM pipeline_model_circuits circuit
      JOIN pipeline_execution_profiles profile ON profile.profile_id = circuit.execution_profile
        AND ((profile.model = circuit.model AND profile.reasoning_effort = circuit.reasoning_effort)
          OR (profile.fallback_model = circuit.model AND profile.fallback_reasoning_effort = circuit.reasoning_effort))
      WHERE circuit.configuration_error OR circuit.open_until > now()`)
  ])
  const catalog = catalogResult.rows[0]!
  const pricing = pricingResult.rows[0]!
  return {
    catalog: { protocol_version: catalog['protocol_version'], cli_version: catalog['cli_version'],
      models: catalog['models'], error: catalog['error'],
      supports_structured_output: catalog['supports_structured_output'], supports_web_research: catalog['supports_web_research'],
      updated_at: catalog['updated_at'], last_success_at: catalog['last_success_at'],
      stale: !catalog['last_success_at'] || Boolean(catalog['error']) ||
        Date.now() - new Date(catalog['last_success_at']).getTime() > catalogMaxAgeMs },
    pricing: { unit: 'credits_per_million_tokens', speed: 'standard', source_url: pricingSource,
      prices: pricing['prices'], updated_at: pricing['updated_at'], checked_at: pricing['checked_at'],
      error: pricing['error'], stale: !pricing['updated_at'] || Boolean(pricing['error']) ||
        Date.now() - new Date(pricing['updated_at']).getTime() > 24 * 3_600_000 },
    metrics: metrics.rows, circuits: circuits.rows
  }
}

export async function requestModelRefresh(database: Database) {
  await database.query('UPDATE pipeline_runtime_catalog SET refresh_requested_at = now() WHERE singleton')
  await refreshModelPricing(database, true)
  return { accepted: true }
}

export async function retryConfiguredModel(database: Database,
  input: { profile_id: string; model: string; reasoning_effort: string }, actor: { id: string; role: string }) {
  await withTransaction(database, async (client) => {
    await client.query(capacityLockSql)
    const selected = await client.query(`SELECT 1 FROM pipeline_execution_profiles WHERE profile_id = $1
      AND ((model = $2 AND reasoning_effort = $3) OR (fallback_model = $2 AND fallback_reasoning_effort = $3))`,
      [input.profile_id, input.model, input.reasoning_effort])
    if (!selected.rows[0]) throw new Error('EXECUTION_MODEL_UNSUPPORTED')
    await client.query(`UPDATE pipeline_model_circuits SET configuration_error = false, open_until = now(),
      probe_executor_id = NULL, updated_at = now()
      WHERE execution_profile = $1 AND model = $2 AND reasoning_effort = $3`,
      [input.profile_id, input.model, input.reasoning_effort])
    await client.query(`INSERT INTO admin_audit_events (actor_id, actor_role, action, target_type, metadata)
      VALUES ($1, $2, 'pipeline.model_retry', 'pipeline', $3::jsonb)`, [actor.id, actor.role, JSON.stringify(input)])
  })
  return { accepted: true }
}
