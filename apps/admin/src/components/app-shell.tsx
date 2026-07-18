import type { Overview } from '@clideck/admin-contracts'
import {
  Activity,
  AlertTriangle,
  Atom,
  Beaker,
  BookOpen,
  Bot,
  Boxes,
  BrainCircuit,
  ChevronDown,
  CircleGauge,
  Database,
  FileCheck2,
  FileSearch,
  GitCompareArrows,
  History,
  Import,
  Layers3,
  Menu,
  MessageSquareText,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  type LucideIcon,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { formatDate, titleCase } from '../lib/format'
import { Button, Status } from './ui'

export type SectionId =
  | 'overview'
  | 'pipeline'
  | 'active-source'
  | 'agent-runs'
  | 'coverage'
  | 'sources'
  | 'knowledge'
  | 'imports'
  | 'quality'
  | 'lab'
  | 'conflicts'
  | 'feedback'
  | 'tasks'
  | 'releases'
  | 'approvals'
  | 'provenance'

const GROUPS: Array<{
  label: string
  items: Array<{ id: SectionId; label: string; icon: LucideIcon }>
}> = [
  {
    label: 'Monitor',
    items: [
      { id: 'overview', label: 'Overview', icon: CircleGauge },
      { id: 'pipeline', label: 'Pipeline', icon: Network },
      { id: 'active-source', label: 'Active Source', icon: FileCheck2 },
      { id: 'agent-runs', label: 'Agent Runs', icon: BrainCircuit }
    ]
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'coverage', label: 'Coverage', icon: Activity },
      { id: 'sources', label: 'Sources', icon: Database },
      { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
      { id: 'imports', label: 'Imports', icon: Import }
    ]
  },
  {
    label: 'Assurance',
    items: [
      { id: 'quality', label: 'Quality', icon: ShieldCheck },
      { id: 'lab', label: 'Lab', icon: Beaker },
      { id: 'conflicts', label: 'Conflicts', icon: GitCompareArrows },
      { id: 'feedback', label: 'Feedback', icon: MessageSquareText }
    ]
  },
  {
    label: 'Control',
    items: [
      { id: 'tasks', label: 'Expert Tasks', icon: Bot },
      { id: 'releases', label: 'Releases', icon: Tag },
      { id: 'approvals', label: 'Approvals', icon: FileSearch },
      { id: 'provenance', label: 'Provenance', icon: History }
    ]
  }
]

export function sectionFromLocation(): SectionId {
  const segment = window.location.pathname
    .replace(/^\/admin\/?/, '')
    .split('/')[0]
  const all = GROUPS.flatMap((group) => group.items.map((item) => item.id))
  return all.includes(segment as SectionId)
    ? segment as SectionId
    : 'overview'
}

export function AppShell({
  section,
  overview,
  refreshing,
  children,
  onNavigate,
  onRefresh,
  onPause,
  onConcurrency,
  onLogout
}: {
  section: SectionId
  overview: Overview | undefined
  refreshing: boolean
  children: ReactNode
  onNavigate: (section: SectionId) => void
  onRefresh: () => void
  onPause: () => void
  onConcurrency: (value: number) => void
  onLogout: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const enabled = overview?.pipeline_enabled ?? false
  const activeSource = overview?.active_source_title ?? 'No active source'
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <span className="brand__mark"><Atom size={19} /></span>
          <strong>CliDeck MCP</strong>
          <button type="button" className="sidebar__close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>
            <X size={19} />
          </button>
        </div>
        <nav aria-label="Admin sections">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group__label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={section === item.id ? 'nav-item is-active' : 'nav-item'}
                    aria-current={section === item.id ? 'page' : undefined}
                    title={item.label}
                    onClick={() => {
                      onNavigate(item.id)
                      setMenuOpen(false)
                    }}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span>Local network only</span>
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      {menuOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="workspace">
        <header className="command-bar">
          <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="command-bar__status">
            <Status tone={enabled ? 'good' : 'warning'}>
              {enabled ? 'Running' : 'Paused'}
            </Status>
            <i />
            <span className="command-bar__source">
              <small>Active source</small>
              <strong>{activeSource}</strong>
            </span>
          </div>
          <div className="command-bar__actions">
            <Button variant={enabled ? 'secondary' : 'primary'} onClick={onPause}>
              {enabled ? <Pause size={16} /> : <Play size={16} />}
              {enabled ? 'Pause all Luna' : 'Resume pipeline'}
            </Button>
            <label className="executor-select">
              <Boxes size={17} />
              <select
                aria-label="Configured Luna executors"
                value={Number(overview?.max_concurrent_ai_runs ?? 1)}
                onChange={(event) => onConcurrency(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option value={value} key={value}>{value} executors</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <Button variant="quiet" aria-label="Refresh live data" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
            </Button>
          </div>
        </header>
        <main className="workspace__content">
          <div className="page-heading">
            <div>
              <h1>{titleCase(section)}</h1>
              <p>{SECTION_COPY[section]}</p>
            </div>
            <span className="page-heading__updated">
              Updated {formatDate(overview?.pipeline_updated_at ?? null)}
            </span>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}

const SECTION_COPY: Record<SectionId, string> = {
  overview: 'Published knowledge, live throughput, cost and operational health.',
  pipeline: 'Every stage from source discovery through immutable publication.',
  'active-source': 'Progress, evidence extraction and candidates for the current source.',
  'agent-runs': 'Luna capacity, token efficiency, duration and run outcomes.',
  coverage: 'Prioritised vendor, model, operating system and document gaps.',
  sources: 'Discovered documents, acquisition state and source-level controls.',
  knowledge: 'Search the complete active knowledge release with precise filters.',
  imports: 'Legacy reconciliation, completeness and atomic import history.',
  quality: 'Confidence, evaluation results, latency and dangerous-safety gates.',
  lab: 'Batfish and containerlab evidence linked to revisions and commits.',
  conflicts: 'Knowledge disagreements that need an explicit audited decision.',
  feedback: 'Operator feedback connected to revisions and expert tasks.',
  tasks: 'Urgent expert work, stage progress, ownership and recovery controls.',
  releases: 'Immutable knowledge packages and the currently active snapshot.',
  approvals: 'Human decisions for code changes that cannot proceed automatically.',
  provenance: 'Restricted evidence and lineage for an individual revision.'
}

export const NAVIGATION_GROUPS = GROUPS
