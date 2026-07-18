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

import { z } from 'zod'

import type { AppConfig } from '../config.js'
import type { Database } from '../db.js'
import { withTransaction } from '../db.js'
import type { Logger } from '../logger.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import { safePublicLookup } from '../security/url-policy.js'
import {
  claimMechanicalPipelineTask,
  completeMechanicalPipelineTask,
  failPipelineTask,
  type PipelineTaskRow
} from './pipeline.js'
import {
  createKnowledgeRevision,
  publishKnowledgeBatch
} from './publication.js'

const execFileAsync = promisify(execFile)

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

function bufferHash(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === 'application/pdf') return '.pdf'
  if (mediaType === 'text/plain') return '.txt'
  return '.html'
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
            'user-agent': 'CliDeck-MCP-Knowledge-Pipeline/0.3'
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

async function ocrPdfPages(
  pdfPath: string,
): Promise<{ text: string; pageCount: number | null }> {
  const info = await execFileAsync('pdfinfo', [pdfPath], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  })
  const match = /^Pages:\s+(\d+)$/im.exec(info.stdout)
  const pageCount = match?.[1] ? Number(match[1]) : null
  if (!pageCount || pageCount > 2_000) {
    return { text: '', pageCount }
  }

  const scratch = await mkdtemp(join(tmpdir(), 'clideck-mcp-ocr-'))
  const pages: string[] = []
  try {
    for (let page = 1; page <= pageCount; page += 1) {
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
  let remaining = text.trim()
  while (Buffer.byteLength(remaining, 'utf8') > maxBytes) {
    let end = Math.min(remaining.length, maxBytes)
    while (
      end > 1 &&
      Buffer.byteLength(remaining.slice(0, end), 'utf8') > maxBytes
    ) {
      end -= 1
    }
    const boundary = Math.max(
      remaining.lastIndexOf('\n', end),
      remaining.lastIndexOf(' ', end),
    )
    if (boundary > end / 2) end = boundary
    pieces.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }
  if (remaining) pieces.push(remaining)
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
    await client.query(
      `UPDATE source_candidates
          SET status = 'analyzing',
              updated_at = now()
        WHERE id = $1`,
      [payload.source_id],
    )
  })
  return {
    fragments_created: fragments.length,
    fragment_bytes: fragments.reduce(
      (total, fragment) =>
        total + Buffer.byteLength(fragment.content, 'utf8'),
      0,
    )
  }
}

async function publishSource(
  database: Database,
  claimed: ClaimedMechanicalTask,
): Promise<Record<string, unknown>> {
  const payload = sourcePayloadSchema.parse(claimed.task.payload)
  return withTransaction(database, async (client) => {
    const candidates = await client.query<{
      id: string
      payload: unknown
    }>(
      `SELECT DISTINCT ON (kc.stable_key) kc.id, kc.payload
       FROM knowledge_candidates kc
       JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
       WHERE pt.source_candidate_id = $1
         AND kc.status = 'verified'
       ORDER BY kc.stable_key, kc.quality_score DESC, kc.created_at DESC`,
      [payload.source_id],
    )

    const revisions: {
      candidateId: string
      itemId: string
      revisionId: string
    }[] = []
    for (const candidate of candidates.rows) {
      const created = await createKnowledgeRevision(client, candidate.payload)
      revisions.push({
        candidateId: candidate.id,
        ...created
      })
    }

    let release: { releaseId: string; sequence: number } | null = null
    if (revisions.length > 0) {
      release = await publishKnowledgeBatch(
        client,
        revisions.map(({ itemId, revisionId }) => ({ itemId, revisionId })),
        `Published source package: ${payload.title}`,
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
              AND pt.source_candidate_id = $1
          )`,
        [payload.source_id],
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
            WHERE pt.source_candidate_id = $1
          )`,
        [payload.source_id],
      )
    }

    await client.query(
      `UPDATE source_candidates
          SET status = 'completed',
              failure_code = NULL,
              failure_message = NULL,
              completed_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [payload.source_id],
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
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = NULL,
              updated_at = now(),
              updated_by = 'source-publisher'
        WHERE singleton AND active_source_id = $1`,
      [payload.source_id],
    )
    return {
      revisions_published: revisions.length,
      release_id: release?.releaseId ?? null,
      release_sequence: release?.sequence ?? null
    }
  })
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
  if (!claimed) return false

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
    await unlink(artifact.storage_path).catch(() => undefined)
    if (artifact.extracted_text_path) {
      await unlink(artifact.extracted_text_path).catch(() => undefined)
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
