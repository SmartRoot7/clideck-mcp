import {
  executionModelsSchema, executionSettingsSchema,
  type ExecutionModels, type ExecutionProfile, type ExecutionSettingsInput
} from '@clideck/admin-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Button, DataTable, ErrorState, LoadingState, Panel, Status } from '../components/ui'
import { AdminApiError, getJson } from '../lib/api'
import { compactNumber, duration, formatDate, formatNumber } from '../lib/format'
import { useOperationsRuntime } from '../lib/runtime'

const PROFILE_NAMES = { luna: 'Luna', luna_high: 'Luna High' }
const ERRORS: Record<string, string> = {
  EXECUTION_SETTINGS_CONFLICT: 'Settings changed in another session. Cancel your edits to load the latest values.',
  EXECUTION_CATALOG_STALE: 'Refresh the model catalog before changing models. Agent count can still be changed.',
  EXECUTION_MODEL_UNSUPPORTED: 'The selected model or reasoning level is unavailable in this Codex runtime.',
  CODEX_INCOMPATIBLE: 'The executor Codex needs an update before these models can be used.'
}

export function ModelsPage() {
  return <div className="dashboard-stack"><ExecutionSettingsPanel compare /></div>
}

export function ExecutionSettingsPanel({ compare = false }: { compare?: boolean }) {
  const runtime = useOperationsRuntime()
  const queryClient = useQueryClient()
  const readonly = runtime.role === 'public_demo'
  const settings = useQuery({
    queryKey: [runtime.apiPrefix, 'execution-settings'],
    queryFn: () => getJson(`${runtime.apiPrefix}/pipeline/settings`, executionSettingsSchema),
    refetchInterval: 10_000
  })
  const models = useQuery({
    queryKey: [runtime.apiPrefix, 'execution-models'],
    queryFn: () => getJson(`${runtime.apiPrefix}/pipeline/models`, executionModelsSchema),
    refetchInterval: 30_000
  })
  const [draft, setDraft] = useState<ExecutionSettingsInput | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'output' | 'input' | 'name'>('output')
  const mutation = useMutation({
    mutationFn: (value: ExecutionSettingsInput) => runtime.executeMutation('/admin/api/v1/pipeline/settings', value),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      setDraft(null); setError(''); setMessage(result.message)
    },
    onError: (current) => {
      setError(current instanceof AdminApiError && current.status === 409
        ? ERRORS['EXECUTION_SETTINGS_CONFLICT']!
        : ERRORS[current instanceof Error ? current.message : ''] ?? 'Settings could not be saved. Your edits are still here.')
    }
  })
  const refresh = useMutation({
    mutationFn: () => runtime.executeMutation('/admin/api/v1/pipeline/models/refresh', {}),
    onSuccess: async (result) => { setMessage(result.message); await models.refetch() },
    onError: () => setError('Refresh failed. The last known catalog and prices are retained.')
  })
  const retry = useMutation({
    mutationFn: (circuit: ExecutionModels['circuits'][number]) => runtime.executeMutation('/admin/api/v1/pipeline/models/retry', {
      profile_id: circuit.execution_profile, model: circuit.model, reasoning_effort: circuit.reasoning_effort
    }),
    onSuccess: async (result) => { setMessage(result.message); await models.refetch() },
    onError: () => setError('This model could not be scheduled for a retry.')
  })
  if (settings.isLoading) return <LoadingState label="Loading agent settings…" />
  if (!settings.data) return <ErrorState onRetry={() => void settings.refetch()}>Agent settings are unavailable.</ErrorState>
  const current = settings.data
  const value: ExecutionSettingsInput = draft ?? {
    expected_version: current.settings_version,
    max_concurrent_ai_runs: current.max_concurrent_ai_runs,
    profiles: current.profiles
  }
  const catalog = models.data?.catalog
  const pricing = models.data?.pricing
  const changeProfile = (id: ExecutionProfile['profile_id'], changes: Partial<ExecutionProfile>) => {
    setError(''); setMessage('')
    setDraft({ ...value, profiles: value.profiles.map((profile) => profile.profile_id === id ? { ...profile, ...changes } : profile) })
  }
  const chooseModel = (id: ExecutionProfile['profile_id'], model: string) => {
    const profile = value.profiles.find((entry) => entry.profile_id === id)!
    const option = catalog?.models.find((entry) => entry.model === model)
    if (!option) return
    changeProfile(id, { model, reasoning_effort: option.reasoning_efforts.includes(profile.reasoning_effort)
      ? profile.reasoning_effort : option.default_reasoning_effort })
  }
  const selectedPrice = (model: string) => pricing?.prices.find((price) => price.model === model)
  const options = (model: string) => {
    const entries = catalog?.models ?? []
    return <>
      {model && !entries.some((entry) => entry.model === model) && <option value={model}>{model} · saved model</option>}
      {entries.map((entry) => <option value={entry.model} key={entry.model}>{entry.display_name}</option>)}
    </>
  }
  return <>
    <Panel title="Agents and models" icon={Bot} help="Choose the shared agent count and independent models for standard and advanced tasks. Changes apply to newly claimed tasks."
      action={<a className="button" href={`${runtime.routePrefix}/models`}>Compare models &amp; prices</a>}>
      <div className="execution-capacity">
        <label className="field" htmlFor="agent-count">Enabled agents
          <input id="agent-count" type="number" min="1" max="8" step="1" disabled={readonly || mutation.isPending}
            value={value.max_concurrent_ai_runs} onChange={(event) => {
              const count = Number(event.target.value)
              if (Number.isInteger(count) && count >= 1 && count <= 8) setDraft({ ...value, max_concurrent_ai_runs: count })
            }} />
        </label>
        <input aria-label="Enabled agents slider" type="range" min="1" max="8" step="1" value={value.max_concurrent_ai_runs}
          disabled={readonly || mutation.isPending} onChange={(event) => setDraft({ ...value, max_concurrent_ai_runs: Number(event.target.value) })} />
        <span>{current.active_runs} running · {current.max_concurrent_ai_runs} enabled of 8
          {current.draining_runs > 0 && ` · ${current.draining_runs} finishing before the lower limit takes effect`}
        </span>
      </div>
      <div className="execution-profiles">
        {value.profiles.map((profile) => {
          const available = catalog?.models.find((entry) => entry.model === profile.model)
          const price = selectedPrice(profile.model)
          return <section className="execution-profile" key={profile.profile_id}>
            <h3>{PROFILE_NAMES[profile.profile_id]}</h3>
            <p>{profile.profile_id === 'luna' ? 'Discovery, analysis, verification and standard review.' : 'Demand diagnosis and advanced review.'}</p>
            <label className="field">{PROFILE_NAMES[profile.profile_id]} model
              <select disabled={readonly || mutation.isPending || !catalog || catalog.stale} value={profile.model}
                onChange={(event) => chooseModel(profile.profile_id, event.target.value)}>{options(profile.model)}</select>
            </label>
            <label className="field">{PROFILE_NAMES[profile.profile_id]} reasoning
              <select disabled={readonly || mutation.isPending || !catalog || catalog.stale} value={profile.reasoning_effort}
                onChange={(event) => changeProfile(profile.profile_id, { reasoning_effort: event.target.value as ExecutionProfile['reasoning_effort'] })}>
                {(!available || !available.reasoning_efforts.includes(profile.reasoning_effort)) && <option>{profile.reasoning_effort}</option>}
                {available?.reasoning_efforts.map((effort) => <option key={effort}>{effort}</option>)}
              </select>
            </label>
            <small>{price ? `${price.input} input / ${price.cached_input} cached / ${price.output} output credits per 1M tokens` : 'Price unavailable for this model.'}</small>
            <details><summary>Fallback model {profile.fallback_model ? `· ${profile.fallback_model}` : '· disabled'}</summary>
              <label className="field">{PROFILE_NAMES[profile.profile_id]} fallback model
                <select disabled={readonly || mutation.isPending || !catalog || catalog.stale} value={profile.fallback_model ?? ''}
                  onChange={(event) => {
                    const model = event.target.value
                    const entry = catalog?.models.find((candidate) => candidate.model === model)
                    changeProfile(profile.profile_id, { fallback_model: model || null,
                      fallback_reasoning_effort: entry ? entry.reasoning_efforts.includes(profile.reasoning_effort)
                        ? profile.reasoning_effort : entry.default_reasoning_effort : null })
                  }}>
                  <option value="">Disabled</option>{options(profile.fallback_model ?? '')}
                </select>
              </label>
              {profile.fallback_model && <label className="field">{PROFILE_NAMES[profile.profile_id]} fallback reasoning
                <select disabled={readonly || mutation.isPending || !catalog || catalog.stale} value={profile.fallback_reasoning_effort ?? ''}
                  onChange={(event) => changeProfile(profile.profile_id, { fallback_reasoning_effort: event.target.value as ExecutionProfile['reasoning_effort'] })}>
                  {catalog?.models.find((entry) => entry.model === profile.fallback_model)?.reasoning_efforts.map((effort) => <option key={effort}>{effort}</option>)}
                </select>
              </label>}
              <small>Used once for a task when its primary model has a circuit failure. Every fallback is recorded.</small>
            </details>
          </section>
        })}
      </div>
      {catalog?.stale && <p className="execution-notice">Model catalog is unavailable or stale. Saved models are retained; changing agent count is still available.</p>}
      {models.isError && <p className="execution-notice">Model information could not be loaded. <button type="button" onClick={() => void models.refetch()}>Retry</button></p>}
      {error && <p role="alert" className="login-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="execution-actions">
        {readonly ? <Status>Read-only demo</Status> : <>
          <Button variant="primary" disabled={!draft || mutation.isPending} onClick={() => mutation.mutate(value)}>{mutation.isPending ? 'Saving…' : 'Save agent settings'}</Button>
          <Button disabled={!draft || mutation.isPending} onClick={() => { setDraft(null); setError(''); void settings.refetch() }}>Cancel changes</Button>
        </>}
        {!readonly && <Button disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw size={16} />{refresh.isPending ? 'Refreshing…' : 'Refresh models & prices'}</Button>}
      </div>
      <p className="execution-caption">Luna High is a task profile. Its reasoning level is your choice. Current tasks keep their model; use Pause for immediate stopping.</p>
    </Panel>
    {compare && <Panel title="Model comparison" icon={Bot} help="Official Standard Codex credit rates per million tokens. Observed performance covers the last seven days and may mix task types and reasoning levels."
      action={<label className="compact-filter">Sort by <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
        <option value="output">Output price</option><option value="input">Input price</option><option value="name">Model name</option>
      </select></label>}>
      <p>Prices: {pricing?.updated_at ? formatDate(pricing.updated_at) : 'not fetched yet'} {pricing?.stale && '· last known prices, refresh needed'}.
        {' '}<a href={pricing?.source_url ?? 'https://learn.chatgpt.com/docs/pricing'} target="_blank" rel="noreferrer">Official pricing</a>
      </p>
      <p className="execution-caption">Included subscription usage and API billing differ from these credit rates. Reasoning changes token use. Fidelity findings measure extraction errors; small samples cannot establish a quality ranking.</p>
      <DataTable rows={[...(catalog?.models ?? [])].sort((a, b) => sort === 'name' ? a.display_name.localeCompare(b.display_name)
        : (selectedPrice(a.model)?.[sort] ?? Infinity) - (selectedPrice(b.model)?.[sort] ?? Infinity))}
        rowKey={(row) => row.model} empty="The executor has not published its model catalog yet."
        columns={[
          { key: 'name', label: 'Model', render: (row) => <div className="primary-cell"><strong>{row.display_name}</strong><span>{row.description || row.model}</span></div> },
          { key: 'input', label: 'Input', render: (row) => selectedPrice(row.model)?.input ?? '—' },
          { key: 'cache', label: 'Cached input', render: (row) => selectedPrice(row.model)?.cached_input ?? '—' },
          { key: 'output', label: 'Output', render: (row) => selectedPrice(row.model)?.output ?? '—' },
          { key: 'usage', label: 'Observed / 7d', render: (row) => <ModelObservations model={row.model} data={models.data} /> },
          { key: 'choose', label: 'Use model', render: (row) => <div className="execution-row-actions">
            {(['luna', 'luna_high'] as const).map((id) => <button type="button" className="button" key={id}
              disabled={readonly || catalog?.stale || mutation.isPending} onClick={() => chooseModel(id, row.model)}>{PROFILE_NAMES[id]}</button>)}
          </div> }
        ]} />
      <p className="execution-caption">Model catalog: {catalog?.last_success_at ? formatDate(catalog.last_success_at) : 'awaiting executor'} · {catalog?.cli_version ?? 'Codex unavailable'}.
        {catalog?.error && ` ${catalog.error}`}</p>
      {models.data?.circuits.map((circuit) => <p className="execution-notice" key={`${circuit.execution_profile}:${circuit.task_type}:${circuit.model}:${circuit.reasoning_effort}`}>
        {PROFILE_NAMES[circuit.execution_profile]} · {circuit.model} / {circuit.reasoning_effort}: {circuit.configuration_error ? 'model unavailable; choose another model or retry after restoring access' : `retry after ${formatDate(circuit.open_until)}`}.
        {!readonly && <button className="button" type="button" disabled={retry.isPending} onClick={() => retry.mutate(circuit)}>Retry model once</button>}
      </p>)}
    </Panel>}
  </>
}

function ModelObservations({ model, data }: { model: string; data: ExecutionModels | undefined }) {
  const rows = data?.metrics.filter((row) => row.model === model) ?? []
  if (!rows.length) return <Status>No local runs yet</Status>
  return <div className="primary-cell">{rows.map((row) => <span key={row.reasoning_effort}>
    <strong>{row.reasoning_effort}</strong>: {compactNumber(row.runs)} runs · {row.failed} failures · {duration(row.avg_duration_ms)} average
    <br />{row.quality_checks ? `${formatNumber(100 * row.material_errors / row.quality_checks, 1)}% need Fidelity repair (${row.material_errors}/${row.quality_checks})` : 'Extraction quality not measured yet'}
  </span>)}</div>
}
