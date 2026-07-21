import type {
  McpRequestLogDetail,
  McpRequestLogRow
} from '@clideck/admin-contracts'
import {
  CheckCircle2,
  Clock3,
  Eye,
  FileDown,
  MessageSquareText,
  Search,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  X
} from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Pagination,
  Panel,
  Status,
  type TableColumn
} from '../components/ui'
import {
  formatDate,
  formatNumber,
  numberOf,
  titleCase
} from '../lib/format'
import {
  type McpRequestFilters,
  useMcpRequest,
  useMcpRequests
} from '../lib/queries'
import { useOperationsRuntime } from '../lib/runtime'

const EMPTY_FILTERS: McpRequestFilters = {
  q: '',
  tool: '',
  outcome: '',
  limit: 25,
  offset: 0
}

const TOOL_OPTIONS = [
  'query_network_knowledge',
  'get_network_workflow',
  'resolve_network_context',
  'request_expert_answer',
  'get_expert_task',
  'continue_expert_task',
  'cancel_expert_task',
  'submit_feedback',
  'analyze_device_snapshot',
  'review_network_change',
  'verify_network_change',
  'advise_network_upgrade',
  'analyze_network_path',
  'list_knowledge_domains',
  'describe_knowledge_domain',
  'query_domain_knowledge'
]

export function McpRequestsPage() {
  const runtime = useOperationsRuntime()
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useMcpRequests(filters)
  const detail = useMcpRequest(selected)

  if (query.isLoading && !query.data) {
    return <LoadingState label="Loading MCP request journal…" />
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState onRetry={() => void query.refetch()}>
        MCP request journal is unavailable.
      </ErrorState>
    )
  }

  const page = query.data
  const successful = page.items.filter(
    (row) => row.outcome === 'success' || row.outcome === 'blocked',
  ).length
  const unknown = page.items.filter((row) => row.outcome === 'unknown').length
  const errors = page.items.filter(
    (row) => row.outcome === 'error' || row.outcome === 'rate_limited',
  ).length

  const columns: Array<TableColumn<McpRequestLogRow>> = [
    {
      key: 'time',
      label: 'Time',
      render: (row) => (
        <div className="primary-cell request-time">
          <strong>{formatDate(row.occurred_at)}</strong>
          <span>{formatNumber(row.duration_ms, 0)} ms</span>
        </div>
      )
    },
    {
      key: 'client',
      label: 'Client',
      render: (row) => (
        <div className="primary-cell">
          <code>{row.client_ip ?? 'Unknown'}</code>
          <span>{titleCase(row.actor_kind)}</span>
        </div>
      )
    },
    {
      key: 'tool',
      label: 'Tool',
      render: (row) => (
        <div className="primary-cell request-tool">
          <strong>{titleCase(row.tool_name)}</strong>
          <code>{row.tool_name}</code>
        </div>
      )
    },
    {
      key: 'question',
      label: 'Request',
      className: 'request-log__content',
      render: (row) => (
        <p className="request-preview" title={row.question_preview}>
          {row.question_preview}
        </p>
      )
    },
    {
      key: 'response',
      label: 'Response',
      className: 'request-log__content',
      render: (row) => (
        <p className="request-preview request-preview--response" title={row.response_preview}>
          {row.response_preview}
        </p>
      )
    },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (row) => (
        <div className="primary-cell">
          <Status tone={outcomeTone(row.outcome)}>
            {titleCase(row.outcome)}
          </Status>
          {row.learning_status && (
            <span>Learning · {titleCase(row.learning_status)}</span>
          )}
        </div>
      )
    }
  ]

  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric
          label="Matching requests"
          value={page.total}
          icon={MessageSquareText}
          help="Public MCP tool calls matching the current filters. Protocol initialization and health checks are not counted."
        />
        <Metric
          label="Answered on page"
          value={successful}
          icon={CheckCircle2}
          help="Calls on this page that returned a usable non-unknown response."
          tone="good"
        />
        <Metric
          label="Learning on page"
          value={unknown}
          icon={ServerCog}
          help="Unknown requests on this page that can feed the highest-priority knowledge demand loop."
          tone={unknown > 0 ? 'warning' : 'good'}
        />
        <Metric
          label="Errors on page"
          value={errors}
          icon={TriangleAlert}
          help="Structured failures and rate-limit responses on this page."
          tone={errors > 0 ? 'danger' : 'good'}
        />
      </section>

      <Panel
        title="Request journal"
        icon={ShieldCheck}
        help="A privacy-bounded operational journal. Inputs are redacted before storage, payload size is capped, and entries expire automatically."
        action={
          <Status tone={runtime.role === 'public_demo' ? 'warning' : 'info'}>
            {runtime.role === 'public_demo'
              ? 'Public responses · private requests'
              : 'Local super admin'}
          </Status>
        }
      >
        <form
          className="knowledge-filters request-log__filters"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ ...draft, offset: 0 })
          }}
        >
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search MCP requests"
              value={draft.q}
              onChange={(event) =>
                setDraft({ ...draft, q: event.target.value })}
              placeholder="Question or response text…"
            />
          </label>
          <label className="field field--compact">
            Tool
            <select
              value={draft.tool}
              onChange={(event) =>
                setDraft({ ...draft, tool: event.target.value })}
            >
              <option value="">All tools</option>
              {TOOL_OPTIONS.map((tool) => (
                <option value={tool} key={tool}>{titleCase(tool)}</option>
              ))}
            </select>
          </label>
          <label className="field field--compact">
            Outcome
            <select
              value={draft.outcome}
              onChange={(event) =>
                setDraft({ ...draft, outcome: event.target.value })}
            >
              <option value="">All outcomes</option>
              {['success', 'unknown', 'blocked', 'error', 'rate_limited']
                .map((outcome) => (
                  <option value={outcome} key={outcome}>
                    {titleCase(outcome)}
                  </option>
                ))}
            </select>
          </label>
          <button className="button button--primary" type="submit">
            Apply filters
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setDraft(EMPTY_FILTERS)
              setFilters(EMPTY_FILTERS)
            }}
          >
            Clear
          </button>
        </form>
      </Panel>

      <Panel
        title="MCP calls"
        icon={Clock3}
        help="Newest calls first. Open a row to inspect the redacted input, exact safe response, latency and demand-learning state."
      >
        <DataTable
          rows={page.items}
          columns={columns}
          rowKey={(row) => row.id}
          empty="No MCP requests match these filters."
          actions={(row) => (
            <Button
              variant="quiet"
              aria-label={`Inspect request ${row.id}`}
              onClick={() => setSelected(row.id)}
            >
              <Eye size={17} />
            </Button>
          )}
        />
        <Pagination
          offset={numberOf(page.offset)}
          limit={numberOf(page.limit)}
          total={numberOf(page.total)}
          onChange={(offset) => setFilters({ ...filters, offset })}
        />
      </Panel>

      {selected && (
        <RequestDetailDialog
          data={detail.data ?? null}
          loading={detail.isLoading}
          error={detail.isError}
          onRetry={() => void detail.refetch()}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function RequestDetailDialog({
  data,
  loading,
  error,
  onRetry,
  onClose
}: {
  data: McpRequestLogDetail | null
  loading: boolean
  error: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const runtime = useOperationsRuntime()
  const exportDiagnosis = (format: 'json' | 'markdown') => {
    if (!data?.learning_diagnosis || runtime.role !== 'super_admin') return
    const diagnosis = data.learning_diagnosis
    const content = format === 'json'
      ? JSON.stringify(diagnosis, null, 2)
      : [
          '# Learning diagnosis',
          '',
          `- Status: ${diagnosis.status}`,
          `- Failure class: ${diagnosis.failure_class ?? 'n/a'}`,
          `- Answer status: ${diagnosis.answer_status ?? 'n/a'}`,
          `- Topic: ${diagnosis.topic_slug ?? 'n/a'}`,
          `- Attempts: ${diagnosis.attempts}`,
          `- Luna tokens: ${diagnosis.luna_tokens}`,
          '',
          '## Missing capabilities',
          '',
          diagnosis.missing_capabilities.map((item) => `- ${item}`).join('\n') || '- None',
          '',
          '## Diagnosis',
          '',
          diagnosis.reasoning_summary ?? 'No summary.'
        ].join('\n')
    const url = URL.createObjectURL(new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/markdown'
    }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mcp-learning-diagnosis.${format === 'json' ? 'json' : 'md'}`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="dialog request-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-detail-title"
      >
        <header>
          <div className="dialog__icon"><MessageSquareText size={20} /></div>
          <div>
            <h2 id="request-detail-title">MCP request detail</h2>
            <p>Sanitized input, safe server response and learning status.</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {loading && <LoadingState label="Loading request detail…" />}
        {error && (
          <ErrorState onRetry={onRetry}>Request detail is unavailable.</ErrorState>
        )}
        {data && (
          <div className="request-detail__body">
            <div className="request-detail__meta">
              <span><b>Tool</b>{data.tool_name}</span>
              <span><b>Client</b>{data.client_ip ?? 'Unknown'}</span>
              <span><b>Outcome</b>{titleCase(data.outcome)}</span>
              <span><b>Latency</b>{formatNumber(data.duration_ms, 0)} ms</span>
              <span><b>Learning</b>{titleCase(data.learning_status ?? 'not required')}</span>
              <span><b>Time</b>{formatDate(data.occurred_at)}</span>
            </div>
            <section>
              <h3>Request</h3>
              <pre>{JSON.stringify(data.request_payload, null, 2)}</pre>
            </section>
            <section>
              <h3>Response</h3>
              <pre>{JSON.stringify(data.response_payload, null, 2)}</pre>
            </section>
            <section>
              <h3>Learning diagnosis</h3>
              {data.learning_diagnosis ? (
                <>
                  <div className="request-detail__meta">
                    <span><b>Cause</b>{titleCase(data.learning_diagnosis.failure_class ?? 'pending')}</span>
                    <span><b>Coverage</b>{titleCase(data.learning_diagnosis.answer_status ?? 'unknown')}</span>
                    <span><b>Topic</b>{data.learning_diagnosis.topic_slug ?? 'Pending'}</span>
                    <span><b>Attempts</b>{formatNumber(data.learning_diagnosis.attempts, 0)}</span>
                    <span><b>Luna</b>{formatNumber(data.learning_diagnosis.luna_tokens, 0)} tokens</span>
                  </div>
                  <pre>{JSON.stringify({
                    canonical_context: data.learning_diagnosis.canonical_context,
                    subquestions: data.learning_diagnosis.subquestions,
                    missing_capabilities: data.learning_diagnosis.missing_capabilities,
                    current_result: data.learning_diagnosis.replay_result,
                    explanation: data.learning_diagnosis.reasoning_summary
                  }, null, 2)}</pre>
                  {runtime.role === 'super_admin' && (
                    <div className="request-detail__exports">
                      <Button onClick={() => exportDiagnosis('json')}>
                        <FileDown size={16} /> Export JSON
                      </Button>
                      <Button onClick={() => exportDiagnosis('markdown')}>
                        <FileDown size={16} /> Export Markdown
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p>No diagnosis was required or it has not started yet.</p>
              )}
            </section>
          </div>
        )}
        <footer>
          <Button onClick={onClose}>Close</Button>
        </footer>
      </section>
    </div>
  )
}

function outcomeTone(
  outcome: McpRequestLogRow['outcome'],
): 'good' | 'warning' | 'danger' | 'info' {
  if (outcome === 'success') return 'good'
  if (outcome === 'unknown' || outcome === 'blocked') return 'warning'
  return 'danger'
}
