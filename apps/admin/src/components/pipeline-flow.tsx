import type { PipelineTransition } from '@clideck/admin-contracts'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

type DisplayTransition = PipelineTransition & {
  key: string
}

type Point = { x: number; y: number }
type Route = DisplayTransition & {
  start: Point
  bend: Point
  end: Point
}

const LABELS: Record<string, string> = {
  deep_low: 'Deep Low',
  deep_medium: 'Deep Medium',
  manual_exception: 'Exception',
  quarantine: 'Quarantine',
  publish: 'Published'
}

function label(stage: string) {
  return LABELS[stage] ??
    stage.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase())
}

export function groupTransitions(
  rows: PipelineTransition[]
): DisplayTransition[] {
  const grouped = new Map<string, PipelineTransition>()
  for (const row of rows) {
    const key = `${row.scope}:${row.from_stage}:${row.to_stage}:${row.kind}`
    const current = grouped.get(key)
    grouped.set(key, current
      ? {
          ...row,
          count: Number(current.count) + Number(row.count),
          occurred_at:
            new Date(row.occurred_at) > new Date(current.occurred_at)
              ? row.occurred_at
              : current.occurred_at
        }
      : row)
  }
  return [...grouped.entries()]
    .sort((left, right) =>
      new Date(left[1].occurred_at).getTime() -
      new Date(right[1].occurred_at).getTime()
    )
    .map(([key, row]) => ({ ...row, key }))
}

export function transitionsForMotion(
  rows: PipelineTransition[]
): DisplayTransition[] {
  return groupTransitions(rows).slice(-6)
}

function stageElement(
  root: HTMLElement,
  scope: string,
  stage: string
): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(
    `[data-pipeline-stage="${scope}:${stage}"]`,
  )
  if (exact) return exact
  return root.querySelector<HTMLElement>(
    `[data-pipeline-stage$=":${stage}"]`,
  )
}

function routeFor(
  root: HTMLElement,
  transition: DisplayTransition
): Route | null {
  const rootRect = root.getBoundingClientRect()
  const source = stageElement(root, transition.scope, transition.from_stage)
  const target = stageElement(root, transition.scope, transition.to_stage)
  if (!source || !target) return null
  const sourceRect = source.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const start = {
    x: sourceRect.left - rootRect.left + sourceRect.width / 2,
    y: sourceRect.top - rootRect.top - 4
  }
  const end = {
    x: targetRect.left - rootRect.left + targetRect.width / 2,
    y: targetRect.top - rootRect.top - 4
  }
  return {
    ...transition,
    start,
    bend: {
      x: end.x,
      y: start.y === end.y
        ? start.y
        : Math.min(start.y, end.y) - 10
    },
    end
  }
}

function routePath(route: Route): string {
  if (
    route.start.y === route.end.y ||
    Math.abs(route.start.x - route.end.x) < 2
  ) {
    return `M ${route.start.x} ${route.start.y} L ${route.end.x} ${route.end.y}`
  }
  return [
    `M ${route.start.x} ${route.start.y}`,
    `L ${route.start.x} ${route.bend.y}`,
    `L ${route.bend.x} ${route.bend.y}`,
    `L ${route.end.x} ${route.end.y}`
  ].join(' ')
}

export function PipelineFlow({
  transitions,
  children
}: {
  transitions: PipelineTransition[]
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const animationsRef = useRef<Animation[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [last, setLast] = useState<DisplayTransition[]>([])
  const grouped = useMemo(() => groupTransitions(transitions), [transitions])

  useEffect(() => {
    if (grouped.length === 0) return
    setLast((current) => [...current, ...grouped].slice(-12))
    const root = rootRef.current
    const newest = Math.max(
      ...grouped.map((row) => new Date(row.occurred_at).getTime()),
    )
    if (
      !root ||
      document.hidden ||
      Date.now() - newest > 20_000
    ) {
      return
    }
    const measured = grouped.slice(-6).flatMap((transition) => {
      const route = routeFor(root, transition)
      return route ? [route] : []
    })
    if (measured.length === 0) return
    setRoutes(measured)

    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current = []
    for (const [index, route] of measured.entries()) {
      const source = stageElement(root, route.scope, route.from_stage)
      const target = stageElement(root, route.scope, route.to_stage)
      const delay = index * 70
      for (const [element, color] of [
        [source, 'rgba(15,95,255,.12)'],
        [target, route.kind === 'terminal'
          ? 'rgba(217,45,32,.10)'
          : route.to_stage === 'publish'
            ? 'rgba(18,183,106,.13)'
            : 'rgba(15,95,255,.12)']
      ] as const) {
        if (!element) continue
        if (typeof element.animate !== 'function') continue
        animationsRef.current.push(element.animate(
          [
            { backgroundColor: 'transparent' },
            { backgroundColor: color },
            { backgroundColor: 'transparent' }
          ],
          {
            duration: 110,
            delay,
            easing: 'cubic-bezier(0.2, 0, 0.38, 0.9)'
          },
        ))
      }
    }
    const timeout = window.setTimeout(
      () => setRoutes([]),
      700 + measured.length * 70,
    )
    return () => {
      window.clearTimeout(timeout)
      animationsRef.current.forEach((animation) => animation.cancel())
      animationsRef.current = []
    }
  }, [grouped])

  useEffect(() => {
    const root = rootRef.current
    if (!root || routes.length === 0) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setRoutes((current) => current.flatMap((transition) => {
        const next = routeFor(root, transition)
        return next ? [next] : []
      }))
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [routes.length])

  return (
    <div className="pipeline-flow" ref={rootRef}>
      {children}
      <div className="pipeline-flow__overlay" aria-hidden="true">
        <svg
          className="pipeline-flow__routes"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          {routes.map((route, index) => (
            <path
              className={`pipeline-flow__route pipeline-flow__route--${route.kind} ${
                route.to_stage === 'publish' ? 'is-published' : ''
              }`}
              d={routePath(route)}
              key={`${route.key}:${route.occurred_at}:route`}
              pathLength="100"
              style={{ animationDelay: `${index * 70}ms` }}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {routes.map((route, index) => (
          <FlowPulse
            key={`${route.key}:${route.occurred_at}`}
            route={route}
            delay={index * 70}
          />
        ))}
      </div>
      <div className="pipeline-transitions" aria-label="Last pipeline transitions">
        <strong>Last transitions</strong>
        <div>
          {last.length === 0
            ? <span className="pipeline-transitions__empty">Waiting for the next confirmed transition</span>
            : [...last].reverse().map((transition) => (
                <span
                  className={`pipeline-transition pipeline-transition--${transition.kind}`}
                  key={`${transition.key}:${transition.occurred_at}`}
                >
                  +{transition.count} {label(transition.from_stage)}
                  <b aria-hidden="true">→</b>
                  {label(transition.to_stage)}
                </span>
              ))}
        </div>
      </div>
    </div>
  )
}

function FlowPulse({
  route,
  delay
}: {
  route: Route
  delay: number
}) {
  const badgeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const badge = badgeRef.current
    if (!badge || typeof badge.animate !== 'function') return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const direct =
      route.start.y === route.end.y ||
      Math.abs(route.start.x - route.end.x) < 2
    const points = reduceMotion
      ? [route.end, route.end]
      : direct
        ? [route.start, route.end]
        : [route.start, route.bend, route.end]
    const animation = badge.animate(
      points.map((point, index) => ({
        transform: `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`,
        opacity: index === 0 ? 0 : 1
      })),
      {
        duration: reduceMotion ? 110 : 240,
        delay,
        fill: 'both',
        easing: 'cubic-bezier(0.2, 0, 0.38, 0.9)'
      },
    )
    return () => animation.cancel()
  }, [delay, route])
  return (
    <span
      ref={badgeRef}
      className={`pipeline-flow__pulse pipeline-flow__pulse--${route.kind} ${
        route.to_stage === 'publish' ? 'is-published' : ''
      }`}
    >
      +{route.count}
    </span>
  )
}
