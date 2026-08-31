import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocument = vi.hoisted(() => vi.fn())

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}))

import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PDF_PAGES,
  MAX_TOTAL_FILE_BYTES,
  combineEvidenceFiles,
  extractEvidenceFiles,
  lineWindow,
  redactEvidence
} from './evidence'

describe('workbench evidence boundary', () => {
  beforeEach(() => getDocument.mockReset())

  it('redacts secrets and serials locally while preserving operational context', () => {
    const result = redactEvidence([
      'hostname core-01',
      'ip address 10.10.10.1 255.255.255.0',
      'snmp-server community public RO',
      'username val secret 9 TOPSECRET',
      'System Serial Number : FOC1234567'
    ].join('\n'))

    expect(result.redacted).toContain('hostname core-01')
    expect(result.redacted).toContain('10.10.10.1')
    expect(result.redacted).not.toContain('public')
    expect(result.redacted).not.toContain('TOPSECRET')
    expect(result.redacted).not.toContain('FOC1234567')
    expect(result.redactions).toEqual(expect.arrayContaining([
      { type: 'secret', count: 2 },
      { type: 'serial', count: 1 }
    ]))
  })

  it('redacts JSON, YAML, env, JWT, and quoted network secrets', () => {
    const canaries = [
      'JSON-CANARY', 'YAML-CANARY', 'ENV-CANARY',
      'QUOTED COMMUNITY', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJDQU5BUlkifQ.signature'
    ]
    const result = redactEvidence([
      '{"password":"JSON-CANARY"}',
      'api_key: YAML-CANARY',
      'ACCESS_TOKEN=ENV-CANARY',
      'snmp-server community "QUOTED COMMUNITY" RO',
      `authorization: ${canaries[4]}`,
      'hostname core-01',
      'username visible-user privilege 15'
    ].join('\n'))

    for (const canary of canaries) expect(result.redacted).not.toContain(canary)
    expect(result.redacted).toContain('hostname core-01')
    expect(result.redacted).toContain('username visible-user')
  })

  it('keeps the selected line window explicit', () => {
    expect(lineWindow('one\ntwo\nthree\nfour', 2, 3)).toBe('two\nthree')
  })

  it('accepts supported text files and hides filenames from combined evidence', async () => {
    const files = await extractEvidenceFiles([
      new File(['show version'], 'customer-core.log', { type: 'text/plain' })
    ], new AbortController().signal)
    const combined = combineEvidenceFiles(files)

    expect(combined).toContain('===== Evidence 1 =====')
    expect(combined).toContain('show version')
    expect(combined).not.toContain('customer-core.log')
  })

  it('rejects unsupported binary files', async () => {
    await expect(extractEvidenceFiles([
      new File(['binary'], 'capture.pcap', { type: 'application/octet-stream' })
    ], new AbortController().signal)).rejects.toThrow('FILE_TYPE_UNSUPPORTED')
  })

  it('enforces file count, per-file, and aggregate size limits before reading', async () => {
    const fakeFile = (name: string, size: number) => ({
      name,
      size,
      type: 'text/plain',
      text: vi.fn(async () => 'not read')
    }) as unknown as File

    await expect(extractEvidenceFiles(
      Array.from({ length: MAX_FILES + 1 }, (_, index) =>
        fakeFile(`file-${index}.txt`, 1)
      ),
      new AbortController().signal,
    )).rejects.toThrow('FILE_COUNT_LIMIT_EXCEEDED')

    await expect(extractEvidenceFiles([
      fakeFile('large.txt', MAX_FILE_BYTES + 1)
    ], new AbortController().signal)).rejects.toThrow('FILE_SIZE_LIMIT_EXCEEDED')

    const aggregatePart = Math.floor(MAX_TOTAL_FILE_BYTES / 3) + 1
    await expect(extractEvidenceFiles([
      fakeFile('one.txt', aggregatePart),
      fakeFile('two.txt', aggregatePart),
      fakeFile('three.txt', aggregatePart),
    ], new AbortController().signal)).rejects.toThrow(
      'TOTAL_FILE_SIZE_LIMIT_EXCEEDED',
    )
  })

  it('extracts every page from a PDF text layer', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async (page: number) => ({
          getTextContent: vi.fn(async () => ({ items: [{ str: `page-${page}` }] })),
          cleanup: vi.fn(),
        })),
      }),
      destroy,
    })

    const files = await extractEvidenceFiles([
      new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' }),
    ], new AbortController().signal)

    expect(files[0]).toMatchObject({ kind: 'pdf', pages: 2 })
    expect(files[0]?.text).toBe('[Page 1]\npage-1\n\n[Page 2]\npage-2')
    expect(destroy).toHaveBeenCalled()
  })

  it.each([
    ['encrypted', () => Promise.reject(new Error('PasswordException'))],
    ['without a text layer', () => Promise.resolve({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({ items: [] })),
        cleanup: vi.fn(),
      })),
    })],
  ])('reports PDF_TEXT_UNAVAILABLE for a PDF %s', async (_label, load) => {
    getDocument.mockReturnValue({
      promise: load(),
      destroy: vi.fn().mockResolvedValue(undefined),
    })

    await expect(extractEvidenceFiles([
      new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' }),
    ], new AbortController().signal)).rejects.toThrow('PDF_TEXT_UNAVAILABLE')
  })

  it('rejects a PDF above the page limit', async () => {
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: MAX_PDF_PAGES + 1 }),
      destroy: vi.fn().mockResolvedValue(undefined),
    })

    await expect(extractEvidenceFiles([
      new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' }),
    ], new AbortController().signal)).rejects.toThrow('PDF_PAGE_LIMIT_EXCEEDED')
  })

  it('destroys an in-flight PDF task when parsing is aborted', async () => {
    let rejectLoad!: (error: Error) => void
    const loading = new Promise<never>((_resolve, reject) => {
      rejectLoad = reject
    })
    const destroy = vi.fn(async () => rejectLoad(new Error('destroyed')))
    getDocument.mockReturnValue({ promise: loading, destroy })
    const controller = new AbortController()
    const extraction = extractEvidenceFiles([
      new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' }),
    ], controller.signal)

    await vi.waitFor(() => expect(getDocument).toHaveBeenCalled())
    controller.abort()

    await expect(extraction).rejects.toThrow('FILE_EXTRACTION_ABORTED')
    expect(destroy).toHaveBeenCalled()
  })
})
