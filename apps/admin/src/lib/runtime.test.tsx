import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OPERATIONS_PAGE_REGISTRY } from '../App'
import { AppShell, NAVIGATION_GROUPS } from '../components/app-shell'
import { useAdminAction } from '../components/action-dialog'
import {
  OperationsRuntimeProvider,
  useOperationsRuntime
} from './runtime'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('shared operations runtime', () => {
  it('uses the same complete 18-page registry and navigation for both roles', () => {
    const sectionIds = NAVIGATION_GROUPS.flatMap((group) =>
      group.items.map((item) => item.id),
    )
    expect(sectionIds).toHaveLength(18)
    expect(Object.keys(OPERATIONS_PAGE_REGISTRY).sort()).toEqual(
      [...sectionIds].sort(),
    )

    render(
      <OperationsRuntimeProvider role="public_demo">
        <AppShell
          section="overview"
          overview={undefined}
          refreshing={false}
          onNavigate={() => undefined}
          onRefresh={() => undefined}
          onPause={() => undefined}
          onConcurrency={() => undefined}
          role="public_demo"
        >
          <div>Shared page content</div>
        </AppShell>
      </OperationsRuntimeProvider>,
    )

    const sectionLabels = NAVIGATION_GROUPS.flatMap((group) =>
      group.items.map((item) => item.label),
    )
    const demoSections = sectionLabels.map((label) =>
      screen.getByRole('button', { name: label }).textContent,
    )
    cleanup()

    render(
      <OperationsRuntimeProvider role="super_admin">
        <AppShell
          section="overview"
          overview={undefined}
          refreshing={false}
          onNavigate={() => undefined}
          onRefresh={() => undefined}
          onPause={() => undefined}
          onConcurrency={() => undefined}
          onLogout={() => undefined}
          role="super_admin"
        >
          <div>Shared page content</div>
        </AppShell>
      </OperationsRuntimeProvider>,
    )
    const adminSections = sectionLabels.map((label) =>
      screen.getByRole('button', { name: label }).textContent,
    )
    expect(demoSections).toEqual(adminSections)
    for (const label of sectionLabels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(
      screen.getByRole('button', { name: 'Resume pipeline' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Configured Luna executors' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Shared page content')).toBeInTheDocument()
  })

  it('keeps confirmation dialogs for other actions without sending a demo mutation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })

    function Harness() {
      const action = useAdminAction()
      return (
        <>
          <button type="button" onClick={() => action.open({
            title: 'Activate release 24',
            summary: 'Open the real release confirmation flow.',
            path: '/admin/api/v1/releases/release-24/activate',
            confirmText: 'ACTIVATE 24',
            requireReason: true,
            danger: true,
            buildBody: (reason) => ({ reason })
          })}>
            Open action
          </button>
          {action.dialog}
          {action.toast}
        </>
      )
    }

    render(
      <QueryClientProvider client={client}>
        <OperationsRuntimeProvider role="public_demo">
          <Harness />
        </OperationsRuntimeProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open action' }))
    expect(
      screen.getByRole('dialog', { name: 'Activate release 24' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Reason/), {
      target: { value: 'Public demo validation' }
    })
    fireEvent.change(screen.getByLabelText(/Type ACTIVATE 24 to confirm/), {
      target: { value: 'ACTIVATE 24' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Activate release 24' }))

    await waitFor(() => {
      expect(
        screen.getByText('Read-only demo — no changes were made.'),
      ).toBeInTheDocument()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs Pause all Luna immediately without reason or confirmation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    function Harness() {
      const runtime = useOperationsRuntime()
      const [message, setMessage] = useState('')
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void runtime.executeMutation(
                '/admin/api/v1/pipeline/state',
                { enabled: false },
              ).then((result) => setMessage(result.message))
            }}
          >
            Pause all Luna
          </button>
          <span>{message}</span>
        </>
      )
    }

    render(
      <OperationsRuntimeProvider role="public_demo">
        <Harness />
      </OperationsRuntimeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pause all Luna' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getByText('Read-only demo — no changes were made.'),
      ).toBeInTheDocument()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
