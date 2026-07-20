import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  groupTransitions,
  PipelineFlow,
  transitionsForMotion
} from './pipeline-flow'

const originalMatchMedia = window.matchMedia
const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'animate',
)

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia
  })
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  } else {
    delete (HTMLElement.prototype as { animate?: unknown }).animate
  }
})

describe('pipeline transition presentation', () => {
  it('aggregates confirmed transitions while retaining textual overflow', () => {
    const occurredAt = '2026-07-20T01:00:00.000Z'
    const grouped = groupTransitions([
      {
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 8,
        kind: 'progress',
        occurred_at: occurredAt
      },
      {
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 10,
        kind: 'progress',
        occurred_at: occurredAt
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        scope: 'record' as const,
        from_stage: 'verify',
        to_stage: `outcome_${index}`,
        count: 1,
        kind: 'terminal' as const,
        occurred_at: new Date(
          Date.parse(occurredAt) + index + 1,
        ).toISOString()
      }))
    ])

    expect(grouped).toHaveLength(7)
    expect(grouped.some((row) =>
      row.from_stage === 'deep_low' &&
      row.to_stage === 'ready' &&
      Number(row.count) === 18
    )).toBe(true)
    expect(transitionsForMotion(grouped)).toHaveLength(6)
    expect(groupTransitions([
      {
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 8,
        kind: 'progress',
        occurred_at: occurredAt
      },
      {
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 10,
        kind: 'progress',
        occurred_at: occurredAt
      }
    ])[0]?.count).toBe(18)
  })

  it('primes silently and does not animate an old confirmed event', async () => {
    const { container, rerender } = render(
      <PipelineFlow transitions={[]}>
        <div data-pipeline-stage="record:deep_low">Deep Low</div>
        <div data-pipeline-stage="record:ready">Ready</div>
      </PipelineFlow>,
    )
    expect(screen.getByText('Waiting for the next confirmed transition'))
      .toBeInTheDocument()
    expect(container.querySelector('.pipeline-flow__pulse')).toBeNull()

    rerender(
      <PipelineFlow transitions={[{
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 18,
        kind: 'progress',
        occurred_at: new Date(Date.now() - 30_000).toISOString()
      }]}>
        <div data-pipeline-stage="record:deep_low">Deep Low</div>
        <div data-pipeline-stage="record:ready">Ready</div>
      </PipelineFlow>,
    )
    await waitFor(() => expect(
      screen.getByText(/18 Deep Low/),
    ).toBeInTheDocument())
    expect(container.querySelector('.pipeline-flow__pulse')).toBeNull()
  })

  it('uses a static endpoint pulse when reduced motion is requested', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      })
    })
    const cancel = vi.fn()
    const animateCalls: Array<Keyframe[] | PropertyIndexedKeyframes> = []
    const animate = vi.fn((
      frames: Keyframe[] | PropertyIndexedKeyframes,
    ) => {
      animateCalls.push(frames)
      return { cancel } as unknown as Animation
    })
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate
    })

    render(
      <PipelineFlow transitions={[{
        scope: 'record',
        from_stage: 'deep_low',
        to_stage: 'ready',
        count: 7,
        kind: 'progress',
        occurred_at: new Date().toISOString()
      }]}>
        <div data-pipeline-stage="record:deep_low">Deep Low</div>
        <div data-pipeline-stage="record:ready">Ready</div>
      </PipelineFlow>,
    )
    await waitFor(() => expect(animate).toHaveBeenCalled())
    const pulseFrames = animateCalls
      .find((frames) => Array.isArray(frames) && frames.length === 2) as
        Array<{ transform: string }> | undefined
    expect(pulseFrames).toBeDefined()
    expect(pulseFrames?.[0]?.transform).toBe(pulseFrames?.[1]?.transform)
  })
})
