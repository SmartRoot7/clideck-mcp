import {
  activeSourceDetailSchema,
  agentRunsSchema,
  approvalsSchema,
  conflictsSchema,
  coverageTargetsSchema,
  expertTasksSchema,
  feedbackRowsSchema,
  importRunsSchema,
  knowledgePageSchema,
  labSchema,
  overviewSchema,
  pipelineDetailsSchema,
  provenanceSchema,
  qualitySchema,
  releasesSchema,
  sessionSchema,
  sourcesSchema
} from '@clideck/admin-contracts'
import {
  keepPreviousData,
  useQuery
} from '@tanstack/react-query'

import { getJson } from './api'

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => getJson('/admin/api/v1/session', sessionSchema),
    retry: false,
    staleTime: 60_000
  })
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => getJson('/admin/api/v1/overview', overviewSchema),
    refetchInterval: 10_000,
    staleTime: 8_000
  })
}

export function useCoverage(enabled = true) {
  return useQuery({
    queryKey: ['coverage'],
    queryFn: () => getJson('/admin/api/v1/coverage', coverageTargetsSchema),
    enabled
  })
}

export function useSources(status: string, limit: number, enabled = true) {
  const search = new URLSearchParams()
  if (status) search.set('status', status)
  search.set('limit', String(limit))
  return useQuery({
    queryKey: ['sources', status, limit],
    queryFn: () =>
      getJson(`/admin/api/v1/sources?${search.toString()}`, sourcesSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function usePipeline(enabled = true) {
  return useQuery({
    queryKey: ['pipeline'],
    queryFn: () => getJson('/admin/api/v1/pipeline', pipelineDetailsSchema),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 8_000
  })
}

export function useActiveSource(enabled = true) {
  return useQuery({
    queryKey: ['active-source'],
    queryFn: () =>
      getJson('/admin/api/v1/active-source', activeSourceDetailSchema),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 8_000
  })
}

export type KnowledgeFilters = {
  q: string
  vendor: string
  operatingSystem: string
  kind: string
  risk: string
  origin: string
  limit: number
  offset: number
}

export function useKnowledge(filters: KnowledgeFilters, enabled = true) {
  const search = new URLSearchParams({
    limit: String(filters.limit),
    offset: String(filters.offset)
  })
  if (filters.q) search.set('q', filters.q)
  if (filters.vendor) search.set('vendor', filters.vendor)
  if (filters.operatingSystem) {
    search.set('operating_system', filters.operatingSystem)
  }
  if (filters.kind) search.set('kind', filters.kind)
  if (filters.risk) search.set('risk', filters.risk)
  if (filters.origin) search.set('origin', filters.origin)
  return useQuery({
    queryKey: ['knowledge', filters],
    queryFn: () =>
      getJson(`/admin/api/v1/knowledge?${search.toString()}`, knowledgePageSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useImports(enabled = true) {
  return useQuery({
    queryKey: ['imports'],
    queryFn: () => getJson('/admin/api/v1/imports', importRunsSchema),
    enabled
  })
}

export function useAgentRuns(limit = 100, enabled = true) {
  return useQuery({
    queryKey: ['agent-runs', limit],
    queryFn: () =>
      getJson(`/admin/api/v1/agent-runs?limit=${limit}`, agentRunsSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useTasks(enabled = true) {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => getJson('/admin/api/v1/tasks', expertTasksSchema),
    enabled
  })
}

export function useQuality(enabled = true) {
  return useQuery({
    queryKey: ['quality'],
    queryFn: () => getJson('/admin/api/v1/quality', qualitySchema),
    enabled
  })
}

export function useLab(enabled = true) {
  return useQuery({
    queryKey: ['lab'],
    queryFn: () => getJson('/admin/api/v1/lab', labSchema),
    enabled
  })
}

export function useConflicts(enabled = true) {
  return useQuery({
    queryKey: ['conflicts'],
    queryFn: () => getJson('/admin/api/v1/conflicts', conflictsSchema),
    enabled
  })
}

export function useReleases(enabled = true) {
  return useQuery({
    queryKey: ['releases'],
    queryFn: () => getJson('/admin/api/v1/releases', releasesSchema),
    enabled
  })
}

export function useFeedback(enabled = true) {
  return useQuery({
    queryKey: ['feedback'],
    queryFn: () => getJson('/admin/api/v1/feedback', feedbackRowsSchema),
    enabled
  })
}

export function useApprovals(enabled = true) {
  return useQuery({
    queryKey: ['approvals'],
    queryFn: () => getJson('/admin/api/v1/approvals', approvalsSchema),
    enabled
  })
}

export function useProvenance(revisionId: string | null) {
  return useQuery({
    queryKey: ['provenance', revisionId],
    queryFn: () =>
      getJson(
        `/admin/api/v1/revisions/${encodeURIComponent(revisionId ?? '')}/provenance`,
        provenanceSchema,
      ),
    enabled: Boolean(revisionId)
  })
}
