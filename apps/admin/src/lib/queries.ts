import {
  activeSourceDetailSchema,
  activeSourceLanesSchema,
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
  reviewExceptionDetailSchema,
  reviewExceptionsSchema,
  sessionSchema,
  sourcesSchema
} from '@clideck/admin-contracts'
import {
  keepPreviousData,
  useQuery
} from '@tanstack/react-query'

import { getJson } from './api'
import { useOperationsRuntime } from './runtime'

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => getJson('/admin/api/v1/session', sessionSchema),
    retry: false,
    staleTime: 60_000
  })
}

export function useOverview() {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'overview'],
    queryFn: () => getJson(`${apiPrefix}/overview`, overviewSchema),
    refetchInterval: 10_000,
    staleTime: 8_000
  })
}

export function useCoverage(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'coverage'],
    queryFn: () => getJson(`${apiPrefix}/coverage`, coverageTargetsSchema),
    enabled
  })
}

export function useSources(status: string, limit: number, enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  const search = new URLSearchParams()
  if (status) search.set('status', status)
  search.set('limit', String(limit))
  return useQuery({
    queryKey: [apiPrefix, 'sources', status, limit],
    queryFn: () =>
      getJson(`${apiPrefix}/sources?${search.toString()}`, sourcesSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function usePipeline(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'pipeline'],
    queryFn: () => getJson(`${apiPrefix}/pipeline`, pipelineDetailsSchema),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 8_000
  })
}

export function useActiveSource(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'active-source'],
    queryFn: () =>
      getJson(`${apiPrefix}/active-source`, activeSourceDetailSchema),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 8_000
  })
}

export function useActiveSources(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'active-sources'],
    queryFn: () =>
      getJson(`${apiPrefix}/active-sources`, activeSourceLanesSchema),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 8_000
  })
}

export function useReviewExceptions(
  status: '' | 'manual_exception' | 'quarantined',
  enabled = true
) {
  const { apiPrefix } = useOperationsRuntime()
  const suffix = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: [apiPrefix, 'review-exceptions', status],
    queryFn: () => getJson(
      `${apiPrefix}/review-exceptions${suffix}`,
      reviewExceptionsSchema
    ),
    enabled,
    refetchInterval: enabled ? 15_000 : false
  })
}

export function useReviewException(
  candidateId: string | null
) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'review-exception', candidateId],
    queryFn: () => getJson(
      `${apiPrefix}/review-exceptions/${encodeURIComponent(
        candidateId ?? ''
      )}`,
      reviewExceptionDetailSchema
    ),
    enabled: Boolean(candidateId)
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
  const { apiPrefix } = useOperationsRuntime()
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
    queryKey: [apiPrefix, 'knowledge', filters],
    queryFn: () =>
      getJson(`${apiPrefix}/knowledge?${search.toString()}`, knowledgePageSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useImports(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'imports'],
    queryFn: () => getJson(`${apiPrefix}/imports`, importRunsSchema),
    enabled
  })
}

export function useAgentRuns(limit = 100, enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'agent-runs', limit],
    queryFn: () =>
      getJson(`${apiPrefix}/agent-runs?limit=${limit}`, agentRunsSchema),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useTasks(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'tasks'],
    queryFn: () => getJson(`${apiPrefix}/tasks`, expertTasksSchema),
    enabled
  })
}

export function useQuality(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'quality'],
    queryFn: () => getJson(`${apiPrefix}/quality`, qualitySchema),
    enabled
  })
}

export function useLab(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'lab'],
    queryFn: () => getJson(`${apiPrefix}/lab`, labSchema),
    enabled
  })
}

export function useConflicts(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'conflicts'],
    queryFn: () => getJson(`${apiPrefix}/conflicts`, conflictsSchema),
    enabled
  })
}

export function useReleases(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'releases'],
    queryFn: () => getJson(`${apiPrefix}/releases`, releasesSchema),
    enabled
  })
}

export function useFeedback(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'feedback'],
    queryFn: () => getJson(`${apiPrefix}/feedback`, feedbackRowsSchema),
    enabled
  })
}

export function useApprovals(enabled = true) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'approvals'],
    queryFn: () => getJson(`${apiPrefix}/approvals`, approvalsSchema),
    enabled
  })
}

export function useProvenance(revisionId: string | null) {
  const { apiPrefix } = useOperationsRuntime()
  return useQuery({
    queryKey: [apiPrefix, 'provenance', revisionId],
    queryFn: () =>
      getJson(
        `${apiPrefix}/revisions/${encodeURIComponent(revisionId ?? '')}/provenance`,
        provenanceSchema,
      ),
    enabled: Boolean(revisionId)
  })
}
