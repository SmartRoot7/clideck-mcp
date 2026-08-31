import {
  Atom,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  FileUp,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  Network,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { Button, Status } from '../components/ui'
import {
  combineEvidenceFiles,
  extractEvidenceFiles,
  lineWindow,
  redactEvidence,
  type EvidenceFile
} from './evidence'
import { callPublicMcpTool } from './mcp-client'
import {
  CISCO_SAMPLE_16_10,
  CISCO_SAMPLE_17_8_1,
  CISCO_SAMPLE_SOURCE,
  UPGRADE_QUESTION
} from './samples'
import { useWebMcpTool } from './use-webmcp-tool'

type NetworkContext = {
  vendor: string
  model: string
  operating_system: string
  version: string
}

type SnapshotResult = {
  context: {
    vendor: string
    model: string | null
    operating_system: string
    version: string | null
    confidence: number
    support_level: string
    ambiguities: string[]
  } | null
  snapshot_type: string
  sanitized_snapshot: string
  redactions: Array<{ type: string; count: number }>
  limitations: string[]
}

type KnowledgeAnswer = {
  revision_ref: string
  kind: string
  title: string
  summary: string
  applicability: {
    vendor: string
    model: string | null
    operating_system: string
    versions: {
      minimum: string | null
      maximum: string | null
      requested: string | null
    }
    assurance_level?: string
    version_match?: string
  }
  cli_mode: string | null
  command: string | null
  procedure: string[]
  prerequisites: string[]
  risks: string[]
  verification: string[]
  rollback: string[]
  limitations: string[]
  confidence: number
  quality_score: number
  dangerous: boolean
  last_verified_at: string
  assurance: {
    validation_level: string
    confidence_explanation: string
  }
}

type KnowledgeResult = {
  answers: KnowledgeAnswer[]
  answer_status?: 'complete' | 'partial' | 'unknown'
  unknown: boolean
  learning?: { status: string }
  next_action: 'use_answer' | 'request_expert_answer'
}

type ProvenanceSource = {
  source_ref: string | null
  source_kind: string
  title: string
  url: string
  document_version: string | null
  document_date: string | null
  verified_at: string
}

type SearchState = {
  mode: 'knowledge' | 'workflow' | 'both'
  status: 'complete' | 'partial' | 'unknown'
  answers: KnowledgeAnswer[]
  provenance: Record<string, ProvenanceSource[]>
  learningStatus: string | null
  caseVersion: number
}

type AgentAnalysis = {
  summary: string
  hypotheses: string[]
  next_commands: string[]
  revision_refs: string[]
  caseVersion: number
}

type ResearchTask = {
  task_id: string
  status: string
  stage: string
  progress_percent: number
  poll_after_ms: number
  input_request: string | null
  answer: KnowledgeAnswer | null
  failure: { code: string; message: string } | null
  milestones: Array<{ stage: string; message: string; created_at: string }>
  access_token?: string
}

type ResearchCredentials = {
  taskId: string
  accessToken?: string
  caseVersion: number
}

const emptyContext: NetworkContext = {
  vendor: '', model: '', operating_system: '', version: ''
}

const readCaseSchema = {
  type: 'object',
  properties: {
    offset: { type: 'integer', minimum: 0 },
    max_chars: { type: 'integer', minimum: 1, maximum: 8_000 }
  },
  required: ['offset', 'max_chars'],
  additionalProperties: false
} as const

const versionSchema = {
  type: 'object',
  properties: {
    expected_case_version: { type: 'integer', minimum: 1 }
  },
  required: ['expected_case_version'],
  additionalProperties: false
} as const

const searchSchema = {
  type: 'object',
  properties: {
    expected_case_version: { type: 'integer', minimum: 1 },
    mode: { type: 'string', enum: ['knowledge', 'workflow', 'both'] },
    limit: { type: 'integer', minimum: 1, maximum: 3 }
  },
  required: ['expected_case_version', 'mode', 'limit'],
  additionalProperties: false
} as const

const analysisSchema = {
  type: 'object',
  properties: {
    expected_case_version: { type: 'integer', minimum: 1 },
    summary: { type: 'string', minLength: 1, maxLength: 1_200 },
    hypotheses: {
      type: 'array', maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 500 }
    },
    next_commands: {
      type: 'array', maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 500 }
    },
    revision_refs: {
      type: 'array', maxItems: 5,
      items: { type: 'string', format: 'uuid' }
    }
  },
  required: [
    'expected_case_version', 'summary', 'hypotheses',
    'next_commands', 'revision_refs'
  ],
  additionalProperties: false
} as const

function contextInput(context: NetworkContext) {
  return {
    ...(context.vendor.trim() ? { vendor: context.vendor.trim() } : {}),
    ...(context.model.trim() ? { model: context.model.trim() } : {}),
    ...(context.operating_system.trim()
      ? { operating_system: context.operating_system.trim() }
      : {}),
    ...(context.version.trim() ? { version: context.version.trim() } : {})
  }
}

function hasSearchContext(context: NetworkContext): boolean {
  return Boolean(
    context.vendor.trim() ||
    context.model.trim() ||
    context.operating_system.trim(),
  )
}

function vendorFamily(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (['hewlettpackard', 'hewlettpackardenterprise', 'hpe', 'hp', 'aruba', 'arubanetworks']
    .includes(normalized)) return 'hpe-aruba'
  return normalized
}

function preferCurrentVendor(
  answers: KnowledgeAnswer[],
  vendor: string,
): KnowledgeAnswer[] {
  const requestedFamily = vendorFamily(vendor)
  if (!requestedFamily) return answers
  const matching = answers.filter((answer) =>
    vendorFamily(answer.applicability.vendor) === requestedFamily
  )
  return matching.length > 0 ? matching : answers
}

function isFallbackAnswer(answer: KnowledgeAnswer): boolean {
  return ['same_branch_fallback', 'nearest_patch', 'unknown']
    .includes(answer.applicability.version_match ?? '')
}

export function normalizeDetectedVersion(value: string | null): string {
  if (!value) return ''
  if (!/^\d+(?:\.\d+)+(?:[A-Za-z]|[.-][A-Za-z0-9]+)*$/.test(value)) {
    return value
  }
  return value.replace(/\d+/g, (segment) =>
    segment.replace(/^0+(?=\d)/, '')
  )
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function expectedVersion(value: unknown, current: number): void {
  if (value !== current) throw new Error('CASE_VERSION_CONFLICT')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function combinedSignal(left: AbortSignal | undefined, right: AbortSignal) {
  return left ? AbortSignal.any([left, right]) : right
}

function compactAnswer(answer: KnowledgeAnswer) {
  return {
    revision_ref: answer.revision_ref,
    kind: answer.kind,
    title: answer.title,
    summary: answer.summary,
    command: answer.command,
    procedure: answer.procedure.slice(0, 10),
    applicability: answer.applicability,
    last_verified_at: answer.last_verified_at
  }
}

export function WebMcpApp() {
  const [question, setQuestion] = useState(UPGRADE_QUESTION)
  const [evidence, setEvidence] = useState('')
  const [files, setFiles] = useState<EvidenceFile[]>([])
  const [context, setContext] = useState<NetworkContext>(emptyContext)
  const [startLine, setStartLine] = useState(1)
  const [endLine, setEndLine] = useState(1)
  const [shareWithAgent, setShareWithAgent] = useState(false)
  const [caseVersion, setCaseVersion] = useState(1)
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null)
  const [searchState, setSearchState] = useState<SearchState | null>(null)
  const [agentAnalysis, setAgentAnalysis] = useState<AgentAnalysis | null>(null)
  const [research, setResearch] = useState<ResearchTask | null>(null)
  const [researchCredentials, setResearchCredentials] =
    useState<ResearchCredentials | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const caseAbortRef = useRef(new AbortController())
  const caseVersionRef = useRef(caseVersion)

  const lineCount = Math.max(1, evidence.split('\n').length)
  const selectedRawEvidence = useMemo(
    () => lineWindow(evidence, startLine, Math.min(endLine, lineCount)),
    [evidence, startLine, endLine, lineCount],
  )
  const redactedEvidence = useMemo(
    () => redactEvidence(selectedRawEvidence),
    [selectedRawEvidence],
  )

  const liveRef = useRef({
    question, evidence, files, context, startLine, endLine, lineCount,
    redactedEvidence, shareWithAgent, caseVersion, searchState,
    agentAnalysis, research, researchCredentials
  })
  useEffect(() => {
    liveRef.current = {
      question, evidence, files, context, startLine, endLine, lineCount,
      redactedEvidence, shareWithAgent, caseVersion, searchState,
      agentAnalysis, research, researchCredentials
    }
    caseVersionRef.current = caseVersion
  }, [
    question, evidence, files, context, startLine, endLine, lineCount,
    redactedEvidence, shareWithAgent, caseVersion, searchState,
    agentAnalysis, research, researchCredentials
  ])

  useEffect(() => () => {
    caseAbortRef.current.abort('WORKBENCH_UNMOUNTED')
  }, [])

  const clearDerived = useCallback(() => {
    setSnapshot(null)
    setSearchState(null)
    setAgentAnalysis(null)
    setResearch(null)
    setResearchCredentials(null)
    setMessage(null)
  }, [])

  const advanceCase = useCallback(() => {
    caseAbortRef.current.abort('CASE_CHANGED')
    caseAbortRef.current = new AbortController()
    const next = caseVersionRef.current + 1
    caseVersionRef.current = next
    setCaseVersion(next)
    clearDerived()
    return next
  }, [clearDerived])

  const updateQuestion = (value: string) => {
    advanceCase()
    setQuestion(value.slice(0, 2_000))
  }

  const updateEvidence = (value: string) => {
    advanceCase()
    setFiles([])
    setEvidence(value)
    setStartLine(1)
    setEndLine(Math.min(300, Math.max(1, value.split('\n').length)))
  }

  const updateContext = (field: keyof NetworkContext, value: string) => {
    advanceCase()
    setContext((current) => ({ ...current, [field]: value.slice(0, 240) }))
  }

  const recordError = useCallback((error: unknown) => {
    const value = error instanceof Error ? error.message : String(error)
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
    if ([
      'CASE_VERSION_CONFLICT',
      'FILE_EXTRACTION_ABORTED',
      'MCP_REQUEST_ABORTED',
    ].includes(value) || code === 'MCP_REQUEST_ABORTED') return
    setMessage(value)
  }, [])

  const analyzeCase = useCallback(async (
    version: number,
    signal?: AbortSignal,
  ) => {
    const current = liveRef.current
    expectedVersion(version, current.caseVersion)
    if (!current.redactedEvidence.redacted.trim()) throw new Error('EVIDENCE_REQUIRED')
    const result = await callPublicMcpTool<SnapshotResult>(
      'analyze_device_snapshot',
      {
        snapshot: current.redactedEvidence.redacted,
        snapshot_type: 'auto',
        redaction_profile: 'secrets_only'
      },
      { signal: combinedSignal(signal, caseAbortRef.current.signal) },
    )
    expectedVersion(version, caseVersionRef.current)
    setSnapshot(result)
    const detectedContext = result.context
      ? {
          ...result.context,
          version: result.context.version
            ? normalizeDetectedVersion(result.context.version)
            : null
        }
      : null
    const compactResultBase = {
      snapshot_type: result.snapshot_type,
      redactions: result.redactions,
      limitations: result.limitations
    }
    if (!detectedContext) {
      return { case_version: version, context: null, ...compactResultBase }
    }

    const nextContext = {
      vendor: current.context.vendor || detectedContext.vendor,
      model: current.context.model || detectedContext.model || '',
      operating_system:
        current.context.operating_system || detectedContext.operating_system,
      version: current.context.version || detectedContext.version || ''
    }
    const compactResult = {
      context: { ...detectedContext, ...nextContext },
      ...compactResultBase
    }
    const changed = Object.keys(nextContext).some((key) =>
      nextContext[key as keyof NetworkContext] !==
      current.context[key as keyof NetworkContext]
    )
    if (!changed) return { case_version: version, ...compactResult }

    const nextVersion = advanceCase()
    setContext(nextContext)
    setSnapshot(result)
    return { case_version: nextVersion, ...compactResult }
  }, [advanceCase])

  const searchCase = useCallback(async (
    version: number,
    mode: SearchState['mode'],
    limit: number,
    signal?: AbortSignal,
  ) => {
    const current = liveRef.current
    expectedVersion(version, current.caseVersion)
    if (current.question.trim().length < 3) throw new Error('QUESTION_REQUIRED')
    if (!hasSearchContext(current.context)) throw new Error('CONTEXT_REQUIRED')
    const requestSignal = combinedSignal(signal, caseAbortRef.current.signal)
    const requests: Array<Promise<KnowledgeResult>> = []
    if (mode === 'knowledge' || mode === 'both') {
      requests.push(callPublicMcpTool<KnowledgeResult>(
        'query_network_knowledge',
        {
          question: current.question.trim(),
          context: contextInput(current.context),
          limit
        },
        { signal: requestSignal },
      ))
    }
    if (mode === 'workflow' || mode === 'both') {
      requests.push(callPublicMcpTool<KnowledgeResult>(
        'get_network_workflow',
        {
          goal: current.question.trim(),
          context: contextInput(current.context),
          limit
        },
        { signal: requestSignal },
      ))
    }
    const results = await Promise.all(requests)
    expectedVersion(version, caseVersionRef.current)
    const deduplicatedAnswers = [...new Map(
      results.flatMap((result) => result.answers)
        .map((answer) => [answer.revision_ref, answer]),
    ).values()]
    const answers = preferCurrentVendor(
      deduplicatedAnswers,
      current.context.vendor,
    ).slice(0, limit)
    const refs = answers.map((answer) => answer.revision_ref).slice(0, 5)
    const provenanceResult = refs.length
      ? await callPublicMcpTool<{
          revisions: Array<{
            revision_ref: string
            sources: ProvenanceSource[]
          }>
        }>('get_knowledge_provenance', { revision_refs: refs }, {
          signal: requestSignal
        })
      : { revisions: [] }
    expectedVersion(version, caseVersionRef.current)
    const status: SearchState['status'] = answers.length === 0
      ? 'unknown'
      : results.some((result) => result.answer_status === 'partial') ||
          answers.every(isFallbackAnswer)
        ? 'partial'
        : 'complete'
    const nextState: SearchState = {
      mode,
      status,
      answers,
      provenance: Object.fromEntries(
        provenanceResult.revisions.map((item) => [
          item.revision_ref, item.sources
        ]),
      ),
      learningStatus:
        results.find((result) => result.learning)?.learning?.status ?? null,
      caseVersion: version
    }
    setSearchState(nextState)
    return {
      case_version: version,
      answer_status: status,
      answers: answers.map(compactAnswer),
      provenance: provenanceResult.revisions,
      learning_status: nextState.learningStatus
    }
  }, [])

  const startResearch = useCallback(async (
    version: number,
    signal?: AbortSignal,
  ) => {
    const current = liveRef.current
    expectedVersion(version, current.caseVersion)
    if (current.searchState?.status !== 'unknown') {
      throw new Error('RESEARCH_REQUIRES_UNKNOWN_RESULT')
    }
    if (!hasSearchContext(current.context)) throw new Error('CONTEXT_REQUIRED')
    if (current.researchCredentials?.caseVersion === version) {
      return {
        case_version: version,
        task_id: current.researchCredentials.taskId,
        status: current.research?.status ?? 'queued'
      }
    }
    const key = await sha256Hex(JSON.stringify({
      question: current.question.trim().toLowerCase(),
      context: contextInput(current.context)
    }))
    const task = await callPublicMcpTool<ResearchTask>(
      'request_expert_answer',
      {
        question: current.question.trim(),
        context: contextInput(current.context),
        idempotency_key: `webmcp:${key}`
      },
      { signal: combinedSignal(signal, caseAbortRef.current.signal) },
    )
    expectedVersion(version, caseVersionRef.current)
    setResearch(task)
    setResearchCredentials({
      taskId: task.task_id,
      ...(task.access_token ? { accessToken: task.access_token } : {}),
      caseVersion: version
    })
    return { case_version: version, task_id: task.task_id, status: task.status }
  }, [])

  const getResearchStatus = useCallback(async (
    version: number,
    signal?: AbortSignal,
  ) => {
    const current = liveRef.current
    expectedVersion(version, current.caseVersion)
    const credentials = current.researchCredentials
    if (!credentials || credentials.caseVersion !== version) {
      throw new Error('RESEARCH_TASK_NOT_STARTED')
    }
    const task = await callPublicMcpTool<ResearchTask>(
      'get_expert_task',
      {
        task_id: credentials.taskId,
        ...(credentials.accessToken
          ? { access_token: credentials.accessToken }
          : {})
      },
      { signal: combinedSignal(signal, caseAbortRef.current.signal) },
    )
    expectedVersion(version, caseVersionRef.current)
    setResearch(task)
    return {
      case_version: version,
      task_id: task.task_id,
      status: task.status,
      stage: task.stage,
      input_request: task.input_request,
      answer: task.answer ? compactAnswer(task.answer) : null,
      failure: task.failure,
      poll_after_ms: task.poll_after_ms
    }
  }, [])

  useEffect(() => {
    if (!researchCredentials || !research) return
    if (['completed', 'failed', 'cancelled', 'expired', 'input_required']
      .includes(research.status)) return
    const timer = window.setTimeout(() => {
      void getResearchStatus(researchCredentials.caseVersion).catch(recordError)
    }, Math.min(30_000, Math.max(2_000, research.poll_after_ms)))
    return () => window.clearTimeout(timer)
  }, [researchCredentials, research, getResearchStatus, recordError])

  const toolRead = useWebMcpTool({
    name: 'read_network_case',
    description:
      'Read a bounded window of the user-approved, locally redacted network evidence currently visible in the workbench.',
    inputSchema: readCaseSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    onError: recordError,
    execute: (args) => {
      const current = liveRef.current
      if (!current.shareWithAgent) throw new Error('EVIDENCE_ACCESS_NOT_GRANTED')
      const offset = boundedInteger(
        args['offset'], 0, Number.MAX_SAFE_INTEGER, 0,
      )
      const maxChars = boundedInteger(args['max_chars'], 1, 8_000, 8_000)
      const redacted = current.redactedEvidence.redacted
      const window = redacted.slice(offset, offset + maxChars)
      return {
        case_version: current.caseVersion,
        question: current.question,
        context: contextInput(current.context),
        evidence: window,
        offset,
        next_offset: offset + window.length < redacted.length
          ? offset + window.length
          : null,
        total_chars: redacted.length,
        truncated: offset + window.length < redacted.length,
        files: current.files.map((file) => ({
          label: file.label, kind: file.kind, pages: file.pages
        }))
      }
    }
  })

  const toolAnalyze = useWebMcpTool({
    name: 'analyze_network_case',
    description:
      'Detect vendor, model, operating system, and version from the current user-approved redacted evidence.',
    inputSchema: versionSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    onError: recordError,
    execute: (args, options) => {
      if (!liveRef.current.shareWithAgent) {
        throw new Error('EVIDENCE_ACCESS_NOT_GRANTED')
      }
      return analyzeCase(
        boundedInteger(args['expected_case_version'], 1, 2_000_000, -1),
        options.signal,
      )
    }
  })

  const toolSearch = useWebMcpTool({
    name: 'search_network_case',
    description:
      'Search real active CliDeck knowledge and workflows for the current question and detected network context.',
    inputSchema: searchSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    onError: recordError,
    execute: (args, options) => searchCase(
      boundedInteger(args['expected_case_version'], 1, 2_000_000, -1),
      ['knowledge', 'workflow', 'both'].includes(String(args['mode']))
        ? args['mode'] as SearchState['mode']
        : 'both',
      boundedInteger(args['limit'], 1, 3, 3),
      options.signal,
    )
  })

  const toolPresent = useWebMcpTool({
    name: 'present_network_case_analysis',
    description:
      'Present a browser-agent interpretation separately from official CliDeck results. Citations must belong to the current case.',
    inputSchema: analysisSchema,
    annotations: { untrustedContentHint: true },
    onError: recordError,
    execute: (args) => {
      const current = liveRef.current
      const version = boundedInteger(
        args['expected_case_version'], 1, 2_000_000, -1,
      )
      expectedVersion(version, current.caseVersion)
      const allowed = new Set(
        current.searchState?.caseVersion === version
          ? current.searchState.answers.map((answer) => answer.revision_ref)
          : [],
      )
      const refs = Array.isArray(args['revision_refs'])
        ? args['revision_refs'].filter((ref): ref is string =>
            typeof ref === 'string'
          )
        : []
      if (refs.some((ref) => !allowed.has(ref))) {
        throw new Error('ANALYSIS_CITATION_NOT_IN_CURRENT_RESULTS')
      }
      const analysis: AgentAnalysis = {
        summary: String(args['summary'] ?? '').slice(0, 1_200),
        hypotheses: Array.isArray(args['hypotheses'])
          ? args['hypotheses'].slice(0, 6).map((value) => String(value).slice(0, 500))
          : [],
        next_commands: Array.isArray(args['next_commands'])
          ? args['next_commands'].slice(0, 20).map((value) => String(value).slice(0, 500))
          : [],
        revision_refs: refs,
        caseVersion: version
      }
      setAgentAnalysis(analysis)
      return { case_version: version, presented: true, revision_refs: refs }
    }
  })

  const toolStartResearch = useWebMcpTool({
    name: 'start_case_research',
    description:
      'Start one tracked CliDeck research task after the current real search has returned unknown.',
    inputSchema: versionSchema,
    onError: recordError,
    execute: (args, options) => startResearch(
      boundedInteger(args['expected_case_version'], 1, 2_000_000, -1),
      options.signal,
    )
  })

  const toolResearchStatus = useWebMcpTool({
    name: 'get_case_research_status',
    description:
      'Read the tracked research status for the current case without exposing task credentials.',
    inputSchema: versionSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    onError: recordError,
    execute: (args, options) => getResearchStatus(
      boundedInteger(args['expected_case_version'], 1, 2_000_000, -1),
      options.signal,
    )
  })

  const webMcpSupported = toolRead.supported
  const registeredTools = [
    toolRead, toolAnalyze, toolSearch, toolPresent,
    toolStartResearch, toolResearchStatus
  ].filter((tool) => tool.registered).length

  const runManual = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label)
    setMessage(null)
    try {
      await operation()
    } catch (error) {
      recordError(error)
    } finally {
      setBusy((current) => current === label ? null : current)
    }
  }

  const loadSample = (sample: string) => {
    advanceCase()
    setQuestion(UPGRADE_QUESTION)
    setEvidence(sample)
    setFiles([])
    setContext(emptyContext)
    setStartLine(1)
    setEndLine(sample.split('\n').length)
  }

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])]
    if (selected.length === 0) return
    const controller = caseAbortRef.current
    setBusy('files')
    setMessage(null)
    try {
      const extracted = await extractEvidenceFiles(selected, controller.signal)
      if (controller.signal.aborted) return
      const combined = combineEvidenceFiles(extracted)
      advanceCase()
      setFiles(extracted)
      setEvidence(combined)
      setStartLine(1)
      setEndLine(Math.min(300, Math.max(1, combined.split('\n').length)))
    } catch (error) {
      if (!controller.signal.aborted) recordError(error)
    } finally {
      setBusy((current) => current === 'files' ? null : current)
      event.target.value = ''
    }
  }

  const reset = () => {
    advanceCase()
    setBusy(null)
    setQuestion('')
    setEvidence('')
    setFiles([])
    setContext(emptyContext)
    setStartLine(1)
    setEndLine(1)
    setShareWithAgent(false)
  }

  return (
    <div className="webmcp-page webmcp-workbench">
      <header className="webmcp-header">
        <a className="webmcp-brand" href="/demo" aria-label="CliDeck public demo">
          <Atom aria-hidden="true" size={25} />
          <strong>CliDeck</strong>
          <span>Network Evidence Workbench</span>
        </a>
        <div className="webmcp-header__actions">
          <Status tone={webMcpSupported ? 'good' : 'neutral'}>
            {webMcpSupported
              ? `WebMCP connected · ${registeredTools}/6 tools`
              : 'Manual mode · WebMCP unavailable'}
          </Status>
          <span className="webmcp-version">Case v{caseVersion}</span>
        </div>
      </header>

      <main className="webmcp-main webmcp-workbench__main">
        <section className="webmcp-workbench__intro">
          <h1>Turn device evidence into an answer you can verify.</h1>
          <p>
            Paste real output, keep control of what the agent sees, and search
            CliDeck&apos;s official knowledge. Nothing here connects to or
            changes a network device.
          </p>
        </section>

        {!webMcpSupported && (
          <div className="webmcp-mode-note" role="status">
            <Bot aria-hidden="true" size={18} />
            <span>
              Every manual action below works in this browser. Open the same
              page in a WebMCP-enabled browser to let its agent use the case.
            </span>
          </div>
        )}

        {message && (
          <div className="webmcp-error" role="alert">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>{message}</span>
          </div>
        )}

        <div className="webmcp-workbench__grid">
          <section className="webmcp-workbench__case" aria-labelledby="network-case-title">
            <PanelHeading icon={<Network size={18} />} title="Network case" />
            <label className="webmcp-field">
              <span>Question <small>{question.length}/2000</small></span>
              <textarea
                value={question}
                maxLength={2_000}
                rows={4}
                placeholder="What do you need to understand or configure?"
                onChange={(event) => updateQuestion(event.target.value)}
              />
            </label>

            <div className="webmcp-evidence-heading">
              <span>Evidence</span>
              <small>{lineCount} lines · selected {startLine}–{Math.min(endLine, lineCount)}</small>
            </div>
            <textarea
              className="webmcp-evidence-editor"
              aria-label="Network evidence"
              value={evidence}
              rows={18}
              spellCheck={false}
              placeholder="Paste show version, configuration, command output, or logs…"
              onChange={(event) => updateEvidence(event.target.value)}
            />

            {files.length > 0 && (
              <div className="webmcp-file-list" aria-label="Selected files">
                {files.map((file) => (
                  <span key={file.id}>
                    <FileSearch size={14} />
                    {file.name}
                    <small>{file.kind}{file.pages ? ` · ${file.pages} pages` : ''}</small>
                  </span>
                ))}
              </div>
            )}

            <div className="webmcp-sample-actions">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept=".txt,.log,.md,.csv,.json,.jsonl,.html,.htm,.pdf,text/plain,text/csv,text/html,application/json,application/pdf"
                onChange={handleFiles}
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy === 'files'}
              >
                <FileUp size={16} /> {busy === 'files' ? 'Reading files…' : 'Upload files'}
              </Button>
              <Button type="button" onClick={() => loadSample(CISCO_SAMPLE_16_10)}>
                Load Cisco 16.10 sample
              </Button>
              <Button type="button" onClick={() => loadSample(CISCO_SAMPLE_17_8_1)}>
                Load Cisco 17.8.1 sample
              </Button>
            </div>

            <div className="webmcp-primary-actions">
              <Button
                variant="primary"
                disabled={Boolean(busy) || !redactedEvidence.redacted.trim()}
                onClick={() => void runManual('analyze', () =>
                  analyzeCase(caseVersionRef.current)
                )}
              >
                {busy === 'analyze' ? <LoaderCircle className="spin" size={16} /> : <FileSearch size={16} />}
                Analyze evidence
              </Button>
              <Button
                disabled={Boolean(busy) || !hasSearchContext(context)}
                onClick={() => void runManual('search', () =>
                  searchCase(caseVersionRef.current, 'knowledge', 3)
                )}
              >
                <Search size={16} /> Search knowledge
              </Button>
              <Button
                disabled={Boolean(busy) || !hasSearchContext(context)}
                onClick={() => void runManual('workflow', () =>
                  searchCase(caseVersionRef.current, 'workflow', 3)
                )}
              >
                <BookOpenCheck size={16} /> Find workflow
              </Button>
              <Button variant="quiet" onClick={reset}>
                <RotateCcw size={16} /> Reset
              </Button>
            </div>

            <label className="webmcp-share">
              <span>
                <strong>Share redacted evidence with browser agent</strong>
                <small>
                  Secrets and serials are removed locally first. IP, MAC,
                  hostname and username remain visible.
                </small>
              </span>
              <input
                type="checkbox"
                checked={shareWithAgent}
                onChange={(event) => setShareWithAgent(event.target.checked)}
              />
            </label>
          </section>

          <section className="webmcp-workbench__context" aria-labelledby="detected-context-title">
            <PanelHeading icon={<FileSearch size={18} />} title="Detected context" />
            {(['vendor', 'model', 'operating_system', 'version'] as const).map((field) => (
              <label className="webmcp-field" key={field}>
                <span>{field === 'operating_system' ? 'Operating system' : field[0]!.toUpperCase() + field.slice(1)}</span>
                <input
                  value={context[field]}
                  placeholder={field === 'version' ? 'Optional' : 'Not detected'}
                  onChange={(event) => updateContext(field, event.target.value)}
                />
              </label>
            ))}

            {!hasSearchContext(context) && (
              <div className="webmcp-context-required">
                Context required: analyze evidence or enter vendor, model, or OS.
              </div>
            )}

            <div className="webmcp-range">
              <strong>Evidence range</strong>
              <div>
                <label>From line
                  <input
                    type="number"
                    min={1}
                    max={lineCount}
                    value={startLine}
                    onChange={(event) => {
                      advanceCase()
                      setStartLine(Math.min(lineCount, Math.max(1, Number(event.target.value))))
                    }}
                  />
                </label>
                <span>—</span>
                <label>To line
                  <input
                    type="number"
                    min={startLine}
                    max={lineCount}
                    value={endLine}
                    onChange={(event) => {
                      advanceCase()
                      setEndLine(Math.min(lineCount, Math.max(startLine, Number(event.target.value))))
                    }}
                  />
                </label>
              </div>
              <small>
                The selected window is explicit; longer documents are never
                silently cut down.
              </small>
            </div>

            <div className="webmcp-redaction">
              <strong>Local redaction summary</strong>
              {redactedEvidence.redactions.length > 0 ? (
                <dl>
                  {redactedEvidence.redactions.map((item) => (
                    <div key={item.type}>
                      <dt>{item.type.replaceAll('_', ' ')}</dt>
                      <dd>{item.count}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p>No secret-like values detected in this window.</p>}
            </div>

            {snapshot && (
              <div className="webmcp-detection">
                <CheckCircle2 size={17} />
                <span>
                  <strong>{snapshot.snapshot_type.replaceAll('_', ' ')}</strong>
                  <small>
                    {snapshot.context
                      ? `${Math.round(snapshot.context.confidence * 100)}% fingerprint confidence`
                      : 'No deterministic fingerprint found'}
                  </small>
                </span>
              </div>
            )}

            <div className="webmcp-privacy-note">
              <LockKeyhole size={17} />
              <span>
                Raw files stay in this browser session. The selected redacted
                window is sent to CliDeck only when you analyze it. Search
                questions and research tasks are journaled server-side.
              </span>
            </div>

            {(evidence.includes('16.10.01') || evidence.includes('17.08.01')) && (
              <a className="webmcp-sample-source" href={CISCO_SAMPLE_SOURCE} target="_blank" rel="noreferrer">
                Official Cisco sample source <ChevronRight size={14} />
              </a>
            )}
          </section>

          <section className="webmcp-workbench__results" aria-labelledby="official-clideck-results-title">
            <PanelHeading
              icon={<ShieldCheck size={18} />}
              title="Official CliDeck results"
              trailing={searchState && <Status tone={searchState.status === 'complete' ? 'good' : 'warning'}>{searchState.status}</Status>}
            />
            {!searchState && (
              <EmptyResult>
                Analyze the evidence, then search the active CliDeck knowledge
                base. Full commands and source metadata appear here.
              </EmptyResult>
            )}
            {searchState?.status === 'unknown' && (
              <div className="webmcp-unknown">
                <FlaskConical size={20} />
                <span>
                  <strong>No applicable answer is active yet.</strong>
                  <small>
                    The gap was queued automatically. Start a tracked research
                    task only if you want to follow its lifecycle.
                  </small>
                </span>
                <Button
                  disabled={Boolean(busy) || Boolean(researchCredentials)}
                  onClick={() => void runManual('research', () =>
                    startResearch(caseVersionRef.current)
                  )}
                >
                  Research this gap
                </Button>
              </div>
            )}
            <div className="webmcp-answer-list">
              {searchState?.answers.map((answer) => (
                <KnowledgeResultCard
                  key={answer.revision_ref}
                  answer={answer}
                  sources={searchState.provenance[answer.revision_ref] ?? []}
                />
              ))}
            </div>

            <section className="webmcp-agent-analysis" aria-labelledby="browser-agent-title">
              <header>
                <Bot size={18} />
                <h3 id="browser-agent-title">Browser agent analysis</h3>
                <span>Interpretation, not official documentation</span>
              </header>
              {agentAnalysis ? (
                <div>
                  <p>{agentAnalysis.summary}</p>
                  {agentAnalysis.hypotheses.length > 0 && (
                    <ResultList title="Hypotheses" values={agentAnalysis.hypotheses} />
                  )}
                  {agentAnalysis.next_commands.length > 0 && (
                    <ResultList title="Suggested next commands" values={agentAnalysis.next_commands} code />
                  )}
                  <small>
                    Case v{agentAnalysis.caseVersion} · citations validated
                    against {agentAnalysis.revision_refs.length} current result(s).
                  </small>
                </div>
              ) : (
                <p>
                  A WebMCP browser agent can read the approved evidence and
                  place its reasoning here, clearly separated from CliDeck results.
                </p>
              )}
            </section>

            <ResearchStatus task={research} />
          </section>
        </div>
      </main>
    </div>
  )
}

function PanelHeading({
  icon,
  title,
  trailing
}: {
  icon: ReactNode
  title: string
  trailing?: ReactNode
}) {
  const id = title.toLowerCase().replaceAll(' ', '-')
  return (
    <header className="webmcp-panel-heading">
      <span>{icon}</span>
      <h2 id={`${id}-title`}>{title}</h2>
      {trailing}
    </header>
  )
}

function EmptyResult({ children }: { children: ReactNode }) {
  return (
    <div className="webmcp-empty-result">
      <Sparkles size={21} />
      <p>{children}</p>
    </div>
  )
}

function ResultList({
  title,
  values,
  code = false
}: {
  title: string
  values: string[]
  code?: boolean
}) {
  if (values.length === 0) return null
  return (
    <div className="webmcp-result-list">
      <strong>{title}</strong>
      <ol>
        {values.map((value, index) => (
          <li key={`${value}-${index}`}>{code ? <code>{value}</code> : value}</li>
        ))}
      </ol>
    </div>
  )
}

function KnowledgeResultCard({
  answer,
  sources
}: {
  answer: KnowledgeAnswer
  sources: ProvenanceSource[]
}) {
  const fallback = isFallbackAnswer(answer)
  const minimum = answer.applicability.versions.minimum
  const maximum = answer.applicability.versions.maximum
  const documentedRange = minimum || maximum
    ? `${minimum ?? 'any'}–${maximum ?? 'latest'}`
    : 'not specified'
  return (
    <article className="webmcp-answer">
      <header>
        <span><CheckCircle2 size={18} /></span>
        <div>
          <h3>{answer.title}</h3>
          <small>
            {answer.kind} · {answer.applicability.vendor}{' '}
            {answer.applicability.model ?? ''} ·{' '}
            {answer.applicability.operating_system}{' '}
            {answer.applicability.versions.requested ?? ''}
          </small>
          <Status tone={fallback ? 'warning' : 'good'}>
            {fallback
              ? `Nearest guidance · documented ${documentedRange}`
              : `Version matched · documented ${documentedRange}`}
          </Status>
        </div>
      </header>
      <p>{answer.summary}</p>
      {answer.command && <pre><code>{answer.command}</code></pre>}
      <ResultList title="Procedure" values={answer.procedure} code />
      <ResultList title="Prerequisites" values={answer.prerequisites} />
      <ResultList title="Verification" values={answer.verification} code />
      <ResultList title="Rollback" values={answer.rollback} code />
      <ResultList title="Limitations" values={answer.limitations} />
      <footer>
        <span>Verified {answer.last_verified_at}</span>
        <span>{answer.assurance.validation_level.replaceAll('_', ' ')}</span>
        <code>{answer.revision_ref}</code>
      </footer>
      <div className="webmcp-provenance">
        <strong>Provenance ({sources.length})</strong>
        {sources.length === 0 && <small>No public source metadata is available.</small>}
        {sources.map((source) => (
          <a key={`${source.url}-${source.source_ref ?? ''}`} href={source.url} target="_blank" rel="noreferrer">
            <span>
              <strong>{source.title}</strong>
              <small>
                {source.source_kind.replaceAll('_', ' ')} · verified {source.verified_at}
                {source.document_version ? ` · ${source.document_version}` : ''}
              </small>
            </span>
            <ChevronRight size={15} />
          </a>
        ))}
      </div>
    </article>
  )
}

function ResearchStatus({ task }: { task: ResearchTask | null }) {
  return (
    <section className="webmcp-research-status" aria-label="Research status">
      <header>
        <FlaskConical size={17} />
        <strong>Research status</strong>
        <Status tone={task?.status === 'completed' ? 'good' : task ? 'warning' : 'neutral'}>
          {task?.status ?? 'not started'}
        </Status>
      </header>
      {task ? (
        <div>
          <p>{task.failure?.message ?? task.input_request ?? `Current stage: ${task.stage}`}</p>
          {task.answer && (
            <p><strong>Published answer:</strong> {task.answer.title}</p>
          )}
          <small>
            Reset stops local polling but does not cancel the durable server task.
          </small>
        </div>
      ) : (
        <p>Tracked research is available only after a real unknown result.</p>
      )}
    </section>
  )
}
