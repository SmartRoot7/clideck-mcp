import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import {
  createBrotliDecompress,
  createGunzip,
  createInflate
} from 'node:zlib'

import { networkDomainPack } from '@clideck/domain-network'
import { CorePolicyError } from '@clideck/domain-kit'
import { z } from 'zod'

import type { AppConfig } from '../config.js'
import { sha256Label } from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import type { Logger } from '../logger.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import { safePublicLookup } from '../security/url-policy.js'
import {
  demandDiagnosisAgentArtifactSchema,
  replayDemandCoverage
} from './demand-intelligence.js'
import {
  assessKnowledgeDemandRelevance,
  isRelevantToKnowledgeDemand
} from './knowledge-demand-relevance.js'
import {
  claimMechanicalPipelineTask,
  completeMechanicalPipelineTask,
  failPipelineTask,
  pipelineCandidatePayloadSchema,
  type PipelineTaskRow
} from './pipeline.js'
import {
  createKnowledgeRevision,
  publishKnowledgeBatch
} from './publication.js'
import {
  recordPipelineTransition,
  recordPipelineTransitions
} from './pipeline-transitions.js'
import { enforceKnowledgeRisk } from './risk.js'
import { maxSourceFragmentBytes } from './pipeline-limits.js'
import { processNextReprocessItem } from './intake.js'
import {
  classifyFragmentDisposition,
  isUrlInsideCollectionScope,
  sourceKindSchema
} from './pipeline-v2.js'

const execFileAsync = promisify(execFile)
const ocrRangePages = 25
const maxOcrRangeDurationMs = 10 * 60_000

const sourcePayloadSchema = z.object({
  source_id: z.string().uuid(),
  canonical_url: z.url().startsWith('https://'),
  source_ref: z.string().optional(),
  source_kind: sourceKindSchema.optional(),
  processing_run_id: z.string().uuid().nullable().optional(),
  document_type: z.string().min(1),
  title: z.string().min(1),
  document_version: z.string().nullable().optional(),
  document_date: z.string().nullable().optional(),
  deterministic_backfill: z.boolean().optional()
})

const allowedMediaTypes = new Set([
  'application/pdf',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain'
])

type ClaimedMechanicalTask = {
  task: PipelineTaskRow
  leaseToken: string
}

async function demandQuestionForTask(
  database: Database,
  knowledgeDemandId: string | null,
): Promise<string | null> {
  if (!knowledgeDemandId) return null
  const result = await database.query<{ question: string }>(
    `SELECT question
     FROM knowledge_demands
     WHERE id = $1`,
    [knowledgeDemandId],
  )
  return result.rows[0]?.question ?? null
}

async function reconcilePublishedKnowledgeDemands(
  database: Database,
  demandIds: string[],
): Promise<void> {
  if (demandIds.length === 0) return
  const demands = await database.query<{
    id: string
    question: string
    tool_name: string
    diagnosis: unknown
  }>(
    `SELECT demand.id, demand.question, demand.tool_name,
            jsonb_build_object(
              'failure_class', diagnostic.failure_class,
              'answer_status', diagnostic.answer_status,
              'canonical_context', diagnostic.canonical_context,
              'subquestions', diagnostic.subquestions,
              'existing_coverage_summary',
                coalesce(diagnostic.existing_coverage->>'summary', 'No prior coverage summary.'),
              'missing_capabilities', diagnostic.missing_capabilities,
              'search_expansions', diagnostic.search_expansions,
              'document_roles', diagnostic.document_roles,
              'recommended_action', diagnostic.recommended_action,
              'reasoning_summary', diagnostic.reasoning_summary
            ) AS diagnosis
       FROM knowledge_demands demand
       JOIN LATERAL (
         SELECT * FROM knowledge_demand_diagnostics
          WHERE knowledge_demand_id = demand.id AND status = 'completed'
          ORDER BY created_at DESC LIMIT 1
       ) diagnostic ON true
      WHERE demand.status IN (
       'queued',
       'diagnosing',
       'discovering',
       'acquiring',
       'processing',
       'unresolved',
       'failed'
     ) AND demand.id = ANY($1::uuid[])`,
    [demandIds],
  )
  for (const demand of demands.rows) {
    const diagnosis = demandDiagnosisAgentArtifactSchema.safeParse(
      demand.diagnosis,
    )
    if (!diagnosis.success) continue
    const replay = await replayDemandCoverage(
      database,
      demand,
      diagnosis.data,
    ).catch(async () => {
      await database.query(
        `UPDATE knowledge_demands
            SET replay_status = 'failed', replayed_at = now(),
                last_error_code = 'DEMAND_REPLAY_FAILED',
                next_retry_at = now(), last_seen_at = now()
          WHERE id = $1 AND status <> 'published'`,
        [demand.id],
      )
      return null
    })
    if (!replay) continue
    await database.query(
      `UPDATE knowledge_demand_diagnostics
          SET replay_result = $2::jsonb, completed_at = now()
        WHERE id = (
          SELECT id FROM knowledge_demand_diagnostics
           WHERE knowledge_demand_id = $1
           ORDER BY created_at DESC LIMIT 1
        )`,
      [
        demand.id,
        JSON.stringify({
          answer_status: replay.answerStatus,
          coverage: replay.coverage,
          answer_refs: replay.answers.map((answer) => answer.revision_ref)
        })
      ],
    )
    const answer = replay.answers[0]
    if (replay.answerStatus !== 'complete' || !answer) {
      await database.query(
        `UPDATE knowledge_demands
            SET replay_status = $2, replayed_at = now(), last_seen_at = now()
          WHERE id = $1 AND status <> 'published'`,
        [demand.id, replay.answerStatus],
      )
      continue
    }
    await database.query(
      `UPDATE knowledge_demands demand
          SET status = 'published',
              result_revision_id = revision.id,
              result_release_id = active.release_id,
              replay_status = 'complete',
              replayed_at = now(),
              last_error_code = NULL,
              completed_at = now(),
              last_seen_at = now()
        FROM knowledge_revisions revision
        CROSS JOIN active_release active
        WHERE demand.id = $1
          AND revision.public_ref = $2
          AND demand.status <> 'published'`,
      [demand.id, answer.revision_ref],
    )
  }
}

function bufferHash(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === 'application/pdf') return '.pdf'
  if (mediaType === 'text/plain') return '.txt'
  return '.html'
}

export function isCandidatePublicationValidationError(
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : ''
  return (
    error instanceof CorePolicyError ||
    error instanceof z.ZodError ||
    message.startsWith('CANDIDATE_') ||
    message.startsWith('NETWORK_DOMAIN_CANDIDATE_INVALID')
  )
}

async function fetchPublicDocument(
  initialUrl: string,
  maxBytes: number,
): Promise<{
  body: Buffer
  mediaType: string
  finalUrl: string
}> {
  let currentUrl = initialUrl
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeProvenanceUrl(currentUrl)
    const response = await new Promise<{
      status: number
      headers: NodeJS.Dict<string | string[]>
      body: Buffer
    }>((resolvePromise, rejectPromise) => {
      const request = httpsRequest(
        currentUrl,
        {
          method: 'GET',
          agent: false,
          lookup: safePublicLookup,
          signal: AbortSignal.timeout(30_000),
          headers: {
            accept:
              'application/pdf,text/html,application/xhtml+xml,text/plain;q=0.9',
            'accept-encoding': 'br, gzip, deflate',
            'accept-language': 'en-US,en;q=0.8',
            'user-agent': 'CliDeck-MCP-Knowledge-Pipeline/0.8'
          }
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0
          const advertisedLength = Number(
            incoming.headers['content-length'] ?? '0',
          )
          if (
            Number.isFinite(advertisedLength) &&
            advertisedLength > maxBytes
          ) {
            incoming.destroy(new Error('SOURCE_TOO_LARGE'))
            return
          }
          const rawEncoding = incoming.headers['content-encoding']
          const contentEncoding = (
            Array.isArray(rawEncoding) ? rawEncoding[0] : rawEncoding
          )?.trim().toLowerCase()
          const decodedStream = contentEncoding === 'br'
            ? incoming.pipe(createBrotliDecompress())
            : contentEncoding === 'gzip'
              ? incoming.pipe(createGunzip())
              : contentEncoding === 'deflate'
                ? incoming.pipe(createInflate())
                : incoming
          if (
            contentEncoding &&
            !['br', 'gzip', 'deflate', 'identity'].includes(contentEncoding)
          ) {
            incoming.destroy(new Error('SOURCE_ENCODING_NOT_SUPPORTED'))
            return
          }
          const chunks: Buffer[] = []
          let rawReceived = 0
          let decodedReceived = 0
          incoming.on('data', (chunk: Buffer) => {
            rawReceived += chunk.byteLength
            if (rawReceived > maxBytes) {
              incoming.destroy(new Error('SOURCE_TOO_LARGE'))
            }
          })
          decodedStream.on('data', (chunk: Buffer) => {
            decodedReceived += chunk.byteLength
            if (decodedReceived > maxBytes) {
              decodedStream.destroy(new Error('SOURCE_TOO_LARGE'))
              incoming.destroy()
              return
            }
            chunks.push(Buffer.from(chunk))
          })
          decodedStream.once('end', () => {
            resolvePromise({
              status,
              headers: incoming.headers,
              body: Buffer.concat(chunks)
            })
          })
          decodedStream.once('error', rejectPromise)
          incoming.once('error', rejectPromise)
          incoming.once('aborted', () => {
            rejectPromise(new Error('SOURCE_RESPONSE_ABORTED'))
          })
        },
      )
      request.once('error', rejectPromise)
      request.end()
    })

    if (response.status >= 300 && response.status < 400) {
      const rawLocation = response.headers['location']
      const location = Array.isArray(rawLocation)
        ? rawLocation[0]
        : rawLocation
      if (!location || redirects === 5) {
        throw new Error('SOURCE_REDIRECT_INVALID')
      }
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`SOURCE_HTTP_${response.status}`)
    }

    const rawContentType = response.headers['content-type']
    const contentType = Array.isArray(rawContentType)
      ? rawContentType[0]
      : rawContentType
    const mediaType = (contentType ?? '')
      .split(';')[0]!.trim().toLowerCase()
    if (!allowedMediaTypes.has(mediaType)) {
      throw new Error('SOURCE_MIME_NOT_ALLOWED')
    }
    if (response.body.byteLength === 0) throw new Error('SOURCE_EMPTY')
    return {
      body: response.body,
      mediaType,
      finalUrl: currentUrl
    }
  }
  throw new Error('SOURCE_REDIRECT_INVALID')
}

type PublicDocumentFetcher = typeof fetchPublicDocument

async function recordMechanicalQualityCheck(
  client: DatabaseClient,
  input: {
    stage: 'convert' | 'segment' | 'normalize_deduplicate'
    profileKey: string
    processingRunId: string | null
    pipelineTaskId: string
    coverageCount: number
  },
): Promise<void> {
  const profile = await client.query<{ id: string }>(
    `INSERT INTO pipeline_quality_profiles (stage, profile_key, checked_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (stage, profile_key) DO UPDATE SET
       checked_count = pipeline_quality_profiles.checked_count + 1,
       updated_at = now()
     RETURNING id`,
    [input.stage, input.profileKey],
  )
  await client.query(
    `INSERT INTO pipeline_quality_checks (
       profile_id, processing_run_id, pipeline_task_id, stage, status,
       coverage_count, findings
     ) VALUES ($1, $2, $3, $4, 'passed', $5, '[]'::jsonb)`,
    [
      profile.rows[0]!.id,
      input.processingRunId,
      input.pipelineTaskId,
      input.stage,
      input.coverageCount
    ],
  )
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function canonicalCollectionUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:') return null
    url.hash = ''
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$|campaign$)/i.test(name)) {
        url.searchParams.delete(name)
      }
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, '/')
    return url.toString()
  } catch {
    return null
  }
}

function collectionLinks(html: string, base: string): string[] {
  const links = new Set<string>()
  const pattern = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi
  for (const match of html.matchAll(pattern)) {
    const canonical = canonicalCollectionUrl(match[1] ?? '', base)
    if (canonical) links.add(canonical)
  }
  return [...links]
}

function isVendorCollectionHost(
  hostname: string,
  vendorDomain: string,
): boolean {
  const host = hostname.toLowerCase()
  return host === vendorDomain || host.endsWith(`.${vendorDomain}`)
}

function collectionSourceTitle(url: string): string {
  const segment =
    new URL(url).pathname.split('/').filter(Boolean).at(-1) ??
    'Official vendor document'
  try {
    return decodeURIComponent(segment).slice(0, 500)
  } catch {
    return segment.slice(0, 500)
  }
}

function collectionDocumentType(url: string): string {
  const value = new URL(url).pathname.toLowerCase()
  if (/(?:command|cli)[_-]?(?:reference|ref|guide)/.test(value)) {
    return 'command_reference'
  }
  if (/(?:release|rn)[_-]?(?:note|notes)?/.test(value)) {
    return 'release_notes'
  }
  if (/(?:security|advisory|psirt|cve)/.test(value)) {
    return 'security_advisory'
  }
  if (/(?:upgrade|install)/.test(value)) return 'upgrade_guide'
  if (/(?:configuration|config)[_-]?(?:guide|reference)?/.test(value)) {
    return 'configuration_guide'
  }
  return 'official_vendor_document'
}

function isCollectionSitemap(url: string, root: string): boolean {
  try {
    const candidate = new URL(url)
    const collectionRoot = new URL(root)
    return candidate.origin === collectionRoot.origin &&
      /(?:^|\/)[^/]*sitemap[^/]*\.xml$/i.test(candidate.pathname)
  } catch {
    return false
  }
}

async function expandNextSourceCollection(
  database: Database,
  logger: Logger,
): Promise<boolean> {
  const collection = await withTransaction(database, async (client) => {
    const selected = await client.query<{
      id: string
      coverage_target_id: string | null
      canonical_url: string
      vendor_domain: string
      crawl_depth: number
      link_limit: number
      path_prefix: string
      intake_job_id: string | null
      pages_seen: number
      cursor: { queue?: Array<{ url: string; depth: number }> }
    }>(
      `SELECT
         id,
         coverage_target_id,
         canonical_url,
         vendor_domain,
         crawl_depth,
         link_limit,
         path_prefix,
         intake_job_id,
         pages_seen,
         cursor
       FROM source_collections
       WHERE (
           (status = 'active' AND next_scan_at <= now())
           OR (
             status = 'refreshing'
             AND updated_at <= now() - interval '10 minutes'
           )
         )
         AND (
           intake_job_id IS NULL OR EXISTS (
             SELECT 1 FROM intake_jobs job
              WHERE job.id = source_collections.intake_job_id
                AND job.status IN ('queued', 'running')
           )
         )
       ORDER BY next_scan_at, updated_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    )
    if (!selected.rows[0]) return null
    await client.query(
      `UPDATE source_collections
          SET status = 'refreshing',
              updated_at = now()
        WHERE id = $1`,
      [selected.rows[0].id],
    )
    return selected.rows[0]
  })
  if (!collection) return false

  const initialQueue = collection.cursor.queue?.length
    ? collection.cursor.queue
    : [
        { url: new URL('/sitemap.xml', collection.canonical_url).toString(), depth: 0 },
        { url: collection.canonical_url, depth: 0 }
      ]
  const queue = [...initialQueue]
  const seen = new Set<string>()
  const discovered = new Set<string>()
  let pages = 0
  try {
    while (
      queue.length > 0 &&
      pages < 20 &&
      collection.pages_seen + pages < collection.link_limit &&
      discovered.size < collection.link_limit
    ) {
      const current = queue.shift()!
      if (seen.has(current.url)) continue
      seen.add(current.url)
      if (!isCollectionSitemap(current.url, collection.canonical_url) &&
        !isUrlInsideCollectionScope(
        current.url,
        collection.canonical_url,
        collection.path_prefix,
        )) {
        await database.query(
          `INSERT INTO source_collection_pages (
             source_collection_id, requested_url, depth, status,
             failure_message, attempts, updated_at
           ) VALUES ($1, $2, $3, 'out_of_scope', 'Outside collection scope', 1, now())
           ON CONFLICT (source_collection_id, requested_url) DO UPDATE SET
             status = 'out_of_scope', failure_message = excluded.failure_message,
             attempts = source_collection_pages.attempts + 1, updated_at = now()`,
          [collection.id, current.url, current.depth],
        )
        continue
      }
      const prior = await database.query<{ terminal: boolean }>(
        `SELECT status IN ('accepted', 'duplicate', 'permanent_failure') AS terminal
           FROM source_collection_pages
          WHERE source_collection_id = $1 AND requested_url = $2`,
        [collection.id, current.url],
      )
      if (prior.rows[0]?.terminal) continue
      let response: Awaited<ReturnType<typeof fetchPublicDocument>>
      try {
        response = await fetchPublicDocument(current.url, 2 * 1024 * 1024)
      } catch (error) {
        pages += 1
        const message = error instanceof Error ? error.message : 'SOURCE_FETCH_FAILED'
        const status = /SOURCE_HTTP_(?:404|410)\b/.test(message)
          ? 'permanent_failure'
          : /(?:SSRF|UNSAFE|PRIVATE|REDIRECT_INVALID)/.test(message)
            ? 'unsafe'
            : 'temporary_failure'
        await database.query(
          `INSERT INTO source_collection_pages (
             source_collection_id, requested_url, depth, status,
             failure_message, attempts, available_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 1,
             CASE WHEN $4 = 'temporary_failure' THEN now() + interval '1 hour'
                  ELSE now() END, now())
           ON CONFLICT (source_collection_id, requested_url) DO UPDATE SET
             status = excluded.status, failure_message = excluded.failure_message,
             attempts = least(10, source_collection_pages.attempts + 1),
             available_at = excluded.available_at, updated_at = now()`,
          [collection.id, current.url, current.depth, status, message.slice(0, 2_000)],
        )
        continue
      }
      pages += 1
      if (!isCollectionSitemap(response.finalUrl, collection.canonical_url) &&
        !isUrlInsideCollectionScope(
        response.finalUrl,
        collection.canonical_url,
        collection.path_prefix,
        )) {
        await database.query(
          `INSERT INTO source_collection_pages (
             source_collection_id, requested_url, canonical_url, depth,
             status, failure_message, attempts, updated_at
           ) VALUES ($1, $2, $3, $4, 'out_of_scope',
             'Canonical redirect escaped collection scope', 1, now())
           ON CONFLICT (source_collection_id, requested_url) DO UPDATE SET
             canonical_url = excluded.canonical_url, status = 'out_of_scope',
             failure_message = excluded.failure_message,
             attempts = source_collection_pages.attempts + 1, updated_at = now()`,
          [collection.id, current.url, response.finalUrl, current.depth],
        )
        continue
      }
      const contentHash = bufferHash(response.body)
      const duplicateContent = await database.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM source_collection_pages
            WHERE source_collection_id = $1 AND content_hash = $2
         ) AS exists`,
        [collection.id, contentHash],
      )
      await database.query(
        `INSERT INTO source_collection_pages (
           source_collection_id, requested_url, canonical_url, depth, status,
           media_type, content_hash, attempts, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now())
         ON CONFLICT (source_collection_id, requested_url) DO UPDATE SET
           canonical_url = excluded.canonical_url,
           status = excluded.status,
           media_type = excluded.media_type,
           content_hash = excluded.content_hash,
           attempts = source_collection_pages.attempts + 1,
           updated_at = now()`,
        [
          collection.id,
          current.url,
          response.finalUrl,
          current.depth,
          duplicateContent.rows[0]?.exists ? 'duplicate' : 'accepted',
          response.mediaType,
          contentHash
        ],
      )
      if (duplicateContent.rows[0]?.exists) continue
      if (
        response.mediaType !== 'text/html' &&
        response.mediaType !== 'application/xhtml+xml' &&
        response.mediaType !== 'application/xml' &&
        response.mediaType !== 'text/xml'
      ) {
        discovered.add(response.finalUrl)
        continue
      }
      if (response.mediaType.includes('xml')) {
        for (const match of response.body.toString('utf8').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
          const next = canonicalCollectionUrl(match[1] ?? '', response.finalUrl)
          if (next && (
            isCollectionSitemap(next, collection.canonical_url) ||
            isUrlInsideCollectionScope(next, collection.canonical_url, collection.path_prefix)
          )) {
            queue.push({ url: next, depth: current.depth })
          }
        }
        continue
      }
      discovered.add(response.finalUrl)
      for (const link of collectionLinks(
        response.body.toString('utf8'),
        response.finalUrl,
      )) {
        if (!isUrlInsideCollectionScope(
          link,
          collection.canonical_url,
          collection.path_prefix,
        )) {
          continue
        }
        discovered.add(link)
        if (
          current.depth < collection.crawl_depth &&
          !seen.has(link) &&
          queue.length < collection.link_limit
        ) {
          queue.push({ url: link, depth: current.depth + 1 })
        }
        if (discovered.size >= collection.link_limit) break
      }
    }

    let inserted = 0
    let duplicates = 0
    await withTransaction(database, async (client) => {
      for (const url of discovered) {
        const result = await client.query<{ id: string }>(
          `INSERT INTO source_candidates (
             coverage_target_id,
             canonical_url,
             document_type,
             title,
             status,
             discovered_by, source_kind, source_ref, display_locator
           )
           VALUES (
             $1, $2, $3, $4, 'approved',
             'deterministic-source-collection', $5,
             $6, $2
           )
           ON CONFLICT (canonical_url) DO NOTHING
           RETURNING id`,
          [
            collection.coverage_target_id,
            url,
            collectionDocumentType(url),
            collectionSourceTitle(url),
            collection.intake_job_id ? 'admin_web' : 'official_web',
            `src_${randomUUID().replaceAll('-', '')}`
          ],
        )
        if (result.rows[0]) inserted += 1
        else duplicates += 1
      }
      const remaining = queue.slice(0, collection.link_limit)
      await client.query(
        `UPDATE source_collections
            SET status = 'active',
                cursor = $2::jsonb,
                last_scanned_at = now(),
                next_scan_at = CASE
                  WHEN jsonb_array_length($2::jsonb->'queue') > 0
                  THEN now()
                  WHEN $3 > 0 THEN now() + interval '7 days'
                  WHEN consecutive_empty_scans = 0
                  THEN now() + interval '24 hours'
                  ELSE now() + interval '3 days'
                END,
                consecutive_empty_scans = CASE
                  WHEN $3 > 0 THEN 0
                  ELSE least(100, consecutive_empty_scans + 1)
                END,
                unique_yield = unique_yield + $3,
                duplicates_avoided = duplicates_avoided + $4,
                pages_seen = pages_seen + $5,
                pages_accepted = pages_accepted + $3,
                checkpoint_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [
          collection.id,
          JSON.stringify({ queue: remaining }),
          inserted,
          duplicates,
          pages
        ],
      )
      if (collection.intake_job_id) {
        await client.query(
          `UPDATE intake_jobs
              SET status = CASE WHEN jsonb_array_length($2::jsonb->'queue') > 0
                                THEN 'running' ELSE 'completed' END,
                  configuration = configuration || jsonb_build_object(
                    'current_stage', CASE
                      WHEN jsonb_array_length($2::jsonb->'queue') > 0
                      THEN 'crawl' ELSE 'completed' END
                  ),
                  counters = counters || jsonb_build_object(
                    'pages', coalesce((counters->>'pages')::int, 0) + $5::int,
                    'sources', coalesce((counters->>'sources')::int, 0) + $3::int,
                    'duplicates', coalesce((counters->>'duplicates')::int, 0) + $4::int
                  ),
                  started_at = coalesce(started_at, now()),
                  completed_at = CASE
                    WHEN jsonb_array_length($2::jsonb->'queue') = 0 THEN now()
                    ELSE NULL END,
                  updated_at = now()
            WHERE id = $1`,
          [
            collection.intake_job_id,
            JSON.stringify({ queue: remaining }),
            inserted,
            duplicates,
            pages
          ],
        )
      }
    })
    logger.info(
      {
        collectionId: collection.id,
        pages,
        inserted,
        duplicates
      },
      'Expanded official source collection deterministically',
    )
    return true
  } catch (error) {
    await database.query(
      `UPDATE source_collections
          SET status = 'active',
              next_scan_at = now() + interval '24 hours',
              consecutive_empty_scans =
                least(100, consecutive_empty_scans + 1),
              updated_at = now()
        WHERE id = $1`,
      [collection.id],
    )
    logger.warn(
      { err: error, collectionId: collection.id },
      'Official source collection expansion was deferred',
    )
    return true
  }
}

async function ocrPdfPages(
  pdfPath: string,
  selectedPages?: number[],
): Promise<{ text: string; pageCount: number | null }> {
  const info = await execFileAsync('pdfinfo', [pdfPath], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  })
  const match = /^Pages:\s+(\d+)$/im.exec(info.stdout)
  const pageCount = match?.[1] ? Number(match[1]) : null
  if (!pageCount) {
    return { text: '', pageCount }
  }
  const scratch = await mkdtemp(join(tmpdir(), 'clideck-mcp-ocr-'))
  const pages: string[] = []
  const requestedPages = selectedPages?.length
    ? [...new Set(selectedPages)].filter((page) => page >= 1 && page <= pageCount)
    : Array.from({ length: pageCount }, (_, index) => index + 1)
  try {
    for (let offset = 0; offset < requestedPages.length; offset += ocrRangePages) {
      const range = requestedPages.slice(offset, offset + ocrRangePages)
      const deadline = Date.now() + maxOcrRangeDurationMs
      for (const page of range) {
        if (Date.now() >= deadline) throw new Error('SOURCE_OCR_RANGE_TIME_LIMIT')
        const prefix = join(scratch, `page-${page}`)
        try {
          await execFileAsync(
            'pdftoppm',
            ['-f', String(page), '-l', String(page), '-png', '-singlefile',
              '-r', '180', pdfPath, prefix],
            { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
          )
          const ocr = await execFileAsync(
            'tesseract',
            [`${prefix}.png`, 'stdout', '--dpi', '180'],
            { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
          )
          if (ocr.stdout.trim()) {
            pages.push(`\n[Page ${page}]\n${ocr.stdout.trim()}`)
          }
        } catch {
          pages.push(`\n[Page ${page} unreadable; targeted retry required]\n`)
        }
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  return { text: pages.join('\n'), pageCount }
}

async function convertArtifact(
  sourcePath: string,
  mediaType: string,
): Promise<{ text: string; pageCount: number | null }> {
  if (mediaType === 'text/plain') {
    return {
      text: (await readFile(sourcePath, 'utf8')).replace(/\u0000/g, ''),
      pageCount: null
    }
  }
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
    return {
      text: htmlToText(await readFile(sourcePath, 'utf8')),
      pageCount: null
    }
  }
  if (mediaType !== 'application/pdf') {
    throw new Error('SOURCE_MIME_NOT_ALLOWED')
  }

  const outputPath = `${sourcePath}.pdftotext`
  try {
    await execFileAsync('pdftotext', ['-layout', sourcePath, outputPath], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    })
    const extracted = (await readFile(outputPath, 'utf8'))
      .replace(/\u0000/g, '')
      .trim()
    const info = await execFileAsync('pdfinfo', [sourcePath], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    }).catch(() => null)
    const pageMatch = info
      ? /^Pages:\s+(\d+)$/im.exec(info.stdout)
      : null
    const pageCount = pageMatch?.[1] ? Number(pageMatch[1]) : null
    if (extracted.length >= 200) {
      const pageTexts = extracted.split('\f')
      const weakPages = pageTexts.flatMap((page, index) =>
        page.replace(/\s+/g, '').length < 40 ? [index + 1] : [],
      )
      if (pageCount && weakPages.length > 0) {
        const ocr = await ocrPdfPages(sourcePath, weakPages)
        const ocrByPage = new Map<number, string>()
        for (const match of ocr.text.matchAll(
          /\[Page (\d+)(?: unreadable; targeted retry required)?\]\n([\s\S]*?)(?=\n\[Page \d+|$)/g,
        )) {
          ocrByPage.set(Number(match[1]), match[0].trim())
        }
        const merged = pageTexts.map((page, index) => {
          const pageNumber = index + 1
          const text = page.trim()
          return text.replace(/\s+/g, '').length >= 40
            ? `[Page ${pageNumber}]\n${text}`
            : ocrByPage.get(pageNumber) ??
              `[Page ${pageNumber} unreadable; targeted retry required]`
        }).join('\n\f\n')
        return { text: merged, pageCount }
      }
      return { text: extracted, pageCount }
    }
  } finally {
    await unlink(outputPath).catch(() => undefined)
  }
  return ocrPdfPages(sourcePath)
}

type TextFragment = {
  ordinal: number
  sectionTitle: string | null
  sourceLocator: string | null
  content: string
  contentHash: string
}

function splitOversizedText(text: string, maxBytes: number): string[] {
  const pieces: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) {
      cursor += 1
    }
    if (cursor >= text.length) break

    let end = cursor
    let bytes = 0
    let exceeded = false
    while (end < text.length) {
      const codePoint = text.codePointAt(end)
      if (codePoint === undefined) break
      const codeUnits = codePoint > 0xffff ? 2 : 1
      const codePointBytes =
        codePoint <= 0x7f
          ? 1
          : codePoint <= 0x7ff
            ? 2
            : codePoint <= 0xffff
              ? 3
              : 4
      if (bytes + codePointBytes > maxBytes) {
        exceeded = true
        break
      }
      bytes += codePointBytes
      end += codeUnits
    }

    if (!exceeded) {
      const finalPiece = text.slice(cursor).trim()
      if (finalPiece) pieces.push(finalPiece)
      break
    }
    const boundary = Math.max(
      text.lastIndexOf('\n', end),
      text.lastIndexOf(' ', end),
    )
    if (boundary > cursor + (end - cursor) / 2) end = boundary
    const piece = text.slice(cursor, end).trim()
    if (piece) pieces.push(piece)
    cursor = end
  }
  return pieces
}

function isLikelyTableOfContentsPage(page: string): boolean {
  const lines = page
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 4) return false

  const dottedEntries = lines.filter((line) =>
    /\.{5,}\s*(?:\d+|[ivxlcdm]+)\s*$/i.test(line),
  ).length
  const hasContentsHeading = lines
    .slice(0, 20)
    .some((line) => /^(?:table of )?contents?(?:\s|$)/i.test(line))

  return (
    (hasContentsHeading && dottedEntries >= 3) ||
    (dottedEntries >= 6 && dottedEntries * 8 >= lines.length)
  )
}

function normalizeSourcePages(text: string): string {
  const normalized = text.replace(/\r/g, '')
  if (!normalized.includes('\f')) return normalized

  return normalized.split('\f')
    .map((page, index) => {
      const content = page.trim()
      if (!content) return ''
      return `[Page ${index + 1}]\n${content}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export function chunkSourceText(text: string): TextFragment[] {
  const maxBytes = maxSourceFragmentBytes
  const blocks = normalizeSourcePages(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => splitOversizedText(block, maxBytes))

  const fragments: TextFragment[] = []
  const seenContentHashes = new Set<string>()
  let sectionTitle: string | null = null
  let current: string[] = []
  let currentBytes = 0

  const flush = () => {
    const content = current.join('\n\n').trim()
    current = []
    currentBytes = 0
    if (!content) return
    const contentHash = bufferHash(Buffer.from(content, 'utf8'))
    if (seenContentHashes.has(contentHash)) return
    seenContentHashes.add(contentHash)
    fragments.push({
      ordinal: fragments.length,
      sectionTitle,
      sourceLocator: sectionTitle,
      content,
      contentHash
    })
  }

  for (const block of blocks) {
    const isHeading =
      block.length <= 180 &&
      !block.includes('\n') &&
      (
        /^[A-Z0-9][A-Z0-9 /:_.()-]{5,}$/.test(block) ||
        /^\d+(?:\.\d+)*\s+\S/.test(block)
      )
    if (isHeading) {
      flush()
      sectionTitle = block
      continue
    }
    const blockBytes = Buffer.byteLength(block, 'utf8')
    if (currentBytes > 0 && currentBytes + blockBytes + 2 > maxBytes) {
      flush()
    }
    current.push(block)
    currentBytes += blockBytes + 2
  }
  flush()
  return fragments
}

async function markSourceCandidateDuplicate(
  client: DatabaseClient,
  sourceId: string,
): Promise<void> {
  await client.query(
    `UPDATE source_candidates
        SET status = 'duplicate',
            content_hash = NULL,
            failure_code = NULL,
            failure_message = NULL,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [sourceId],
  )
  await client.query(
    `DELETE FROM active_source_slots
      WHERE source_candidate_id = $1`,
    [sourceId],
  )
  await client.query(
    `UPDATE pipeline_settings
        SET active_source_id = (
              SELECT source_candidate_id
              FROM active_source_slots
              ORDER BY slot_number
              LIMIT 1
            ),
            updated_at = now(),
            updated_by = 'duplicate-detector'
      WHERE singleton AND active_source_id = $1`,
    [sourceId],
  )
}

async function acquireSource(
  database: Database,
  config: AppConfig,
  claimed: ClaimedMechanicalTask,
  fetchDocument: PublicDocumentFetcher = fetchPublicDocument,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const downloaded = await fetchDocument(
    payload.canonical_url,
    config.sourceMaxBytes,
  )
  const contentHash = bufferHash(downloaded.body)
  const storageRoot = resolve(config.sourceStorageDir)
  await mkdir(storageRoot, { recursive: true, mode: 0o750 })
  const finalPath = join(
    storageRoot,
    `${payload.source_id}-${contentHash.slice(-16)}${extensionForMediaType(downloaded.mediaType)}`,
  )
  const tempPath = join(storageRoot, `.${payload.source_id}.${randomUUID()}.tmp`)
  await writeFile(tempPath, downloaded.body, { mode: 0o640 })
  await rename(tempPath, finalPath)

  let outcome: { duplicate: boolean; [key: string]: unknown }
  try {
    outcome = await withTransaction(database, async (client) => {
      // A collection link can redirect to a canonical document that another
      // source already owns. This is a normal duplicate, not a mechanical
      // failure: trying to update the candidate URL after storing the artifact
      // would otherwise violate source_candidates_canonical_url_key and waste
      // a retry slot.
      const canonicalDuplicate = await client.query<{ id: string }>(
        `SELECT id
         FROM source_candidates
         WHERE canonical_url = $1
           AND id <> $2
         LIMIT 1
         FOR UPDATE`,
        [downloaded.finalUrl, payload.source_id],
      )
      if (canonicalDuplicate.rows[0]) {
        await markSourceCandidateDuplicate(
          client,
          payload.source_id,
        )
        return {
          duplicate: true,
          duplicate_of: canonicalDuplicate.rows[0].id,
          duplicate_reason: 'canonical_url_redirect',
          content_hash: contentHash
        }
      }
      const artifact = await client.query<{ id: string }>(
        `INSERT INTO source_artifacts (
         source_candidate_id,
         media_type,
         byte_size,
         content_hash,
         storage_path,
         purge_after
       )
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (source_candidate_id, content_hash)
       DO UPDATE SET
         media_type = excluded.media_type,
         byte_size = excluded.byte_size,
         content_hash = excluded.content_hash,
         storage_path = excluded.storage_path,
         status = 'downloaded',
         purge_after = NULL,
         updated_at = now()
       RETURNING id`,
        [
          payload.source_id,
          downloaded.mediaType,
          downloaded.body.byteLength,
          contentHash,
          finalPath
        ],
      )
      const version = `pipeline-v2-${contentHash.slice(-16)}`
      const run = await client.query<{ id: string }>(
        `INSERT INTO source_processing_runs (
           source_candidate_id, source_artifact_id, processing_version,
           converter_version, segmenter_version, extractor_version,
           prompt_version, model_profile, status, started_at
         ) VALUES (
           $1, $2, $3, 'pipeline-v2-convert-1', 'pipeline-v2-segment-1',
           'pipeline-v2-extract-1', 'pipeline-v2-fidelity-1',
           'gpt-5.6-luna-low', 'converting', now()
         )
         ON CONFLICT (source_candidate_id, processing_version)
         DO UPDATE SET source_artifact_id = excluded.source_artifact_id,
                       status = 'converting', updated_at = now()
         RETURNING id`,
        [payload.source_id, artifact.rows[0]!.id, version],
      )
      await client.query(
        `UPDATE pipeline_tasks
            SET processing_run_id = $2,
                payload = jsonb_set(
                  payload,
                  '{processing_run_id}',
                  to_jsonb($2::text),
                  true
                ),
                updated_at = now()
          WHERE id = $1`,
        [claimed.task.id, run.rows[0]!.id],
      )
      await client.query(
        `UPDATE source_candidates
          SET canonical_url = $2,
              status = 'acquired',
              content_hash = $3,
              failure_code = NULL,
              failure_message = NULL,
              updated_at = now()
        WHERE id = $1`,
        [payload.source_id, downloaded.finalUrl, contentHash],
      )
      await recordPipelineTransition(client, {
        scope: 'source',
        fromStage: 'acquire',
        toStage: 'downloaded',
        count: 1,
        kind: 'progress',
        taskId: claimed.task.id
      })
      return {
        duplicate: false,
        byte_size: downloaded.body.byteLength,
        media_type: downloaded.mediaType,
        content_hash: contentHash,
        processing_run_id: run.rows[0]!.id
      }
    })
  } catch (error) {
    await unlink(finalPath).catch(() => undefined)
    throw error
  }

  if (outcome.duplicate) {
    await unlink(finalPath).catch(() => undefined)
  }
  return outcome
}

async function convertSource(
  database: Database,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const artifact = await database.query<{
    id: string
    storage_path: string
    media_type: string
    processing_run_id: string
  }>(
    `SELECT artifact.id, artifact.storage_path, artifact.media_type,
            run.id AS processing_run_id
     FROM source_processing_runs run
     JOIN source_artifacts artifact ON artifact.id = run.source_artifact_id
     WHERE run.source_candidate_id = $1
       AND ($2::uuid IS NULL OR run.id = $2)
     ORDER BY run.created_at DESC
     LIMIT 1`,
    [payload.source_id, payload.processing_run_id ?? null],
  )
  const row = artifact.rows[0]
  if (!row) throw new Error('SOURCE_ARTIFACT_NOT_FOUND')
  const converted = await convertArtifact(row.storage_path, row.media_type)
  const text = converted.text.trim()
  if (!text) throw new Error('SOURCE_CONVERSION_EMPTY')
  const textPath = `${row.storage_path}.txt`
  const tempPath = `${textPath}.${randomUUID()}.tmp`
  await writeFile(tempPath, text, { mode: 0o640 })
  await rename(tempPath, textPath)
  await withTransaction(database, async (client) => {
    await client.query(
      `UPDATE source_artifacts
          SET extracted_text_path = $2,
              page_count = $3,
              status = 'converted',
              converted_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [row.id, textPath, converted.pageCount],
    )
    await client.query(
      `UPDATE source_candidates
          SET status = 'converted',
              updated_at = now()
        WHERE id = $1`,
      [payload.source_id],
    )
    if (payload.processing_run_id) {
      await client.query(
        `UPDATE source_processing_runs
            SET status = 'segmenting',
                source_artifact_id = $2,
                converted_output_path = $3,
                page_count = $4,
                next_page = coalesce($4, 1),
                counters = counters || jsonb_build_object(
                  'converted_bytes', $5::int,
                  'page_count', coalesce($4::int, 0)
                ),
                updated_at = now()
          WHERE id = $1`,
        [
          payload.processing_run_id,
          row.id,
          textPath,
          converted.pageCount,
          Buffer.byteLength(text, 'utf8')
        ],
      )
    }
    await recordMechanicalQualityCheck(client, {
      stage: 'convert',
      profileKey: 'pipeline-v2-convert-1',
      processingRunId: row.processing_run_id,
      pipelineTaskId: claimed.task.id,
      coverageCount: converted.pageCount ?? 1
    })
    await recordPipelineTransition(client, {
      scope: 'source',
      fromStage: 'downloaded',
      toStage: 'convert',
      count: 1,
      kind: 'progress',
      taskId: claimed.task.id
    })
  })
  return {
    extracted_bytes: Buffer.byteLength(text, 'utf8'),
    page_count: converted.pageCount,
    converter: row.media_type === 'application/pdf'
      ? 'pdftotext_with_local_ocr_fallback'
      : 'deterministic_text'
  }
}

async function chunkSource(
  database: Database,
  config: AppConfig,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const artifact = await database.query<{
    id: string
    extracted_text_path: string | null
    processing_run_id: string
  }>(
    `SELECT artifact.id, artifact.extracted_text_path, run.id AS processing_run_id
     FROM source_processing_runs run
     JOIN source_artifacts artifact ON artifact.id = run.source_artifact_id
     WHERE run.source_candidate_id = $1
       AND ($2::uuid IS NULL OR run.id = $2)
     ORDER BY run.created_at DESC
     LIMIT 1`,
    [payload.source_id, payload.processing_run_id ?? null],
  )
  const row = artifact.rows[0]
  if (!row?.extracted_text_path) throw new Error('SOURCE_TEXT_NOT_FOUND')
  const fragments = chunkSourceText(
    await readFile(row.extracted_text_path, 'utf8'),
  )
  if (fragments.length === 0) throw new Error('SOURCE_CHUNKING_EMPTY')

  await withTransaction(database, async (client) => {
    for (const fragment of fragments) {
      const disposition = classifyFragmentDisposition(fragment.content)
      await client.query(
        `INSERT INTO source_fragments (
           source_artifact_id,
           processing_run_id,
           ordinal,
           section_title,
           source_locator,
           content,
           content_hash,
           status,
           disposition,
           disposition_reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (processing_run_id, ordinal) DO NOTHING`,
        [
          row.id,
          row.processing_run_id,
          fragment.ordinal,
          fragment.sectionTitle,
          fragment.sourceLocator,
          fragment.content,
          fragment.contentHash,
          disposition?.disposition === 'non_knowledge' ? 'analyzed' : 'queued',
          disposition?.disposition ?? null,
          disposition?.reason ?? null
        ],
      )
    }
    await client.query(
      `UPDATE source_artifacts
          SET status = 'chunked',
              updated_at = now()
        WHERE id = $1`,
      [row.id],
    )
    await client.query(
      `UPDATE source_processing_runs
          SET status = 'extracting',
              counters = counters || jsonb_build_object(
                'fragments_total', $2::int,
                'fragments_non_knowledge', $3::int
              ),
              updated_at = now()
        WHERE id = $1`,
      [
        row.processing_run_id,
        fragments.length,
        fragments.filter((fragment) =>
          classifyFragmentDisposition(fragment.content)?.disposition ===
            'non_knowledge'
        ).length
      ],
    )
    await recordMechanicalQualityCheck(client, {
      stage: 'segment',
      profileKey: 'pipeline-v2-segment-1',
      processingRunId: row.processing_run_id,
      pipelineTaskId: claimed.task.id,
      coverageCount: fragments.length
    })
    await recordPipelineTransition(client, {
      scope: 'source',
      fromStage: 'convert',
      toStage: 'chunk',
      count: 1,
      kind: 'progress',
      taskId: claimed.task.id
    })
  })
  const fastPath = await runDeterministicFastPath(
    database,
    config,
    claimed.task,
    row.id,
    payload,
  )
  await withTransaction(database, async (client) => {
    await client.query(
      `UPDATE source_candidates
          SET status = 'prepared',
              failure_code = NULL,
              failure_message = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'chunking'`,
      [payload.source_id],
    )
    await recordPipelineTransition(client, {
      scope: 'source',
      fromStage: 'chunk',
      toStage: 'analyze',
      count: fragments.length,
      kind: 'progress',
      taskId: claimed.task.id
    })
  })
  return {
    fragments_created: fragments.length,
    fragment_bytes: fragments.reduce(
      (total, fragment) =>
        total + Buffer.byteLength(fragment.content, 'utf8'),
      0,
    ),
    deterministic_candidates_created: fastPath.candidatesCreated,
    deterministic_fragments_handled: fastPath.fragmentsHandled
  }
}

export function deterministicCandidateInitialStatus(input: {
  readyForPublication: boolean
  dangerous: boolean
  confidence: number
  qualityScore: number
  autoPublishConfidence: number
}): 'analyzed' | 'verified' {
  // Source-backed deterministic records publish immediately. Fidelity QA is
  // an observer/repair loop and confidence/risk are retained only as signals.
  return input.readyForPublication ? 'verified' : 'analyzed'
}

export function deterministicCandidateEligibleForFastPath(input: {
  fragmentFullyHandled: boolean
  readyForPublication: boolean
}): boolean {
  return input.fragmentFullyHandled || input.readyForPublication
}

async function ensureDeterministicCoverageContext(
  database: Database,
  target: {
    vendor_slug: string
    operating_system_slug: string
  },
): Promise<void> {
  await database.query(
    'SELECT ensure_deterministic_coverage_context($1, $2)',
    [target.vendor_slug, target.operating_system_slug],
  )
}

async function runDeterministicFastPath(
  database: Database,
  config: AppConfig,
  task: PipelineTaskRow,
  artifactId: string,
  source: z.infer<typeof sourcePayloadSchema>,
): Promise<{ candidatesCreated: number; fragmentsHandled: number }> {
  const extractor = networkDomainPack.deterministicExtractor
  if (!extractor) return { candidatesCreated: 0, fragmentsHandled: 0 }

  const context = await database.query<{
    vendor_slug: string
    operating_system_slug: string
    model: string | null
    version_branch: string | null
  }>(
    `SELECT
       ct.vendor_slug,
       ct.operating_system_slug,
       ct.model,
       ct.version_branch
     FROM coverage_targets ct
     WHERE ct.id = $1`,
    [task.coverage_target_id],
  )
  const target = context.rows[0]
  if (!target) return { candidatesCreated: 0, fragmentsHandled: 0 }

  const inputSource = {
    canonical_url: source.canonical_url,
    document_type: source.document_type,
    title: source.title,
    document_version: source.document_version ?? null,
    document_date: source.document_date ?? null
  }
  const extractionContext = {
    vendor_slug: target.vendor_slug,
    operating_system_slug: target.operating_system_slug,
    platform_slug: null,
    version_min: null,
    version_max: null
  }
  const verifiedAt = new Date().toISOString().slice(0, 10)
  const supportProbe = {
    fragments: [],
    source: inputSource,
    context: extractionContext,
    verified_at: verifiedAt
  }
  if (!extractor.supports(supportProbe)) {
    return { candidatesCreated: 0, fragmentsHandled: 0 }
  }
  let candidatesCreated = 0
  let contextEnsured = false
  const handled = new Set<string>()
  let lastOrdinal = -1
  for (;;) {
    const fragments = await database.query<{
      id: string
      ordinal: number
      section_title: string | null
      source_locator: string | null
      content: string
      content_hash: string
      processing_run_id: string | null
    }>(
      `SELECT
         id, ordinal, section_title, source_locator, content, content_hash,
         processing_run_id
       FROM source_fragments
       WHERE source_artifact_id = $1
         AND ($4::boolean OR status = 'queued')
         AND ordinal > $2
       ORDER BY ordinal
       LIMIT $3`,
      [
        artifactId,
        lastOrdinal,
        extractor.max_fragments_per_batch,
        source.deterministic_backfill === true
      ],
    )
    if (fragments.rows.length === 0) break
    const fragmentRunIds = new Map(
      fragments.rows.map((fragment) => [
        fragment.id,
        fragment.processing_run_id
      ]),
    )
    lastOrdinal = fragments.rows.at(-1)?.ordinal ?? lastOrdinal
    const result = extractor.extract({
      fragments: fragments.rows,
      source: inputSource,
      context: extractionContext,
      verified_at: verifiedAt
    })
    const fullyHandledFragments = new Set(result.handled_fragment_ids)
    if (!contextEnsured && source.canonical_url.startsWith('https://')) {
      const hasValidatedCandidate = result.candidates.some((entry) => {
        if (!deterministicCandidateEligibleForFastPath({
          fragmentFullyHandled: fullyHandledFragments.has(entry.fragment_id),
          readyForPublication: entry.ready_for_publication === true
        })) return false
        const parsed = networkDomainPack.candidateSchema.safeParse(
          entry.candidate,
        )
        return parsed.success &&
          networkDomainPack.validateCandidate(parsed.data).valid
      })
      if (hasValidatedCandidate) {
        // Coverage targets can be newer than the static catalog seed. Register
        // the exact context only after an acquired HTTPS document has yielded
        // a schema-valid deterministic candidate. Otherwise publication sends
        // valid records to an AI review that cannot repair missing catalog data.
        await ensureDeterministicCoverageContext(database, target)
        contextEnsured = true
      }
    }
    const demandRelevantFragments = new Set<string>()
    await withTransaction(database, async (client) => {
      let batchCandidatesReady = 0
      let batchCandidatesForVerification = 0
      for (const entry of result.candidates) {
        if (!deterministicCandidateEligibleForFastPath({
          fragmentFullyHandled: fullyHandledFragments.has(entry.fragment_id),
          readyForPublication: entry.ready_for_publication === true
        })) continue
        const parsed = networkDomainPack.candidateSchema.parse(
          entry.candidate,
        )
        const validation = networkDomainPack.validateCandidate(parsed)
        if (!validation.valid) continue
        const candidate = enforceKnowledgeRisk(
          pipelineCandidatePayloadSchema.parse(parsed),
        )
        demandRelevantFragments.add(entry.fragment_id)
        const serialized = JSON.stringify(candidate)
        const candidateStatus = deterministicCandidateInitialStatus({
          readyForPublication: entry.ready_for_publication === true,
          dangerous: candidate.dangerous,
          confidence: candidate.confidence,
          qualityScore: candidate.quality_score,
          autoPublishConfidence: config.autoPublishConfidence
        })
        const inserted = await client.query<{
          id: string
          status: 'analyzed' | 'verified'
          inserted: boolean
          processing_run_id: string | null
        }>(
          `INSERT INTO knowledge_candidates (
             pipeline_task_id,
             source_fragment_id,
             processing_run_id,
             stable_key,
             payload,
             content_hash,
             status,
             dangerous,
             confidence,
             quality_score
           )
           SELECT $1, $2, fragment.processing_run_id, $3, $4::jsonb,
                  $5, $6, $7, $8, $9
             FROM source_fragments fragment
            WHERE fragment.id = $2
           ON CONFLICT (content_hash) DO UPDATE SET
             updated_at = knowledge_candidates.updated_at
           RETURNING id, status, (xmax = 0) AS inserted, processing_run_id`,
          [
            task.id,
            entry.fragment_id,
            candidate.stable_key,
            serialized,
            sha256Label(serialized),
            candidateStatus,
            candidate.dangerous,
            candidate.confidence,
            candidate.quality_score
          ],
        )
        if (inserted.rows[0]) {
          await client.query(
            `INSERT INTO knowledge_candidate_occurrences (
               knowledge_candidate_id, processing_run_id, source_fragment_id,
               occurrence_kind, content_hash
             ) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [
              inserted.rows[0].id,
              fragmentRunIds.get(entry.fragment_id),
              entry.fragment_id,
              inserted.rows[0].inserted ? 'created' : 'exact_duplicate',
              sha256Label(serialized)
            ],
          )
          if (inserted.rows[0].status === 'verified') {
            batchCandidatesReady += 1
          } else {
            batchCandidatesForVerification += 1
          }
          if (inserted.rows[0].inserted) candidatesCreated += 1
        }
      }
      const handledFragmentIds = result.handled_fragment_ids
      if (handledFragmentIds.length > 0) {
        await client.query(
          `UPDATE source_fragments
              SET status = CASE
                    WHEN EXISTS (
                      SELECT 1
                      FROM knowledge_candidates candidate
                      WHERE candidate.pipeline_task_id = $3
                        AND candidate.source_fragment_id = source_fragments.id
                        AND candidate.status = 'analyzed'
                    ) THEN 'analyzed'
                    ELSE 'verified'
                  END,
                  disposition = CASE
                    WHEN id = ANY($4::uuid[]) THEN 'knowledge_extracted'
                    ELSE coalesce(disposition, 'targeted_retry')
                  END,
                  disposition_reason = CASE
                    WHEN id = ANY($4::uuid[]) THEN 'knowledge_extracted'
                    ELSE coalesce(disposition_reason, 'targeted_retry')
                  END,
                  updated_at = now()
            WHERE id = ANY($1::uuid[])
              AND source_artifact_id = $2
              AND status = 'queued'`,
          [
            handledFragmentIds,
            artifactId,
            task.id,
            [...demandRelevantFragments]
          ],
        )
      }
      await recordPipelineTransitions(client, [
        {
          scope: 'record',
          fromStage: 'analyze',
          toStage: 'ready',
          count: batchCandidatesReady,
          kind: 'progress',
          taskId: task.id,
          dedupeSuffix: `deterministic-fast-path:${lastOrdinal}:ready`
        },
        {
          scope: 'record',
          fromStage: 'analyze',
          toStage: 'verify',
          count: batchCandidatesForVerification,
          kind: 'progress',
          taskId: task.id,
          dedupeSuffix: `deterministic-fast-path:${lastOrdinal}:verify`
        }
      ])
    })
    const handledFragmentIds = result.handled_fragment_ids
    for (const fragmentId of handledFragmentIds) {
      handled.add(fragmentId)
    }
  }
  return {
    candidatesCreated,
    fragmentsHandled: handled.size
  }
}

async function publishSource(
  database: Database,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const readySources = await database.query<{ source_candidate_id: string }>(
    `SELECT DISTINCT source_candidate_id
     FROM pipeline_tasks
     WHERE task_type = 'source_publication'
       AND status = 'queued'
       AND source_candidate_id IS NOT NULL
     ORDER BY source_candidate_id
     LIMIT 32`,
  )
  const sourceIds = [
    payload.source_id,
    ...readySources.rows.map((row) => row.source_candidate_id)
  ].filter((value, index, values) => values.indexOf(value) === index)
  const candidates = await database.query<{
    id: string
    payload: unknown
    revision_id: string | null
    knowledge_demand_id: string | null
    processing_run_id: string | null
  }>(
      `SELECT DISTINCT ON (kc.stable_key)
         kc.id,
         kc.payload,
         kc.revision_id,
         pt.knowledge_demand_id,
         kc.processing_run_id
       FROM knowledge_candidates kc
       JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
       WHERE pt.source_candidate_id = ANY($1::uuid[])
         AND kc.status = 'verified'
       ORDER BY kc.stable_key, kc.quality_score DESC, kc.created_at DESC
       LIMIT 1000`,
    [sourceIds],
  )

  const revisions: Array<{
    candidateId: string
    itemId: string
    revisionId: string
    knowledgeDemandId: string | null
    processingRunId: string | null
  }> = []
  let exceptions = 0
  for (const candidate of candidates.rows) {
    try {
      const created = await withTransaction(database, async (client) => {
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtext('clideck-mcp-candidate-publication')
           )`,
        )
        const current = await client.query<{
          revision_id: string | null
          status: string
        }>(
          `SELECT revision_id, status
           FROM knowledge_candidates
           WHERE id = $1
           FOR UPDATE`,
          [candidate.id],
        )
        if (!current.rows[0] || current.rows[0].status !== 'verified') {
          throw new Error('CANDIDATE_ALREADY_PROCESSED')
        }
        if (current.rows[0].revision_id) {
          const existing = await client.query<{
            item_id: string
            revision_id: string
          }>(
            `SELECT
               knowledge_item_id AS item_id,
               id AS revision_id
             FROM knowledge_revisions
             WHERE id = $1`,
            [current.rows[0].revision_id],
          )
          if (existing.rows[0]) {
            return {
              itemId: existing.rows[0].item_id,
              revisionId: existing.rows[0].revision_id
            }
          }
        }
        const createdRevision = await createKnowledgeRevision(
          client,
          candidate.payload,
        )
        await client.query(
          `UPDATE knowledge_candidates
              SET revision_id = $2,
                  updated_at = now()
            WHERE id = $1
              AND status = 'verified'`,
          [candidate.id, createdRevision.revisionId],
        )
        return createdRevision
      })
      revisions.push({
        candidateId: candidate.id,
        knowledgeDemandId: candidate.knowledge_demand_id,
        processingRunId: candidate.processing_run_id,
        ...created
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        message === 'CANDIDATE_ALREADY_PROCESSED'
      ) {
        continue
      }
      if (!isCandidatePublicationValidationError(error)) {
        throw error
      }
      exceptions += 1
      const policyCode =
        error instanceof CorePolicyError ? `${error.code}: ` : ''
      await database.query(
        `UPDATE knowledge_candidates
            SET status = 'deep_review',
                deep_review_task_id = NULL,
                resolution_reason = $2,
                next_review_at = now(),
                updated_at = now()
          WHERE id = $1
            AND status = 'verified'`,
        [
          candidate.id,
          `Publication preflight rejected candidate: ${policyCode}${message}`
            .slice(0, 4_000)
        ],
      )
    }
  }

  const result = await withTransaction(database, async (client) => {
    let release: { releaseId: string; sequence: number } | null = null
    if (revisions.length > 0) {
      release = await publishKnowledgeBatch(
        client,
        revisions.map(({ itemId, revisionId }) => ({ itemId, revisionId })),
        sourceIds.length > 1
          ? `Published ${sourceIds.length} ready source packages in one release window.`
          : `Published source package: ${payload.title}`,
      )
      for (const revision of revisions) {
        await client.query(
          `UPDATE knowledge_candidates
              SET status = 'published',
                  revision_id = $2,
                  updated_at = now()
            WHERE id = $1`,
          [revision.candidateId, revision.revisionId],
        )
      }
      await client.query(
        `UPDATE source_fragments sf
            SET status = 'published',
                updated_at = now()
          WHERE EXISTS (
            SELECT 1
            FROM knowledge_candidates kc
            JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
            WHERE kc.source_fragment_id = sf.id
              AND kc.status = 'published'
              AND pt.source_candidate_id = ANY($1::uuid[])
          )`,
        [sourceIds],
      )
      await client.query(
        `UPDATE agent_runs ar
            SET published_revisions = (
              SELECT count(*)::int
              FROM knowledge_candidates kc
              WHERE kc.pipeline_task_id = ar.pipeline_task_id
                AND kc.revision_id IS NOT NULL
            )
          WHERE ar.pipeline_task_id IN (
            SELECT pt.id
            FROM pipeline_tasks pt
            WHERE pt.source_candidate_id = ANY($1::uuid[])
          )`,
        [sourceIds],
      )
      for (const processingRunId of new Set(
        revisions.flatMap((revision) =>
          revision.processingRunId ? [revision.processingRunId] : [],
        ),
      )) {
        await recordMechanicalQualityCheck(client, {
          stage: 'normalize_deduplicate',
          profileKey: 'pipeline-v2-normalize-deduplicate-1',
          processingRunId,
          pipelineTaskId: claimed.task.id,
          coverageCount: revisions.filter((revision) =>
            revision.processingRunId === processingRunId
          ).length
        })
      }
    }

    const remaining = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM knowledge_candidates candidate
       JOIN pipeline_tasks task ON task.id = candidate.pipeline_task_id
       WHERE task.source_candidate_id = $1
         AND candidate.status = 'verified'`,
      [payload.source_id],
    )
    const remainingVerified = remaining.rows[0]?.count ?? 0
    await client.query(
      `UPDATE source_candidates
          SET status = CASE
                WHEN $3 > 0 THEN 'verifying'
                WHEN $2 > 0 THEN 'completed_with_exceptions'
                ELSE 'completed'
              END,
              failure_code = NULL,
              failure_message = NULL,
              completed_at = CASE WHEN $3 > 0 THEN NULL ELSE now() END,
              updated_at = now()
        WHERE id = $1`,
      [payload.source_id, exceptions, remainingVerified],
    )
    await client.query(
      `UPDATE coverage_targets ct
          SET status = 'covered',
              coverage_percent = least(
                100,
                greatest(
                  ct.coverage_percent,
                  CASE WHEN $2 > 0 THEN 25 ELSE 5 END
                )
              ),
              last_completed_at = now(),
              next_check_at = now() + interval '30 days',
              updated_at = now()
        WHERE id = $1`,
      [claimed.task.coverage_target_id, revisions.length],
    )
    if (remainingVerified === 0) {
      await client.query(
        `DELETE FROM active_source_slots
         WHERE source_candidate_id = $1`,
        [payload.source_id],
      )
      await client.query(
        `UPDATE pipeline_settings
            SET active_source_id = (
                  SELECT source_candidate_id
                  FROM active_source_slots
                  ORDER BY slot_number
                  LIMIT 1
                ),
                updated_at = now(),
                updated_by = 'source-publisher'
          WHERE singleton AND active_source_id = $1`,
        [payload.source_id],
      )
    }
    return {
      revisions_published: revisions.length,
      candidates_deferred_to_deep_review: exceptions,
      candidates_remaining_for_supplemental_package: remainingVerified,
      release_id: release?.releaseId ?? null,
      release_sequence: release?.sequence ?? null
    }
  })
  if (result.revisions_published > 0) {
    await reconcilePublishedKnowledgeDemands(database, [
      ...new Set(revisions.flatMap((revision) =>
        revision.knowledgeDemandId ? [revision.knowledgeDemandId] : [],
      ))
    ])
  }
  return result
}

const candidatePublicationPayloadSchema = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1).max(50),
  source_ids: z.array(z.string().uuid()).max(50).default([]),
  record_count: z.number().int().min(1).max(50)
})

async function publishCandidateBatch(
  database: Database,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = candidatePublicationPayloadSchema.parse(
    claimed.task.payload,
  )
  const candidates = await database.query<{
    id: string
    payload: unknown
    revision_id: string | null
    knowledge_demand_id: string | null
    processing_run_id: string | null
  }>(
    `SELECT candidate.id, candidate.payload, candidate.revision_id,
            origin.knowledge_demand_id, candidate.processing_run_id
       FROM knowledge_candidates candidate
       JOIN pipeline_tasks origin ON origin.id = candidate.pipeline_task_id
      WHERE candidate.id = ANY($1::uuid[])
        AND candidate.publication_task_id = $2
        AND candidate.status = 'verified'
      ORDER BY candidate.updated_at, candidate.created_at`,
    [payload.candidate_ids, claimed.task.id],
  )

  const revisions: Array<{
    candidateId: string
    itemId: string
    revisionId: string
    knowledgeDemandId: string | null
    processingRunId: string | null
  }> = []
  const deferred: Array<{
    candidateId: string
    reason: string
  }> = []
  for (const candidate of candidates.rows) {
    try {
      const created = await withTransaction(database, async (client) => {
        const locked = await client.query<{
          revision_id: string | null
        }>(
          `SELECT revision_id
           FROM knowledge_candidates
           WHERE id = $1
             AND status = 'verified'
             AND publication_task_id = $2
           FOR UPDATE`,
          [candidate.id, claimed.task.id],
        )
        if (!locked.rows[0]) {
          throw new Error('CANDIDATE_ALREADY_PROCESSED')
        }
        if (locked.rows[0].revision_id) {
          const existing = await client.query<{
            item_id: string
            revision_id: string
          }>(
            `SELECT
               knowledge_item_id AS item_id,
               id AS revision_id
             FROM knowledge_revisions
             WHERE id = $1`,
            [locked.rows[0].revision_id],
          )
          if (existing.rows[0]) {
            return {
              itemId: existing.rows[0].item_id,
              revisionId: existing.rows[0].revision_id
            }
          }
        }
        const createdRevision = await createKnowledgeRevision(
          client,
          candidate.payload,
        )
        await client.query(
          `UPDATE knowledge_candidates
              SET revision_id = $2,
                  updated_at = now()
            WHERE id = $1
              AND publication_task_id = $3`,
          [candidate.id, createdRevision.revisionId, claimed.task.id],
        )
        return createdRevision
      })
      revisions.push({
        candidateId: candidate.id,
        knowledgeDemandId: candidate.knowledge_demand_id,
        processingRunId: candidate.processing_run_id,
        ...created
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'CANDIDATE_ALREADY_PROCESSED') continue
      if (!isCandidatePublicationValidationError(error)) throw error
      const policyCode =
        error instanceof CorePolicyError ? `${error.code}: ` : ''
      deferred.push({
        candidateId: candidate.id,
        reason:
          `Publication preflight rejected candidate: ${policyCode}${message}`
            .slice(0, 4_000)
      })
    }
  }

  const result = await withTransaction(database, async (client) => {
    let deferredLow = 0
    let deferredMedium = 0
    for (const candidate of deferred) {
      const updated = await client.query<{ resolution_attempts: number }>(
        `UPDATE knowledge_candidates
            SET status = 'deep_review',
                publication_task_id = NULL,
                deep_review_task_id = NULL,
                resolution_code = 'publication_preflight',
                resolution_reason = $3,
                next_review_at = now(),
                updated_at = now()
          WHERE id = $1
            AND publication_task_id = $2
          RETURNING resolution_attempts`,
        [candidate.candidateId, claimed.task.id, candidate.reason],
      )
      if ((updated.rows[0]?.resolution_attempts ?? 0) > 0) {
        deferredMedium += 1
      } else if (updated.rows[0]) {
        deferredLow += 1
      }
    }
    const release = revisions.length > 0
      ? await publishKnowledgeBatch(
          client,
          revisions.map(({ itemId, revisionId }) => ({
            itemId,
            revisionId
          })),
          `Streaming publication of ${revisions.length} verified records.`,
        )
      : null
    if (revisions.length > 0) {
      await client.query(
        `UPDATE knowledge_candidates candidate
            SET status = 'published',
                revision_id = published.revision_id,
                publication_task_id = NULL,
                updated_at = now()
          FROM unnest($1::uuid[], $2::uuid[])
            AS published(candidate_id, revision_id)
          WHERE candidate.id = published.candidate_id
            AND candidate.publication_task_id = $3`,
        [
          revisions.map((revision) => revision.candidateId),
          revisions.map((revision) => revision.revisionId),
          claimed.task.id
        ],
      )
      await client.query(
        `UPDATE source_fragments fragment
            SET status = 'published',
                updated_at = now()
          WHERE EXISTS (
            SELECT 1
            FROM knowledge_candidates candidate
            WHERE candidate.source_fragment_id = fragment.id
              AND candidate.id = ANY($1::uuid[])
              AND candidate.status = 'published'
          )`,
        [revisions.map((revision) => revision.candidateId)],
      )
      await client.query(
        `UPDATE agent_runs run
            SET published_revisions = coalesce(
              (
                SELECT count(*)::int
                FROM knowledge_candidates candidate
                WHERE candidate.pipeline_task_id = run.pipeline_task_id
                  AND candidate.status = 'published'
              ),
              0
            )
          WHERE run.pipeline_task_id IN (
            SELECT candidate.pipeline_task_id
            FROM knowledge_candidates candidate
            WHERE candidate.id = ANY($1::uuid[])
          )`,
        [revisions.map((revision) => revision.candidateId)],
      )
      await client.query(
        `UPDATE source_processing_runs processing
            SET status = 'completed', completed_at = now(), updated_at = now(),
                counters = counters || jsonb_build_object(
                  'candidates_published', (
                    SELECT count(*)::int FROM knowledge_candidates candidate
                     WHERE candidate.processing_run_id = processing.id
                       AND candidate.status = 'published'
                  )
                )
          WHERE processing.id IN (
            SELECT DISTINCT candidate.processing_run_id
              FROM knowledge_candidates candidate
             WHERE candidate.id = ANY($1::uuid[])
               AND candidate.processing_run_id IS NOT NULL
          )
            AND NOT EXISTS (
              SELECT 1 FROM source_fragments fragment
               WHERE fragment.processing_run_id = processing.id
                 AND (fragment.disposition IS NULL OR fragment.disposition IN (
                   'continuation_required', 'targeted_retry'
                 ))
            )
            AND NOT EXISTS (
              SELECT 1 FROM knowledge_candidates candidate
               WHERE candidate.processing_run_id = processing.id
                 AND candidate.status IN (
                   'analyzed', 'verified', 'deep_review', 'quarantined'
                 )
            )`,
        [revisions.map((revision) => revision.candidateId)],
      )
      for (const processingRunId of new Set(
        revisions.flatMap((revision) =>
          revision.processingRunId ? [revision.processingRunId] : [],
        ),
      )) {
        await recordMechanicalQualityCheck(client, {
          stage: 'normalize_deduplicate',
          profileKey: 'pipeline-v2-normalize-deduplicate-1',
          processingRunId,
          pipelineTaskId: claimed.task.id,
          coverageCount: revisions.filter((revision) =>
            revision.processingRunId === processingRunId
          ).length
        })
      }
    }
    await recordPipelineTransition(client, {
      scope: 'record',
      fromStage: 'ready',
      toStage: 'publish',
      count: revisions.length,
      kind: 'progress',
      taskId: claimed.task.id
    })
    await recordPipelineTransition(client, {
      scope: 'record',
      fromStage: 'ready',
      toStage: 'deep_low',
      count: deferredLow,
      kind: 'retry',
      taskId: claimed.task.id
    })
    await recordPipelineTransition(client, {
      scope: 'record',
      fromStage: 'ready',
      toStage: 'deep_medium',
      count: deferredMedium,
      kind: 'retry',
      taskId: claimed.task.id
    })
    return {
      records_reserved: payload.candidate_ids.length,
      records_published: revisions.length,
      records_deferred_to_deep_review: deferred.length,
      release_id: release?.releaseId ?? null,
      release_sequence: release?.sequence ?? null
    }
  })
  if (result.records_published > 0) {
    await reconcilePublishedKnowledgeDemands(database, [
      ...new Set(revisions.flatMap((revision) =>
        revision.knowledgeDemandId ? [revision.knowledgeDemandId] : [],
      ))
    ])
  }
  return result
}

async function executeMechanicalTask(
  database: Database,
  config: AppConfig,
  claimed: ClaimedMechanicalTask,
  fetchDocument: PublicDocumentFetcher = fetchPublicDocument,
): Promise<Record<string, unknown>> {
  switch (claimed.task.task_type) {
    case 'source_acquisition':
      return acquireSource(database, config, claimed, fetchDocument)
    case 'source_conversion':
      return convertSource(database, claimed)
    case 'source_chunking':
      return chunkSource(database, config, claimed)
    case 'candidate_publication':
      return publishCandidateBatch(database, claimed)
    case 'source_publication':
      return publishSource(database, claimed)
    default:
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
  }
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(message)) return message
  if (/^SOURCE_HTTP_\d{3}$/.test(message)) return message
  return 'PIPELINE_MECHANICAL_FAILURE'
}

export async function processNextPipelineTask(
  database: Database,
  config: AppConfig,
  logger: Logger,
  workerId: string,
  fetchDocument: PublicDocumentFetcher = fetchPublicDocument,
): Promise<boolean> {
  if (await processNextReprocessItem(database)) return true
  const claimed = await claimMechanicalPipelineTask(
    database,
    config,
    workerId,
  )
  if (!claimed) {
    return expandNextSourceCollection(database, logger)
  }

  try {
    const result = await executeMechanicalTask(
      database,
      config,
      claimed,
      fetchDocument,
    )
    await completeMechanicalPipelineTask(
      database,
      claimed.task.id,
      claimed.leaseToken,
      result,
    )
    logger.info(
      {
        pipelineTaskId: claimed.task.id,
        taskType: claimed.task.task_type,
        result
      },
      'Completed deterministic pipeline work',
    )
  } catch (error) {
    const code = failureCode(error)
    await failPipelineTask(database, {
      pipeline_task_id: claimed.task.id,
      lease_token: claimed.leaseToken,
      failure_code: code,
      failure_message:
        error instanceof Error
          ? `Deterministic pipeline stage failed: ${error.message}`.slice(0, 1_000)
          : 'Deterministic pipeline stage failed with an unknown error.'
    }).catch((failureError) => {
      logger.error(
        {
          err: failureError,
          pipelineTaskId: claimed.task.id
        },
        'Could not persist pipeline failure',
      )
    })
    logger.error(
      {
        err: error,
        pipelineTaskId: claimed.task.id,
        taskType: claimed.task.task_type,
        sourceFile: basename(
          String(claimed.task.payload['canonical_url'] ?? ''),
        ),
        sourceExtension: extname(
          String(claimed.task.payload['canonical_url'] ?? ''),
        )
      },
      'Deterministic pipeline work failed',
    )
  }
  return true
}

export async function purgeExpiredSourceArtifacts(
  database: Database,
  logger: Logger,
  removeFile: typeof unlink = unlink,
): Promise<number> {
  const expired = await database.query<{
    id: string
    storage_path: string
    extracted_text_path: string | null
  }>(
    `SELECT id, storage_path, extracted_text_path
     FROM source_artifacts
     WHERE purge_after <= now()
       AND status <> 'purged'
     ORDER BY purge_after
     LIMIT 25`,
  )
  let purged = 0
  for (const artifact of expired.rows) {
    try {
      await removeFile(artifact.storage_path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(
          {
            err: error,
            sourceArtifactId: artifact.id
          },
          'Could not purge expired source artifact',
        )
        continue
      }
    }
    if (artifact.extracted_text_path) try {
      await removeFile(artifact.extracted_text_path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(
          {
            err: error,
            sourceArtifactId: artifact.id
          },
          'Could not purge expired extracted source text',
        )
        continue
      }
    }
    await database.query(
      `UPDATE source_artifacts
          SET status = 'purged',
              updated_at = now()
        WHERE id = $1`,
      [artifact.id],
    )
    purged += 1
  }
  if (purged > 0) logger.info({ purged }, 'Purged expired source artifacts')
  return purged
}
