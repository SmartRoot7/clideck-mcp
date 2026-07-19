import {
  mutationAckSchema,
  sessionSchema,
  type MutationAck
} from '@clideck/admin-contracts'
import {
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import {
  Atom,
  LockKeyhole,
  ShieldCheck
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useState
} from 'react'

import { useAdminAction } from './components/action-dialog'
import {
  AppShell,
  sectionFromLocation,
  type SectionId
} from './components/app-shell'
import {
  ErrorState,
  LoadingState,
  Toast
} from './components/ui'
import {
  AdminApiError,
  postEmpty,
  postJson
} from './lib/api'
import {
  demoCoverage,
  demoOverview,
  demoPipeline,
  demoQuality
} from './lib/demo'
import {
  useOverview,
  usePublicDemoSnapshot,
  useSession
} from './lib/queries'
const ActiveSourcePage = lazy(() => import('./pages/active-source').then((module) => ({ default: module.ActiveSourcePage })))
const AgentRunsPage = lazy(() => import('./pages/agent-runs').then((module) => ({ default: module.AgentRunsPage })))
const ApprovalsPage = lazy(() => import('./pages/approvals').then((module) => ({ default: module.ApprovalsPage })))
const ConflictsPage = lazy(() => import('./pages/conflicts').then((module) => ({ default: module.ConflictsPage })))
const CoveragePage = lazy(() => import('./pages/coverage').then((module) => ({ default: module.CoveragePage })))
const FeedbackPage = lazy(() => import('./pages/feedback').then((module) => ({ default: module.FeedbackPage })))
const ImportsPage = lazy(() => import('./pages/imports').then((module) => ({ default: module.ImportsPage })))
const KnowledgePage = lazy(() => import('./pages/knowledge').then((module) => ({ default: module.KnowledgePage })))
const LabPage = lazy(() => import('./pages/lab').then((module) => ({ default: module.LabPage })))
const OverviewPage = lazy(() => import('./pages/overview').then((module) => ({ default: module.OverviewPage })))
const PipelinePage = lazy(() => import('./pages/pipeline').then((module) => ({ default: module.PipelinePage })))
const ProvenancePage = lazy(() => import('./pages/provenance').then((module) => ({ default: module.ProvenancePage })))
const QualityPage = lazy(() => import('./pages/quality').then((module) => ({ default: module.QualityPage })))
const ReleasesPage = lazy(() => import('./pages/releases').then((module) => ({ default: module.ReleasesPage })))
const SourcesPage = lazy(() => import('./pages/sources').then((module) => ({ default: module.SourcesPage })))
const TasksPage = lazy(() => import('./pages/tasks').then((module) => ({ default: module.TasksPage })))

export default function App() {
  if (window.location.pathname.startsWith('/demo')) {
    return <PublicDemoApp />
  }
  return <LocalAdminApp />
}

function LocalAdminApp() {
  const sessionQuery = useSession()
  if (sessionQuery.isLoading) return <AppBoot />
  if (sessionQuery.isError || !sessionQuery.data?.authenticated) {
    return <LoginScreen onSuccess={() => void sessionQuery.refetch()} />
  }
  return <AuthenticatedApp />
}

function PublicDemoApp() {
  const query = usePublicDemoSnapshot()
  const [section, setSection] = useState<SectionId>(sectionFromLocation)
  if (query.isLoading || !query.data) {
    if (query.isError) {
      return (
        <div className="standalone-state">
          <ErrorState onRetry={() => void query.refetch()}>
            The live read-only snapshot is temporarily unavailable.
          </ErrorState>
        </div>
      )
    }
    return <AppBoot />
  }
  const snapshot = query.data
  const overview = demoOverview(snapshot)
  const pipeline = demoPipeline(snapshot)
  const coverage = demoCoverage(snapshot)
  const quality = demoQuality(snapshot)
  const navigate = (next: SectionId) => {
    const allowed: SectionId[] = [
      'overview',
      'pipeline',
      'coverage',
      'quality'
    ]
    if (!allowed.includes(next)) return
    window.history.pushState(
      {},
      '',
      next === 'overview' ? '/demo' : `/demo/${next}`,
    )
    setSection(next)
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
    })
  }
  return (
    <AppShell
      section={section}
      overview={overview}
      refreshing={query.isFetching}
      onNavigate={navigate}
      onRefresh={() => void query.refetch()}
      publicMode
    >
      <Suspense fallback={<LoadingState label="Opening section…" />}>
        <PublicDemoPage
          section={section}
          overview={overview}
          pipeline={pipeline}
          coverage={coverage}
          quality={quality}
        />
      </Suspense>
    </AppShell>
  )
}

function PublicDemoPage({
  section,
  overview,
  pipeline,
  coverage,
  quality
}: {
  section: SectionId
  overview: ReturnType<typeof demoOverview>
  pipeline: ReturnType<typeof demoPipeline>
  coverage: ReturnType<typeof demoCoverage>
  quality: ReturnType<typeof demoQuality>
}) {
  switch (section) {
    case 'pipeline':
      return <PipelinePage overview={overview} data={pipeline} readOnly />
    case 'coverage':
      return <CoveragePage data={coverage} readOnly />
    case 'quality':
      return <QualityPage data={quality} readOnly />
    default:
      return (
        <OverviewPage
          overview={overview}
          pipelineData={pipeline}
          coverageData={coverage}
          publicMode
        />
      )
  }
}

function AppBoot() {
  return (
    <div className="app-boot">
      <span className="brand__mark"><Atom size={22} /></span>
      <LoadingState label="Opening local operations console…" />
    </div>
  )
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => postJson('/admin/auth/login', { username, password }, sessionSchema),
    onSuccess,
    onError: (current) => {
      if (current instanceof AdminApiError && current.status === 429) {
        setError('Too many attempts. Wait 15 minutes before trying again.')
      } else {
        setError('The username or password is incorrect.')
      }
    }
  })
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand__mark"><Atom size={21} /></span>
          <div><strong>CliDeck MCP</strong><span>Network Knowledge Operations</span></div>
        </div>
        <div className="login-heading">
          <span><LockKeyhole size={20} /></span>
          <h1>Local admin access</h1>
          <p>This console is reachable only from the trusted LAN. Sign in as the single local super administrator.</p>
        </div>
        <form onSubmit={(event) => {
          event.preventDefault()
          setError('')
          mutation.mutate()
        }}>
          <label className="field">Username
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </label>
          <label className="field">Password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button--primary login-submit" type="submit" disabled={!username || !password || mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Open operations console'}
          </button>
        </form>
        <footer>
          <ShieldCheck size={17} />
          <span>12-hour encrypted session · SameSite Strict · no remote access</span>
        </footer>
      </section>
      <aside className="login-context">
        <span className="eyebrow">CliDeck MCP 0.5</span>
        <h2>A knowledge factory you can actually understand.</h2>
        <p>Published output first. Every source, Luna run, safety gate and immutable release remains visible and controllable.</p>
        <div className="login-pipeline" aria-label="Pipeline stages">
          {['Discover', 'Acquire', 'Convert', 'Chunk', 'Analyze', 'Verify', 'Publish'].map((stage, index) => (
            <span key={stage}><b>{index + 1}</b>{stage}</span>
          ))}
        </div>
      </aside>
    </main>
  )
}

function AuthenticatedApp() {
  const queryClient = useQueryClient()
  const overviewQuery = useOverview()
  const action = useAdminAction()
  const [section, setSection] = useState<SectionId>(sectionFromLocation)
  const [toast, setToast] = useState<string | null>(null)
  const concurrencyMutation = useMutation({
    mutationFn: (value: number) => postJson<MutationAck>(
      '/admin/api/v1/pipeline/concurrency',
      { max_concurrent_ai_runs: value },
      mutationAckSchema,
    ),
    onSuccess: async (result) => {
      setToast(result.message)
      await queryClient.invalidateQueries()
    }
  })

  useEffect(() => {
    const onPopState = () => setSection(sectionFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (overviewQuery.isLoading || !overviewQuery.data) {
    if (overviewQuery.isError) return (
      <div className="standalone-state">
        <ErrorState onRetry={() => void overviewQuery.refetch()}>The local admin backend is unavailable.</ErrorState>
      </div>
    )
    return <AppBoot />
  }

  const navigate = (next: SectionId) => {
    const path = next === 'overview' ? '/admin' : `/admin/${next}`
    window.history.pushState({}, '', path)
    setSection(next)
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const overview = overviewQuery.data
  return (
    <>
      <AppShell
        section={section}
        overview={overview}
        refreshing={overviewQuery.isFetching}
        onNavigate={navigate}
        onRefresh={() => void queryClient.invalidateQueries()}
        onPause={() => action.open({
          title: overview.pipeline_enabled ? 'Pause all Luna' : 'Resume pipeline',
          summary: overview.pipeline_enabled
            ? 'Stop every Luna process within 10 seconds. Mechanical work may finish, but no new token-consuming task will start.'
            : 'Resume the continuous scheduler and allow configured Luna executors to claim unfinished work.',
          path: '/admin/api/v1/pipeline/state',
          confirmText: overview.pipeline_enabled ? 'PAUSE' : 'RESUME',
          requireReason: true,
          danger: overview.pipeline_enabled,
          buildBody: (reason) => ({ enabled: !overview.pipeline_enabled, reason })
        })}
        onConcurrency={(value) => concurrencyMutation.mutate(value)}
        onLogout={() => void postEmpty('/admin/auth/logout').then(() => {
          queryClient.clear()
          window.location.assign('/admin')
        })}
      >
        <Suspense fallback={<LoadingState label="Opening section…" />}>
          <CurrentPage section={section} overview={overview} />
        </Suspense>
      </AppShell>
      {action.dialog}{action.toast}
      {toast && <Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast>}
      {concurrencyMutation.isError && <Toast tone="error" onClose={() => concurrencyMutation.reset()}>Could not change Luna concurrency.</Toast>}
    </>
  )
}

function CurrentPage({
  section,
  overview
}: {
  section: SectionId
  overview: NonNullable<ReturnType<typeof useOverview>['data']>
}) {
  switch (section) {
    case 'overview': return <OverviewPage overview={overview} />
    case 'pipeline': return <PipelinePage overview={overview} />
    case 'active-source': return <ActiveSourcePage />
    case 'agent-runs': return <AgentRunsPage overview={overview} />
    case 'coverage': return <CoveragePage />
    case 'sources': return <SourcesPage />
    case 'knowledge': return <KnowledgePage />
    case 'imports': return <ImportsPage />
    case 'quality': return <QualityPage />
    case 'lab': return <LabPage />
    case 'conflicts': return <ConflictsPage />
    case 'feedback': return <FeedbackPage />
    case 'tasks': return <TasksPage />
    case 'releases': return <ReleasesPage />
    case 'approvals': return <ApprovalsPage />
    case 'provenance': return <ProvenancePage />
  }
}
