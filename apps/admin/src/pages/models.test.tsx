import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OperationsRuntimeProvider } from '../lib/runtime'
import { ModelsPage } from './models'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup(role: 'super_admin' | 'public_demo' = 'super_admin', stale = false) {
  let current = {
    settings_version: 7, max_concurrent_ai_runs: 8, enabled: true, active_runs: 4, draining_runs: 0,
    profiles: [
      { profile_id: 'luna', model: 'gpt-5.6-luna', reasoning_effort: 'low', fallback_model: null, fallback_reasoning_effort: null },
      { profile_id: 'luna_high', model: 'gpt-5.6-luna', reasoning_effort: 'medium', fallback_model: null, fallback_reasoning_effort: null }
    ]
  }
  const saved: unknown[] = []
  const catalog = {
    protocol_version: 2, cli_version: 'codex-cli fixture', error: null, stale,
    supports_structured_output: true, supports_web_research: true,
    updated_at: new Date().toISOString(), last_success_at: new Date().toISOString(),
    models: ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-6.1-sol'].map((model) => ({
      model, display_name: model, description: '', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'medium'
    }))
  }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      const value = JSON.parse(String(init.body))
      saved.push(value)
      current = { ...current, ...value, settings_version: current.settings_version + 1 }
      return new Response(JSON.stringify({ ok: true, message: 'Agent settings saved.', audit_target: null }), { status: 200 })
    }
    const data = String(path).endsWith('/settings') ? current : {
      catalog, pricing: { unit: 'credits_per_million_tokens', speed: 'standard', source_url: 'https://learn.chatgpt.com/docs/pricing',
        updated_at: new Date().toISOString(), checked_at: new Date().toISOString(), stale: false, error: null,
        prices: [{ model: 'gpt-5.6-luna', display_name: 'Old Luna', input: 5, cached_input: 0.5, output: 30 },
          { model: 'gpt-6-luna', display_name: 'New Luna', input: 2.5, cached_input: 0.25, output: 12.5 }] },
      metrics: [], circuits: []
    }
    return new Response(JSON.stringify(data), { status: 200 })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><OperationsRuntimeProvider role={role}><ModelsPage /></OperationsRuntimeProvider></QueryClientProvider>)
  return { saved, fetcher }
}

describe('agent and model selection', () => {
  it('saves independent models, reasoning and count with the original settings version', async () => {
    const { saved } = setup()
    await screen.findByRole('spinbutton', { name: 'Enabled agents' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Luna model' })).toBeEnabled())
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Enabled agents' }), { target: { value: '3' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Luna model' }), { target: { value: 'gpt-6-luna' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Luna High model' }), { target: { value: 'gpt-6.1-sol' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Luna High reasoning' }), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent settings' }))
    await screen.findByText('Agent settings saved.')
    expect(saved).toEqual([{ expected_version: 7, max_concurrent_ai_runs: 3, profiles: [
      { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low', fallback_model: null, fallback_reasoning_effort: null },
      { profile_id: 'luna_high', model: 'gpt-6.1-sol', reasoning_effort: 'high', fallback_model: null, fallback_reasoning_effort: null }
    ] }])
  })

  it('keeps capacity editable with stale model information and cancels unsaved changes', async () => {
    const { saved } = setup('super_admin', true)
    const count = await screen.findByRole('spinbutton', { name: 'Enabled agents' })
    expect(screen.getByRole('combobox', { name: 'Luna model' })).toBeDisabled()
    fireEvent.change(count, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }))
    expect(count).toHaveValue(8)
    fireEvent.change(count, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent settings' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ max_concurrent_ai_runs: 3 })
  })

  it('shows dated prices, unknown quality and prevents all writes in the demo', async () => {
    const { saved, fetcher } = setup('public_demo')
    await screen.findByText('Read-only demo')
    await screen.findByText('Official pricing')
    expect(screen.getByRole('spinbutton', { name: 'Enabled agents' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save agent settings' })).not.toBeInTheDocument()
    expect(screen.getAllByText('No local runs yet')).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('output')
    expect(saved).toEqual([])
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
})
