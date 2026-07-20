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
import type { Database } from '../db.js'
import { withTransaction } from '../db.js'
import type { Logger } from '../logger.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import { safePublicLookup } from '../security/url-policy.js'
import { resolveNetworkContext } from './context.js'
import { searchKnowledge } from './knowledge.js'
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
import { recordPipelineTransition } from './pipeline-transitions.js'
import { enforceKnowledgeRisk } from './risk.js'

const execFileAsync = promisify(execFile)
const maxOcrPages = 100
const maxOcrDurationMs = 10 * 60_000

const sourcePayloadSchema = z.object({
  source_id: z.string().uuid(),
  canonical_url: z.url().startsWith('https://'),
  document_type: z.string().min(1),
  title: z.string().min(1),
  document_version: z.string().nullable().optional(),
  document_date: z.string().nullable().optional()
})

const allowedMediaTypes = new Set([
  'application/pdf',
  'application/xhtml+xml',
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
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return
  const demands = await database.query<{
    id: string
    question: string
    context: Record<string, unknown>
  }>(
    `SELECT id, question, context
     FROM knowledge_demands
     WHERE id IN (
       SELECT source.knowledge_demand_id
       FROM source_candidates source
       WHERE source.id = ANY($1::uuid[])
         AND source.knowledge_demand_id IS NOT NULL
     )
       AND status IN ('acquiring', 'processing', 'unresolved')`,
    [sourceIds],
  )
  for (const demand of demands.rows) {
    const vendor = demand.context['vendor_slug']
    const operatingSystem = demand.context['operating_system_slug']
    if (
      typeof vendor !== 'string' ||
      typeof operatingSystem !== 'string'
    ) {
      continue
    }
    const context = await resolveNetworkContext(database, {
      vendor,
      operating_system: operatingSystem,
      ...(typeof demand.context['model'] === 'string'
        ? { model: demand.context['model'] }
        : {}),
      ...(typeof demand.context['version'] === 'string'
        ? { version: demand.context['version'] }
        : {})
    })
    const answers = await searchKnowledge(
      database,
      demand.question,
      context,
      1,
    )
    const answer = answers[0]
    if (!answer) continue
    await database.query(
      `UPDATE knowledge_demands demand
          SET status = 'published',
              result_revision_id = revision.id,
              result_release_id = active.release_id,
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

async function expandNextSourceCollection(
  database: Database,
  logger: Logger,
): Promise<boolean> {
  const collection = await withTransaction(database, async (client) => {
    const selected = await client.query<{
      id: string
      coverage_target_id: string
      canonical_url: string
      vendor_domain: string
      crawl_depth: number
      link_limit: number
      cursor: { queue?: Array<{ url: string; depth: number }> }
    }>(
      `SELECT
         id,
         coverage_target_id,
         canonical_url,
         vendor_domain,
         crawl_depth,
         link_limit,
         cursor
       FROM source_collections
       WHERE (
         status = 'active' AND next_scan_at <= now()
       ) OR (
         status = 'refreshing'
         AND updated_at <= now() - interval '10 minutes'
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
    : [{ url: collection.canonical_url, depth: 0 }]
  const queue = [...initialQueue]
  const seen = new Set<string>()
  const discovered = new Set<string>()
  let pages = 0
  try {
    while (
      queue.length > 0 &&
      pages < 20 &&
      discovered.size < collection.link_limit
    ) {
      const current = queue.shift()!
      if (seen.has(current.url)) continue
      seen.add(current.url)
      const host = new URL(current.url).hostname.toLowerCase()
      if (!isVendorCollectionHost(host, collection.vendor_domain)) {
        continue
      }
      const response = await fetchPublicDocument(
        current.url,
        2 * 1024 * 1024,
      )
      pages += 1
      if (
        !isVendorCollectionHost(
          new URL(response.finalUrl).hostname,
          collection.vendor_domain,
        )
      ) {
        continue
      }
      if (
        response.mediaType !== 'text/html' &&
        response.mediaType !== 'application/xhtml+xml'
      ) {
        discovered.add(response.finalUrl)
        continue
      }
      for (const link of collectionLinks(
        response.body.toString('utf8'),
        response.finalUrl,
      )) {
        const linkHost = new URL(link).hostname.toLowerCase()
        if (!isVendorCollectionHost(
          linkHost,
          collection.vendor_domain,
        )) {
          continue
        }
        if (
          /\.(?:pdf|txt)(?:\?|$)/i.test(link) ||
          /(?:command|configuration|diagnostic|manual|reference|release|advisory|upgrade)/i.test(
            link,
          )
        ) {
          discovered.add(link)
        }
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
             discovered_by
           )
           VALUES (
             $1, $2, $3, $4, 'approved',
             'deterministic-source-collection'
           )
           ON CONFLICT (canonical_url) DO NOTHING
           RETURNING id`,
          [
            collection.coverage_target_id,
            url,
            collectionDocumentType(url),
            collectionSourceTitle(url)
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
                updated_at = now()
          WHERE id = $1`,
        [
          collection.id,
          JSON.stringify({ queue: remaining }),
          inserted,
          duplicates
        ],
      )
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
  if (pageCount > maxOcrPages) throw new Error('SOURCE_OCR_PAGE_LIMIT')

  const scratch = await mkdtemp(join(tmpdir(), 'clideck-mcp-ocr-'))
  const pages: string[] = []
  const deadline = Date.now() + maxOcrDurationMs
  try {
    for (let page = 1; page <= pageCount; page += 1) {
      if (Date.now() >= deadline) throw new Error('SOURCE_OCR_TIME_LIMIT')
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
        // A failed scanned page is recorded by omission and does not block
        // usable pages from the same public document.
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
    if (extracted.length >= 200) return { text: extracted, pageCount }
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

  const pages = normalized.split('\f')
  const retainedPages = pages.filter(
    (page) => !isLikelyTableOfContentsPage(page),
  )
  return (retainedPages.length > 0 ? retainedPages : pages)
    .map((page) => page.trim())
    .filter(Boolean)
    .join('\n')
}

export function chunkSourceText(text: string): TextFragment[] {
  const maxBytes = 30_000
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

async function acquireSource(
  database: Database,
  config: AppConfig,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const downloaded = await fetchPublicDocument(
    payload.canonical_url,
    config.sourceMaxBytes,
  )
  const contentHash = bufferHash(downloaded.body)
  const storageRoot = resolve(config.sourceStorageDir)
  await mkdir(storageRoot, { recursive: true, mode: 0o750 })
  const finalPath = join(
    storageRoot,
    `${payload.source_id}${extensionForMediaType(downloaded.mediaType)}`,
  )
  const tempPath = join(storageRoot, `.${payload.source_id}.${randomUUID()}.tmp`)
  await writeFile(tempPath, downloaded.body, { mode: 0o640 })
  await rename(tempPath, finalPath)

  let outcome: { duplicate: boolean; [key: string]: unknown }
  try {
    outcome = await withTransaction(database, async (client) => {
      const duplicate = await client.query<{ source_candidate_id: string }>(
      `SELECT source_candidate_id
       FROM source_artifacts
       WHERE content_hash = $1
       LIMIT 1`,
      [contentHash],
      )
      if (
        duplicate.rows[0] &&
        duplicate.rows[0].source_candidate_id !== payload.source_id
      ) {
        await client.query(
          `UPDATE source_candidates
            SET status = 'duplicate',
                content_hash = NULL,
                completed_at = now(),
                updated_at = now()
          WHERE id = $1`,
          [payload.source_id],
        )
        await client.query(
          `UPDATE pipeline_settings
            SET active_source_id = NULL,
                updated_at = now(),
                updated_by = 'duplicate-detector'
          WHERE singleton AND active_source_id = $1`,
          [payload.source_id],
        )
        return {
          duplicate: true,
          duplicate_of: duplicate.rows[0].source_candidate_id,
          content_hash: contentHash
        }
      }
      await client.query(
        `INSERT INTO source_artifacts (
         source_candidate_id,
         media_type,
         byte_size,
         content_hash,
         storage_path,
         purge_after
       )
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       ON CONFLICT (source_candidate_id)
       DO UPDATE SET
         media_type = excluded.media_type,
         byte_size = excluded.byte_size,
         content_hash = excluded.content_hash,
         storage_path = excluded.storage_path,
         status = 'downloaded',
         updated_at = now()`,
        [
          payload.source_id,
          downloaded.mediaType,
          downloaded.body.byteLength,
          contentHash,
          finalPath,
          config.sourceRetentionDays
        ],
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
        content_hash: contentHash
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
  }>(
    `SELECT id, storage_path, media_type
     FROM source_artifacts
     WHERE source_candidate_id = $1`,
    [payload.source_id],
  )
  const row = artifact.rows[0]
  if (!row) throw new Error('SOURCE_ARTIFACT_NOT_FOUND')
  const converted = await convertArtifact(row.storage_path, row.media_type)
  const text = converted.text.trim()
  if (!text) throw new Error('SOURCE_CONVERSION_EMPTY')
  const demandQuestion = await demandQuestionForTask(
    database,
    claimed.task.knowledge_demand_id,
  )
  const demandRelevance = demandQuestion
    ? assessKnowledgeDemandRelevance(demandQuestion, [
        payload.title,
        payload.canonical_url,
        text
      ])
    : null
  if (
    demandRelevance &&
    demandRelevance.terms.length > 0 &&
    demandRelevance.matchedTerms.length === 0
  ) {
    await withTransaction(database, async (client) => {
      await client.query(
        `UPDATE source_candidates
            SET status = 'rejected',
                failure_code = 'DEMAND_TERM_NOT_FOUND',
                failure_message =
                  'Converted source does not contain a demand-specific technical term.',
                updated_at = now()
          WHERE id = $1`,
        [payload.source_id],
      )
    })
    return {
      rejected_as_unrelated: true,
      demand_terms_considered: demandRelevance.terms.length,
      matched_demand_terms: 0,
      converter: row.media_type === 'application/pdf'
        ? 'pdftotext_with_local_ocr_fallback'
        : 'deterministic_text'
    }
  }
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
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  const artifact = await database.query<{
    id: string
    extracted_text_path: string | null
  }>(
    `SELECT id, extracted_text_path
     FROM source_artifacts
     WHERE source_candidate_id = $1`,
    [payload.source_id],
  )
  const row = artifact.rows[0]
  if (!row?.extracted_text_path) throw new Error('SOURCE_TEXT_NOT_FOUND')
  const fragments = chunkSourceText(
    await readFile(row.extracted_text_path, 'utf8'),
  )
  if (fragments.length === 0) throw new Error('SOURCE_CHUNKING_EMPTY')

  await withTransaction(database, async (client) => {
    for (const fragment of fragments) {
      await client.query(
        `INSERT INTO source_fragments (
           source_artifact_id,
           ordinal,
           section_title,
           source_locator,
           content,
           content_hash
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          row.id,
          fragment.ordinal,
          fragment.sectionTitle,
          fragment.sourceLocator,
          fragment.content,
          fragment.contentHash
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

async function runDeterministicFastPath(
  database: Database,
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
  const demandQuestion = await demandQuestionForTask(
    database,
    task.knowledge_demand_id,
  )

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
    platform_slug:
      target.model && /^[a-z0-9][a-z0-9-]{1,62}$/.test(target.model)
        ? target.model
        : null,
    version_min: target.version_branch,
    version_max: target.version_branch
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
    }>(
      `SELECT
         id, ordinal, section_title, source_locator, content, content_hash
       FROM source_fragments
       WHERE source_artifact_id = $1
         AND status = 'queued'
         AND ordinal > $2
       ORDER BY ordinal
       LIMIT $3`,
      [artifactId, lastOrdinal, extractor.max_fragments_per_batch],
    )
    if (fragments.rows.length === 0) break
    lastOrdinal = fragments.rows.at(-1)?.ordinal ?? lastOrdinal
    const result = extractor.extract({
      fragments: fragments.rows,
      source: inputSource,
      context: extractionContext,
      verified_at: verifiedAt
    })
    const demandRelevantFragments = new Set<string>()
    await withTransaction(database, async (client) => {
      let batchCandidatesCreated = 0
      for (const entry of result.candidates) {
        const parsed = networkDomainPack.candidateSchema.parse(
          entry.candidate,
        )
        const validation = networkDomainPack.validateCandidate(parsed)
        if (!validation.valid) continue
        const candidate = enforceKnowledgeRisk(
          pipelineCandidatePayloadSchema.parse(parsed),
        )
        if (
          demandQuestion &&
          !isRelevantToKnowledgeDemand(demandQuestion, [
            JSON.stringify(candidate)
          ])
        ) {
          continue
        }
        demandRelevantFragments.add(entry.fragment_id)
        const serialized = JSON.stringify(candidate)
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO knowledge_candidates (
             pipeline_task_id,
             source_fragment_id,
             stable_key,
             payload,
             content_hash,
             dangerous,
             confidence,
             quality_score
           )
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           ON CONFLICT (content_hash) DO NOTHING
           RETURNING id`,
          [
            task.id,
            entry.fragment_id,
            candidate.stable_key,
            serialized,
            sha256Label(serialized),
            candidate.dangerous,
            candidate.confidence,
            candidate.quality_score
          ],
        )
        if (inserted.rows[0]) {
          candidatesCreated += 1
          batchCandidatesCreated += 1
        }
      }
      const handledFragmentIds = demandQuestion
        ? result.handled_fragment_ids.filter((id) =>
            demandRelevantFragments.has(id),
          )
        : result.handled_fragment_ids
      if (handledFragmentIds.length > 0) {
        await client.query(
          `UPDATE source_fragments
              SET status = 'analyzed',
                  updated_at = now()
            WHERE id = ANY($1::uuid[])
              AND source_artifact_id = $2
              AND status = 'queued'`,
          [handledFragmentIds, artifactId],
        )
      }
      await recordPipelineTransition(client, {
        scope: 'record',
        fromStage: 'analyze',
        toStage: 'verify',
        count: batchCandidatesCreated,
        kind: 'progress',
        taskId: task.id,
        dedupeSuffix: `deterministic-fast-path:${lastOrdinal}`
      })
    })
    const handledFragmentIds = demandQuestion
      ? result.handled_fragment_ids.filter((id) =>
          demandRelevantFragments.has(id),
        )
      : result.handled_fragment_ids
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
  }>(
      `SELECT DISTINCT ON (kc.stable_key)
         kc.id,
         kc.payload,
         kc.revision_id
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
    await reconcilePublishedKnowledgeDemands(database, sourceIds)
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
  }>(
    `SELECT id, payload, revision_id
     FROM knowledge_candidates
     WHERE id = ANY($1::uuid[])
       AND publication_task_id = $2
       AND status = 'verified'
     ORDER BY updated_at, created_at`,
    [payload.candidate_ids, claimed.task.id],
  )

  const revisions: Array<{
    candidateId: string
    itemId: string
    revisionId: string
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
    await reconcilePublishedKnowledgeDemands(database, payload.source_ids)
  }
  return result
}

async function executeMechanicalTask(
  database: Database,
  config: AppConfig,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  switch (claimed.task.task_type) {
    case 'source_acquisition':
      return acquireSource(database, config, claimed)
    case 'source_conversion':
      return convertSource(database, claimed)
    case 'source_chunking':
      return chunkSource(database, claimed)
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
): Promise<boolean> {
  const claimed = await claimMechanicalPipelineTask(
    database,
    config,
    workerId,
  )
  if (!claimed) return expandNextSourceCollection(database, logger)

  try {
    const result = await executeMechanicalTask(database, config, claimed)
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
