import type { IntakeJob } from '@clideck/admin-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleX, FileUp, Globe2, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { z } from 'zod'

import { Button, DataTable, ErrorState, LoadingState, Panel, Status, type TableColumn } from '../components/ui'
import { formatDate, numberOf, titleCase } from '../lib/format'
import { postJson } from '../lib/api'
import { useIntakeJobs } from '../lib/queries'

type IntakeAck = { ok: true; job_id: string }

function checkedFiles(list: FileList | null): File[] {
  const files = [...(list ?? [])]
  if (files.length > 100) throw new Error('A job can contain at most 100 files.')
  if (files.some((file) => file.size > 100 * 1024 * 1024)) {
    throw new Error('Each file must be 100 MiB or smaller.')
  }
  if (files.reduce((total, file) => total + file.size, 0) > 1024 * 1024 * 1024) {
    throw new Error('A job can contain at most 1 GiB.')
  }
  return files
}

async function streamUpload(file: File, sourceKind: 'admin_document' | 'pasted_text' | 'field_log', title?: string, jobId?: string): Promise<IntakeAck> {
  const response = await fetch('/admin/api/v1/intake/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-clideck-file-name': encodeURIComponent(file.name),
      'x-clideck-title': encodeURIComponent(title || file.name),
      'x-clideck-source-kind': sourceKind,
      ...(jobId ? { 'x-clideck-job-id': jobId } : {})
    },
    body: file
  })
  if (!response.ok) throw new Error('Upload failed')
  return response.json() as Promise<IntakeAck>
}

export function IntakePage() {
  const query = useIntakeJobs()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const logInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [pageLimit, setPageLimit] = useState(5000)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'intake-jobs'] })
  const website = useMutation({
    mutationFn: () => postJson('/admin/api/v1/intake/website', { root_url: url, page_limit: pageLimit }, intakeAckSchema),
    onSuccess: () => { setUrl(''); void refresh() }
  })
  const upload = useMutation({
    mutationFn: async ({ files, kind }: { files: File[]; kind: 'admin_document' | 'field_log' }) => {
      let jobId: string | undefined
      for (const file of files) {
        jobId = (await streamUpload(file, kind, undefined, jobId)).job_id
      }
    },
    onSuccess: () => void refresh()
  })
  const paste = useMutation({
    mutationFn: () => streamUpload(new File([pasteText], `${pasteTitle || 'pasted-text'}.txt`, { type: 'text/plain' }), 'pasted_text', pasteTitle),
    onSuccess: () => { setPasteText(''); setPasteTitle(''); void refresh() }
  })
  const reprocess = useMutation({
    mutationFn: () => postJson('/admin/api/v1/intake/reprocess', {
        source_ids: null,
        confirmed: true
      }, intakeAckSchema),
    onSuccess: () => void refresh()
  })
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => postJson(`/admin/api/v1/intake/jobs/${id}/action`, { action }, intakeActionAckSchema),
    onSuccess: () => void refresh()
  })
  if (query.isLoading) return <LoadingState label="Loading intake jobs…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Intake is unavailable.</ErrorState>
  return <div className="dashboard-stack">
    <section className="panel-grid panel-grid--two">
      <Panel title="Website" icon={Globe2} help="Crawl an HTTPS documentation section. Sitemap is preferred; traversal stays inside its host and path prefix.">
        <form className="filter-grid" onSubmit={(event) => { event.preventDefault(); website.mutate() }}>
          <label className="field">Root URL<input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://vendor.example/docs/" /></label>
          <label className="field">Page limit<input type="number" min={1} max={50000} value={pageLimit} onChange={(event) => setPageLimit(Number(event.target.value))} /></label>
          <Button type="submit" disabled={website.isPending}>Start crawl</Button>
        </form>
      </Panel>
      <Panel title="Paste text" icon={FileUp} help="Create an immutable first-party source from operational notes or a manual excerpt (up to 5 MiB).">
        <form className="dashboard-stack" onSubmit={(event) => { event.preventDefault(); paste.mutate() }}>
          <label className="field">Title<input required value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} /></label>
          <label className="field">Text<textarea required rows={8} value={pasteText} onChange={(event) => setPasteText(event.target.value)} /></label>
          <Button type="submit" disabled={paste.isPending || new Blob([pasteText]).size > 5 * 1024 * 1024}>Add text</Button>
        </form>
      </Panel>
      <Panel title="Documents" icon={FileUp} help="PDF, TXT, MD, HTML, CSV, JSON, JSONL and LOG; up to 100 MiB per file.">
        <input ref={fileInput} type="file" hidden multiple accept=".pdf,.txt,.md,.html,.htm,.csv,.json,.jsonl,.log" onChange={(event) => upload.mutate({ files: checkedFiles(event.target.files), kind: 'admin_document' })} />
        <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>Choose files</Button>
      </Panel>
      <Panel title="Sanitized field logs" icon={FileUp} help="Secrets and stable identifiers are removed before the immutable artifact is retained. Raw staging is deleted.">
        <input ref={logInput} type="file" hidden multiple accept=".txt,.log" onChange={(event) => upload.mutate({ files: checkedFiles(event.target.files), kind: 'field_log' })} />
        <Button onClick={() => logInput.current?.click()} disabled={upload.isPending}>Choose logs</Button>
      </Panel>
    </section>
    <Panel title="Reprocess" icon={RotateCcw} help="Re-run every retained source under the current processing version. Existing active knowledge is not removed automatically.">
      <Button variant="secondary" disabled={reprocess.isPending} onClick={() => reprocess.mutate()}>Reprocess all source materials</Button>
    </Panel>
    <Panel title="Jobs" icon={RefreshCw} help="Durable intake, crawl and reprocessing progress.">
      <DataTable rows={query.data} columns={jobColumns((id, next) => action.mutate({ id, action: next }))} rowKey={(row) => row.id} empty="No intake jobs yet." />
    </Panel>
  </div>
}

const intakeAckSchema = z.object({ ok: z.literal(true), job_id: z.string() }).passthrough()
const intakeActionAckSchema = z.object({ ok: z.literal(true) }).passthrough()
function jobColumns(onAction: (id: string, action: string) => void): Array<TableColumn<IntakeJob>> {
  return [
    { key: 'job', label: 'Job', render: (row) => <div className="primary-cell"><strong>{row.title}</strong><span>{titleCase(row.job_kind)} · {formatDate(row.created_at)}</span></div> },
    { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
    { key: 'progress', label: 'Results', render: (row) => `${numberOf(row.completed_items)} complete · ${numberOf(row.failed_items)} failed · ${numberOf(row.unavailable_items)} unavailable` },
    { key: 'stage', label: 'Stage', render: (row) => row.current_stage ? titleCase(row.current_stage) : '—' },
    { key: 'actions', label: '', render: (row) => <div className="row-actions">
      {(row.status === 'queued' || row.status === 'running') && <Button variant="quiet" onClick={() => onAction(row.id, 'pause')}><Pause size={15} /> Pause</Button>}
      {(row.status === 'queued' || row.status === 'running' || row.status === 'paused') && <Button variant="quiet" onClick={() => onAction(row.id, 'cancel')}><CircleX size={15} /> Cancel</Button>}
      {row.status === 'paused' && <Button variant="quiet" onClick={() => onAction(row.id, 'resume')}><Play size={15} /> Resume</Button>}
      {(row.status === 'failed' || row.status === 'completed_with_errors') && <Button variant="quiet" onClick={() => onAction(row.id, 'retry')}><RefreshCw size={15} /> Retry</Button>}
    </div> }
  ]
}
