import {
  Activity,
  Atom,
  CheckCircle2,
  CircleDotDashed,
  FileSearch,
  LockKeyhole,
  Network,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  TerminalSquare,
  UserCheck
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useReducer,
  useRef
} from 'react'
import { useWebMCP } from 'use-webmcp-tool'

import { Button, Status } from '../components/ui'
import {
  AFTER_SNAPSHOT,
  BEFORE_SNAPSHOT,
  createInitialLabState,
  executeRecoveryCommands,
  LAB_DEVICE,
  labReducer,
  RECOVERY_COMMANDS,
  validateRecoveryCommands,
  type GuidanceReference,
  type LabPhase
} from './lab-state'
import { callPublicMcpTool } from './mcp-client'

type SnapshotResult = {
  context: {
    vendor: string
    model: string | null
    operating_system: string
    version: string | null
    confidence: number
  } | null
  redactions: Array<{ type: string; count: number }>
  sanitized_snapshot: string
  retention: 'not_stored'
}

type KnowledgeAnswer = {
  revision_ref: string
  kind: string
  title: string
  confidence: number
  last_verified_at: string
}

type KnowledgeResult = {
  answers: KnowledgeAnswer[]
  answer_status?: 'complete' | 'partial' | 'unknown'
  unknown: boolean
}

type ReviewResult = {
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  prechecks: string[]
  rollback: string[]
  approval_required: boolean
  verification_token: string | null
}

type VerificationResult = {
  result: 'passed' | 'failed' | 'partial' | 'indeterminate'
  checks: Array<{
    id: string
    status: 'passed' | 'failed' | 'indeterminate'
    evidence: string
  }>
  rollback_recommended: boolean
  next_action: string
}

const PHASES: Array<{ id: LabPhase; label: string }> = [
  { id: 'ready', label: 'Ready' },
  { id: 'inspected', label: 'Inspect' },
  { id: 'guided', label: 'Guide' },
  { id: 'staged', label: 'Stage' },
  { id: 'approved', label: 'Approve' },
  { id: 'executed', label: 'Execute' },
  { id: 'verified', label: 'Verify' }
]

const phaseIndex = (phase: LabPhase) => PHASES.findIndex(({ id }) => id === phase)

function toReference(answer: KnowledgeAnswer): GuidanceReference {
  return {
    revisionRef: answer.revision_ref,
    title: answer.title,
    kind: answer.kind,
    confidence: answer.confidence,
    lastVerifiedAt: answer.last_verified_at
  }
}

const competingIncidentCause = /\b(?:bpdu(?:\s+guard)?|spanning[ -]tree|udld|channel[ -]misconfig|storm[ -]control)\b/i

function matchesPortSecurityIncident(answer: KnowledgeAnswer): boolean {
  return !competingIncidentCause.test(answer.title)
}

function requirePhase(actual: LabPhase, expected: LabPhase) {
  if (actual !== expected) {
    throw new Error(`LAB_PHASE_${expected.toUpperCase()}_REQUIRED`)
  }
}

export function WebMcpApp() {
  const [state, dispatch] = useReducer(labReducer, undefined, createInitialLabState)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const recordError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dispatch({
      type: 'record',
      kind: 'error',
      title: 'Tool call stopped safely',
      detail: message.slice(0, 240)
    })
  }, [])

  const inspectTool = useWebMCP<Record<string, never>, {
    phase: LabPhase
    device: string
    interface: string
    symptom: string
    sanitized_snapshot: string
    retention: string
  }>({
    name: 'inspect_lab_device',
    description: 'Inspect the visible simulated switch incident, detect its exact platform context, and sanitize the CLI snapshot. Never connects to a real device.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    enabled: state.phase === 'ready',
    onError: recordError,
    execute: async () => {
      requirePhase(stateRef.current.phase, 'ready')
      dispatch({ type: 'record', kind: 'agent', title: 'inspect_lab_device', detail: 'Sending the bounded simulator snapshot through strict CliDeck redaction.' })
      const result = await callPublicMcpTool<SnapshotResult>(
        'analyze_device_snapshot',
        {
          snapshot: BEFORE_SNAPSHOT,
          snapshot_type: 'auto',
          redaction_profile: 'strict'
        },
      )
      if (!result.context) throw new Error('SIMULATED_DEVICE_NOT_RECOGNIZED')
      const redactionCount = result.redactions.reduce((sum, item) => sum + item.count, 0)
      dispatch({
        type: 'inspected',
        confidence: result.context.confidence,
        redactionCount
      })
      return {
        phase: 'inspected',
        device: `${result.context.vendor} ${result.context.model ?? LAB_DEVICE.model} · ${result.context.operating_system} ${result.context.version ?? LAB_DEVICE.version}`,
        interface: LAB_DEVICE.interfaceName,
        symptom: 'err-disabled: port-security violation',
        sanitized_snapshot: result.sanitized_snapshot,
        retention: result.retention
      }
    }
  })

  const guidanceTool = useWebMCP<{ goal: string }, {
    phase: LabPhase
    answer_status: string
    references: Array<{ revision_ref: string; title: string; confidence: number }>
    recommended_commands: readonly string[]
  }>({
    name: 'find_network_guidance',
    description: 'Find active, version-aware CliDeck knowledge and an ordered workflow for the inspected simulated incident.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          minLength: 8,
          maxLength: 240,
          description: 'Recovery goal for the visible simulated incident.'
        }
      },
      required: ['goal'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    enabled: state.phase === 'inspected',
    onError: recordError,
    execute: async ({ goal }) => {
      requirePhase(stateRef.current.phase, 'inspected')
      const normalizedGoal = goal.trim()
      if (normalizedGoal.length < 8) throw new Error('GOAL_TOO_SHORT')
      dispatch({ type: 'record', kind: 'agent', title: 'find_network_guidance', detail: 'Querying active knowledge and workflow indexes for IOS-XE 17.12.4.' })
      const context = {
        vendor: LAB_DEVICE.vendor,
        model: LAB_DEVICE.model,
        operating_system: LAB_DEVICE.operatingSystem,
        version: LAB_DEVICE.version
      }
      const [knowledge, workflow] = await Promise.all([
        callPublicMcpTool<KnowledgeResult>('query_network_knowledge', {
          question: normalizedGoal,
          context,
          limit: 3
        }),
        callPublicMcpTool<KnowledgeResult>('get_network_workflow', {
          goal: normalizedGoal,
          context,
          limit: 2
        })
      ])
      const deduplicated = new Map<string, GuidanceReference>()
      for (const answer of [...workflow.answers, ...knowledge.answers].filter(matchesPortSecurityIncident)) {
        deduplicated.set(answer.revision_ref, toReference(answer))
      }
      const references = [...deduplicated.values()].slice(0, 5)
      if (references.length === 0) throw new Error('NO_ACTIVE_GUIDANCE_FOUND')
      const coverageStatus = workflow.answer_status === 'partial' || knowledge.answer_status === 'partial'
        ? 'partial' as const
        : 'complete' as const
      dispatch({ type: 'guided', references, coverageStatus })
      return {
        phase: 'guided',
        answer_status: coverageStatus,
        references: references.map((reference) => ({
          revision_ref: reference.revisionRef,
          title: reference.title,
          confidence: reference.confidence
        })),
        recommended_commands: RECOVERY_COMMANDS
      }
    }
  })

  const stageTool = useWebMCP<{ intent: string; commands: string[] }, {
    phase: LabPhase
    risk_level: string
    approval_required: true
    commands: string[]
    prechecks: string[]
    rollback: string[]
  }>({
    name: 'stage_network_change',
    description: 'Stage the exact supported recovery sequence for deterministic CliDeck risk review. This does not approve or execute commands.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          minLength: 8,
          maxLength: 240,
          description: 'Plain-language intent for the simulated recovery.'
        },
        commands: {
          type: 'array',
          minItems: RECOVERY_COMMANDS.length,
          maxItems: RECOVERY_COMMANDS.length,
          description: 'Exact ordered command sequence returned by guidance.',
          items: { type: 'string', minLength: 2, maxLength: 120 }
        }
      },
      required: ['intent', 'commands'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    enabled: state.phase === 'guided',
    onError: recordError,
    execute: async ({ intent, commands }) => {
      requirePhase(stateRef.current.phase, 'guided')
      const validated = executeSequenceValidation(commands)
      dispatch({ type: 'record', kind: 'agent', title: 'stage_network_change', detail: 'Validating the complete command batch before creating a signed review.' })
      const review = await callPublicMcpTool<ReviewResult>('review_network_change', {
        intent: intent.trim(),
        context: {
          vendor: LAB_DEVICE.vendor,
          model: LAB_DEVICE.model,
          operating_system: LAB_DEVICE.operatingSystem,
          version: LAB_DEVICE.version
        },
        commands: validated
      })
      if (!review.approval_required || !review.verification_token) {
        throw new Error('SIGNED_REVIEW_NOT_AVAILABLE')
      }
      dispatch({
        type: 'staged',
        commands: validated,
        riskLevel: review.risk_level,
        prechecks: review.prechecks.slice(0, 4),
        rollback: review.rollback.slice(0, 3),
        verificationToken: review.verification_token
      })
      return {
        phase: 'staged',
        risk_level: review.risk_level,
        approval_required: true,
        commands: validated,
        prechecks: review.prechecks.slice(0, 3),
        rollback: review.rollback.slice(0, 2)
      }
    }
  })

  const runTool = useWebMCP<{ commands: string[] }, {
    phase: LabPhase
    execution_target: 'deterministic_browser_simulator'
    interface: string
    state: 'up/up'
  }>({
    name: 'run_lab_commands',
    description: 'Execute the exact human-approved command batch only inside the deterministic browser simulator. Never reaches a real network device.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          minItems: RECOVERY_COMMANDS.length,
          maxItems: RECOVERY_COMMANDS.length,
          description: 'Exact command batch previously staged and approved by the human.',
          items: { type: 'string', minLength: 2, maxLength: 120 }
        }
      },
      required: ['commands'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    enabled: state.phase === 'approved',
    onError: recordError,
    execute: async ({ commands }) => {
      const current = stateRef.current
      executeRecoveryCommands(current.phase, current.stagedCommands, commands)
      dispatch({ type: 'executed' })
      return {
        phase: 'executed',
        execution_target: 'deterministic_browser_simulator',
        interface: LAB_DEVICE.interfaceName,
        state: 'up/up'
      }
    }
  })

  const verifyTool = useWebMCP<Record<string, never>, {
    phase: LabPhase
    result: VerificationResult['result']
    checks: Array<{ id: string; status: string }>
    next_action: string
  }>({
    name: 'verify_lab_change',
    description: 'Verify the simulated before/after state with the signed CliDeck plan created during staging.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    enabled: state.phase === 'executed',
    onError: recordError,
    execute: async () => {
      const current = stateRef.current
      requirePhase(current.phase, 'executed')
      if (!current.verificationToken) throw new Error('VERIFICATION_TOKEN_MISSING')
      dispatch({ type: 'record', kind: 'agent', title: 'verify_lab_change', detail: 'Comparing sanitized before/after snapshots against the signed verification plan.' })
      const verification = await callPublicMcpTool<VerificationResult>(
        'verify_network_change',
        {
          verification_token: current.verificationToken,
          before_snapshot: BEFORE_SNAPSHOT,
          after_snapshot: AFTER_SNAPSHOT
        },
      )
      dispatch({
        type: 'verified',
        result: verification.result,
        checks: verification.checks
      })
      return {
        phase: 'verified',
        result: verification.result,
        checks: verification.checks.map(({ id, status }) => ({ id, status })),
        next_action: verification.next_action
      }
    }
  })

  const tools = [
    { name: 'inspect_lab_device', phase: 'ready' as const, state: inspectTool },
    { name: 'find_network_guidance', phase: 'inspected' as const, state: guidanceTool },
    { name: 'stage_network_change', phase: 'guided' as const, state: stageTool },
    { name: 'run_lab_commands', phase: 'approved' as const, state: runTool },
    { name: 'verify_lab_change', phase: 'executed' as const, state: verifyTool }
  ]
  const supported = tools.some((tool) => tool.state.supported)
  const activeTool = tools.find((tool) => tool.state.registered)

  return (
    <div className="webmcp-page">
      <header className="webmcp-header">
        <a className="webmcp-brand" href="/demo" aria-label="CliDeck MCP public demo">
          <span className="brand__mark"><Atom size={21} /></span>
          <span><strong>CliDeck MCP</strong><small>Network Knowledge</small></span>
        </a>
        <div className="webmcp-header__actions">
          <Status tone={supported ? 'good' : 'warning'}>
            {supported ? 'WebMCP connected' : 'WebMCP unavailable'}
          </Status>
          <Button variant="secondary" onClick={() => dispatch({ type: 'reset' })}>
            <RotateCcw size={16} /> Reset lab
          </Button>
        </div>
      </header>

      <main className="webmcp-main">
        <section className="webmcp-intro">
          <div>
            <h1>Network Change Room</h1>
            <p>A person and an agent recover one simulated switch incident together. CliDeck supplies exact knowledge, a deterministic safety review, human approval, and signed verification.</p>
          </div>
          <div className="webmcp-device" aria-label="Simulated device status">
            <Network size={21} />
            <span><small>SIMULATED DEVICE</small><strong>{LAB_DEVICE.model}</strong></span>
            <Status tone={state.interfaceState === 'up' ? 'good' : 'danger'}>
              Gi1/0/24 {state.interfaceState === 'up' ? 'up/up' : 'err-disabled'}
            </Status>
          </div>
        </section>

        {!supported && (
          <section className="webmcp-support" role="status">
            <CircleDotDashed size={21} />
            <div>
              <strong>This page is ready, but this browser has not exposed WebMCP.</strong>
              <span>Open it in ChatGPT’s in-app browser, or use Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> enabled.</span>
            </div>
          </section>
        )}

        <ol className="webmcp-phases" aria-label="Change room progress">
          {PHASES.map((phase, index) => {
            const currentIndex = phaseIndex(state.phase)
            const complete = index < currentIndex || state.phase === 'verified'
            const current = index === currentIndex && state.phase !== 'verified'
            return (
              <li key={phase.id} className={complete ? 'is-complete' : current ? 'is-current' : ''}>
                <span>{complete ? <CheckCircle2 size={15} /> : index + 1}</span>
                <small>{phase.label}</small>
              </li>
            )
          })}
        </ol>

        <div className="webmcp-grid">
          <section className="webmcp-panel webmcp-panel--incident">
            <header><TerminalSquare size={19} /><h2>Incident workspace</h2></header>
            <div className="webmcp-terminal" aria-label="Simulated CLI output">
              <div><i /><i /><i /><span>console · {LAB_DEVICE.interfaceName}</span></div>
              <pre>{state.interfaceState === 'up' ? AFTER_SNAPSHOT : BEFORE_SNAPSHOT}</pre>
            </div>
            <dl className="webmcp-facts">
              <div><dt>Platform</dt><dd>{LAB_DEVICE.model}</dd></div>
              <div><dt>Software</dt><dd>{LAB_DEVICE.operatingSystem} {LAB_DEVICE.version}</dd></div>
              <div><dt>Detection</dt><dd>{state.contextConfidence === null ? 'Waiting for agent' : `${Math.round(state.contextConfidence * 100)}% confidence`}</dd></div>
              <div><dt>Retention</dt><dd>Snapshot not stored</dd></div>
            </dl>
          </section>

          <section className="webmcp-panel webmcp-panel--change">
            <header><ShieldCheck size={19} /><h2>Guarded change</h2></header>
            {state.phase === 'ready' && <RoomPrompt icon={Search} title="Ask the agent to inspect the incident" detail="The browser currently exposes inspect_lab_device." />}
            {state.phase === 'inspected' && <RoomPrompt icon={FileSearch} title="Find version-aware guidance" detail="Ask the agent to recover the port-security err-disabled interface." />}
            {state.phase === 'guided' && <RoomPrompt icon={LockKeyhole} title="Stage the recommended sequence" detail="The agent can review only the exact sandbox command batch returned by guidance." />}
            {state.phase === 'staged' && (
              <div className="webmcp-approval">
                <div><UserCheck size={25} /><span><strong>Human decision required</strong><small>The execution tool is not registered yet.</small></span></div>
                <CommandList commands={state.stagedCommands} />
                <Button variant="primary" onClick={() => dispatch({ type: 'approved' })}>
                  <UserCheck size={17} /> Reviewed — approve in sandbox
                </Button>
              </div>
            )}
            {state.phase === 'approved' && <RoomPrompt icon={Play} title="Sandbox execution unlocked" detail="run_lab_commands is now registered for the agent. It accepts only the approved batch." tone="good" />}
            {state.phase === 'executed' && <RoomPrompt icon={ShieldCheck} title="Verify the resulting state" detail="The agent can now compare before and after snapshots with the signed plan." tone="good" />}
            {state.phase === 'verified' && <RoomPrompt icon={CheckCircle2} title={`Verification ${state.verificationResult}`} detail="The simulated interface is up/up and every required check is recorded below." tone="good" />}

            {state.guidance.length > 0 && (
              <div className="webmcp-guidance">
                <h3>Active knowledge references</h3>
                {state.guidance.map((reference) => (
                  <article key={reference.revisionRef}>
                    <span><strong>{reference.title}</strong><small>{reference.kind} · {Math.round(reference.confidence * 100)}% confidence</small></span>
                    <code title={reference.revisionRef}>{reference.revisionRef.slice(0, 8)}</code>
                  </article>
                ))}
              </div>
            )}

            {state.riskLevel && (
              <div className="webmcp-review">
                <h3>Deterministic review</h3>
                <dl>
                  <div><dt>Risk</dt><dd><Status>{state.riskLevel}</Status></dd></div>
                  <div><dt>Pre-checks</dt><dd>{state.prechecks.length}</dd></div>
                  <div><dt>Rollback steps</dt><dd>{state.rollback.length}</dd></div>
                  <div><dt>Target</dt><dd>Browser simulator only</dd></div>
                </dl>
              </div>
            )}
          </section>
        </div>

        <div className="webmcp-grid webmcp-grid--lower">
          <section className="webmcp-panel">
            <header><Activity size={19} /><h2>Shared activity</h2></header>
            <div className="webmcp-timeline" aria-live="polite">
              {state.timeline.map((event) => (
                <article key={event.id} className={`is-${event.kind}`}>
                  <span />
                  <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                </article>
              ))}
            </div>
          </section>

          <section className="webmcp-panel">
            <header><Atom size={19} /><h2>Agent tool surface</h2></header>
            <div className="webmcp-tools">
              {tools.map((tool) => {
                const passed = phaseIndex(state.phase) > phaseIndex(tool.phase)
                const registered = tool.state.registered
                return (
                  <div key={tool.name} className={registered ? 'is-registered' : passed ? 'is-used' : ''}>
                    <span>{registered ? <Activity size={15} /> : passed ? <CheckCircle2 size={15} /> : <LockKeyhole size={15} />}</span>
                    <code>{tool.name}</code>
                    <small>{registered ? 'registered now' : passed ? 'completed' : 'not available yet'}</small>
                  </div>
                )
              })}
            </div>
            <p className="webmcp-tool-note">
              {activeTool
                ? `Current browser capability: ${activeTool.name}`
                : state.phase === 'staged'
                  ? 'No execution capability is exposed while human approval is pending.'
                  : state.phase === 'verified'
                    ? 'The incident is complete. Reset to run it again.'
                    : 'Waiting for the browser agent.'}
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}

function executeSequenceValidation(commands: string[]): string[] {
  return validateRecoveryCommands(commands)
}

function RoomPrompt({
  icon: Icon,
  title,
  detail,
  tone = 'info'
}: {
  icon: typeof Search
  title: string
  detail: string
  tone?: 'info' | 'good'
}) {
  return (
    <div className={`webmcp-prompt webmcp-prompt--${tone}`}>
      <Icon size={23} />
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  )
}

function CommandList({ commands }: { commands: string[] }) {
  return (
    <ol className="webmcp-commands">
      {commands.map((command) => <li key={command}><code>{command}</code></li>)}
    </ol>
  )
}
