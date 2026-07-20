import {
  sessionSchema
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
  type ReactNode,
  Suspense,
  useEffect,
  useState
} from 'react'

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
  useOverview,
  useSession
} from './lib/queries'
import {
  OperationsRuntimeProvider,
  useOperationsRuntime
} from './lib/runtime'
const ActiveSourcePage = lazy(() => import('./pages/active-source').then((module) => ({ default: module.ActiveSourcePage })))
const AgentRunsPage = lazy(() => import('./pages/agent-runs').then((module) => ({ default: module.AgentRunsPage })))
const ApprovalsPage = lazy(() => import('./pages/approvals').then((module) => ({ default: module.ApprovalsPage })))
const ConflictsPage = lazy(() => import('./pages/conflicts').then((module) => ({ default: module.ConflictsPage })))
const CoveragePage = lazy(() => import('./pages/coverage').then((module) => ({ default: module.CoveragePage })))
const FeedbackPage = lazy(() => import('./pages/feedback').then((module) => ({ default: module.FeedbackPage })))
const ImportsPage = lazy(() => import('./pages/imports').then((module) => ({ default: module.ImportsPage })))
const KnowledgePage = lazy(() => import('./pages/knowledge').then((module) => ({ default: module.KnowledgePage })))
const LabPage = lazy(() => import('./pages/lab').then((module) => ({ default: module.LabPage })))
const McpRequestsPage = lazy(() => import('./pages/mcp-requests').then((module) => ({ default: module.McpRequestsPage })))
const OverviewPage = lazy(() => import('./pages/overview').then((module) => ({ default: module.OverviewPage })))
const PipelinePage = lazy(() => import('./pages/pipeline').then((module) => ({ default: module.PipelinePage })))
const ProvenancePage = lazy(() => import('./pages/provenance').then((module) => ({ default: module.ProvenancePage })))
const QualityPage = lazy(() => import('./pages/quality').then((module) => ({ default: module.QualityPage })))
const ReleasesPage = lazy(() => import('./pages/releases').then((module) => ({ default: module.ReleasesPage })))
const ReviewExceptionsPage = lazy(() => import('./pages/review-exceptions').then((module) => ({ default: module.ReviewExceptionsPage })))
const SourcesPage = lazy(() => import('./pages/sources').then((module) => ({ default: module.SourcesPage })))
const TasksPage = lazy(() => import('./pages/tasks').then((module) => ({ default: module.TasksPage })))

export default function App() {
  if (window.location.pathname.startsWith('/demo')) {
    return (
      <OperationsRuntimeProvider role="public_demo">
        <OperationsApp />
      </OperationsRuntimeProvider>
    )
  }
  return (
    <OperationsRuntimeProvider role="super_admin">
      <LocalAdminApp />
    </OperationsRuntimeProvider>
  )
}

function LocalAdminApp() {
  const sessionQuery = useSession()
  if (sessionQuery.isLoading) return <AppBoot />
  if (sessionQuery.isError || !sessionQuery.data?.authenticated) {
    return <LoginScreen onSuccess={() => void sessionQuery.refetch()} />
  }
  return <OperationsApp />
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
        <span className="eyebrow">CliDeck MCP 0.7</span>
        <h2>A knowledge factory you can actually understand.</h2>
        <p>Published output first. Every source, Luna run, safety gate and immutable release remains visible and controllable.</p>
        <div className="login-pipeline" aria-label="Pipeline stages">
          {['Discover', 'Acquire', 'Convert', 'Chunk', 'Analyze', 'Verify', 'Deep review', 'Publish'].map((stage, index) => (
            <span key={stage}><b>{index + 1}</b>{stage}</span>
          ))}
        </div>
      </aside>
    </main>
  )
}

function OperationsApp() {
  const queryClient = useQueryClient()
  const overviewQuery = useOverview()
  const runtime = useOperationsRuntime()
  const [section, setSection] = useState<SectionId>(sectionFromLocation)
  const [toast, setToast] = useState<string | null>(null)
  const concurrencyMutation = useMutation({
    mutationFn: (value: number) => runtime.executeMutation(
      '/admin/api/v1/pipeline/concurrency',
      { max_concurrent_ai_runs: value },
    ),
    onSuccess: async (result) => {
      setToast(result.message)
      await queryClient.invalidateQueries()
    }
  })
  const pipelineStateMutation = useMutation({
    mutationFn: (enabled: boolean) => runtime.executeMutation(
      '/admin/api/v1/pipeline/state',
      { enabled },
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
    const path = next === 'overview'
      ? runtime.routePrefix
      : `${runtime.routePrefix}/${next}`
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
        onPause={() =>
          pipelineStateMutation.mutate(!overview.pipeline_enabled)}
        onConcurrency={(value) => concurrencyMutation.mutate(value)}
        role={runtime.role}
        {...(runtime.role === 'super_admin'
          ? {
              onLogout: () => void postEmpty('/admin/auth/logout').then(() => {
                queryClient.clear()
                window.location.assign('/admin')
              })
            }
          : {})}
      >
        <Suspense fallback={<LoadingState label="Opening section…" />}>
          <CurrentPage section={section} overview={overview} />
        </Suspense>
      </AppShell>
      {toast && <Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast>}
      {concurrencyMutation.isError && <Toast tone="error" onClose={() => concurrencyMutation.reset()}>Could not change Luna concurrency.</Toast>}
      {pipelineStateMutation.isError && <Toast tone="error" onClose={() => pipelineStateMutation.reset()}>Could not change the pipeline state.</Toast>}
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
  return OPERATIONS_PAGE_REGISTRY[section](overview)
}

export const OPERATIONS_PAGE_REGISTRY: Record<
  SectionId,
  (
    overview: NonNullable<ReturnType<typeof useOverview>['data']>,
  ) => ReactNode
> = {
  overview: (overview) => <OverviewPage overview={overview} />,
  'mcp-requests': () => <McpRequestsPage />,
  pipeline: (overview) => <PipelinePage overview={overview} />,
  'active-source': () => <ActiveSourcePage />,
  'agent-runs': (overview) => <AgentRunsPage overview={overview} />,
  coverage: () => <CoveragePage />,
  sources: () => <SourcesPage />,
  knowledge: () => <KnowledgePage />,
  imports: () => <ImportsPage />,
  quality: () => <QualityPage />,
  lab: () => <LabPage />,
  conflicts: () => <ConflictsPage />,
  'review-exceptions': () => <ReviewExceptionsPage />,
  feedback: () => <FeedbackPage />,
  tasks: () => <TasksPage />,
  releases: () => <ReleasesPage />,
  approvals: () => <ApprovalsPage />,
  provenance: () => <ProvenancePage />
}
