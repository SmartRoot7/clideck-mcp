import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfModulePromise: Promise<typeof import('pdfjs-dist')> | null = null

async function loadPdfModule() {
  pdfModulePromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    return pdfjs
  })
  return pdfModulePromise
}

export const MAX_FILES = 5
export const MAX_FILE_BYTES = 10 * 1_024 * 1_024
export const MAX_TOTAL_FILE_BYTES = 25 * 1_024 * 1_024
export const MAX_PDF_PAGES = 500

const textExtensions = new Set([
  'txt', 'log', 'md', 'csv', 'json', 'jsonl', 'html', 'htm'
])

export type EvidenceFile = {
  id: string
  label: string
  name: string
  size: number
  kind: 'text' | 'pdf'
  text: string
  pages: number | null
}

export type RedactionCount = { type: string; count: number }

function extension(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

function replaceAndCount(
  input: string,
  pattern: RegExp,
  replacement: string | ((...args: string[]) => string),
) {
  let count = 0
  return {
    value: input.replace(pattern, (...args: string[]) => {
      count += 1
      return typeof replacement === 'string'
        ? replacement
        : replacement(...args)
    }),
    count
  }
}

export function redactEvidence(input: string): {
  redacted: string
  redactions: RedactionCount[]
} {
  let redacted = input.replaceAll('\u0000', '')
  const counts = new Map<string, number>()
  const apply = (
    type: string,
    pattern: RegExp,
    replacement: string | ((...args: string[]) => string),
  ) => {
    const result = replaceAndCount(redacted, pattern, replacement)
    redacted = result.value
    if (result.count > 0) counts.set(type, (counts.get(type) ?? 0) + result.count)
  }

  apply(
    'private_key',
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
    '[REDACTED_PRIVATE_KEY]',
  )
  apply(
    'secret',
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    (_match, scheme) => `${scheme} [REDACTED_SECRET]`,
  )
  apply(
    'secret',
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_SECRET]',
  )
  apply(
    'secret',
    /((?:^|[,;{\s])["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|community|key[_-]?string|pre[_-]?shared[_-]?key|auth[_-]?password)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gim,
    (_match, prefix) => `${prefix}[REDACTED_SECRET]`,
  )
  apply(
    'secret',
    /(\b(?:password|secret|community|key-string|pre-shared-key|auth-password|tacacs-server key|radius-server key)\b(?:\s+\d+\s+|\s+))(?:(?:"[^"]*")|(?:'[^']*')|[^\s,;]+)/gi,
    (_match, prefix) => `${prefix}[REDACTED_SECRET]`,
  )
  apply(
    'serial',
    /^(\s*(?:system serial number|processor board id|chassis serial number|serial number)\s*:?\s*)(\S+)/gim,
    (_match, prefix) => `${prefix}[REDACTED_SERIAL]`,
  )

  return {
    redacted,
    redactions: [...counts].map(([type, count]) => ({ type, count }))
  }
}

async function extractPdf(file: File, signal: AbortSignal): Promise<{
  text: string
  pages: number
}> {
  const pdfjs = await loadPdfModule()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const abort = () => void loadingTask.destroy()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const document = await loadingTask.promise
    if (document.numPages > MAX_PDF_PAGES) throw new Error('PDF_PAGE_LIMIT_EXCEEDED')
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal.aborted) throw new Error('FILE_EXTRACTION_ABORTED')
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.flatMap((item) =>
        'str' in item && typeof item.str === 'string' ? [item.str] : []
      ).join(' ').trim()
      pages.push(`[Page ${pageNumber}]\n${text}`)
      page.cleanup()
    }
    const text = pages.join('\n\n').trim()
    if (!text.replace(/^\[Page \d+\]$/gm, '').trim()) {
      throw new Error('PDF_TEXT_UNAVAILABLE')
    }
    return { text, pages: document.numPages }
  } catch (error) {
    if (signal.aborted) throw new Error('FILE_EXTRACTION_ABORTED')
    if (error instanceof Error && [
      'PDF_PAGE_LIMIT_EXCEEDED', 'PDF_TEXT_UNAVAILABLE'
    ].includes(error.message)) throw error
    throw new Error('PDF_TEXT_UNAVAILABLE')
  } finally {
    signal.removeEventListener('abort', abort)
    await loadingTask.destroy().catch(() => undefined)
  }
}

export async function extractEvidenceFiles(
  files: readonly File[],
  signal: AbortSignal,
): Promise<EvidenceFile[]> {
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new Error('FILE_COUNT_LIMIT_EXCEEDED')
  }
  if (files.some((file) => file.size > MAX_FILE_BYTES)) {
    throw new Error('FILE_SIZE_LIMIT_EXCEEDED')
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
    throw new Error('TOTAL_FILE_SIZE_LIMIT_EXCEEDED')
  }

  const extracted: EvidenceFile[] = []
  for (const [index, file] of files.entries()) {
    if (signal.aborted) throw new Error('FILE_EXTRACTION_ABORTED')
    const ext = extension(file.name)
    if (ext === 'pdf' || file.type === 'application/pdf') {
      const pdf = await extractPdf(file, signal)
      extracted.push({
        id: crypto.randomUUID(),
        label: `Evidence ${index + 1}`,
        name: file.name,
        size: file.size,
        kind: 'pdf',
        text: pdf.text,
        pages: pdf.pages
      })
      continue
    }
    if (!textExtensions.has(ext)) throw new Error('FILE_TYPE_UNSUPPORTED')
    extracted.push({
      id: crypto.randomUUID(),
      label: `Evidence ${index + 1}`,
      name: file.name,
      size: file.size,
      kind: 'text',
      text: await file.text(),
      pages: null
    })
  }
  return extracted
}

export function combineEvidenceFiles(files: readonly EvidenceFile[]): string {
  return files.map((file) => `===== ${file.label} =====\n${file.text}`).join('\n\n')
}

export function lineWindow(
  text: string,
  startLine: number,
  endLine: number,
): string {
  return text.split('\n').slice(startLine - 1, endLine).join('\n')
}
