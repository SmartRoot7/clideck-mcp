const ignoredTerms = new Set([
  'about', 'after', 'before', 'catalyst', 'check', 'cisco', 'command',
  'commands', 'configure', 'configuration', 'current', 'device', 'diagnose',
  'diagnosis', 'error', 'errors', 'existing', 'failure', 'failures', 'for',
  'from', 'guide', 'help', 'how', 'interface', 'into', 'ios', 'iosxe',
  'issue', 'network', 'operating', 'procedure', 'running', 'show', 'switch',
  'system', 'that', 'the', 'then', 'this', 'through', 'troubleshoot', 'using',
  'vendor', 'verify', 'verification', 'version', 'what', 'when', 'with', 'xe',
  'your'
])

const tokenPattern = /[a-z][a-z0-9]*(?:[-_/][a-z0-9]+)*/gi

function normalized(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function isUsefulTerm(term: string): boolean {
  if (term.length < 3 || term.length > 64) return false
  if (ignoredTerms.has(term)) return false
  if (/^\d+(?:[._-]\d+)*$/.test(term)) return false
  if (/^[a-z]{1,2}\d{2,5}[a-z0-9-]*$/.test(term)) return false
  return true
}

/**
 * Terms that distinguish an unanswered request from its vendor, platform and
 * generic operational wording. They are a deterministic guard, not a semantic
 * search replacement: an empty result intentionally leaves the source usable.
 */
export function knowledgeDemandTerms(question: string): string[] {
  const unique = new Set<string>()
  for (const token of normalized(question).match(tokenPattern) ?? []) {
    if (isUsefulTerm(token)) unique.add(token)
    if (unique.size >= 12) break
  }
  return [...unique]
}

function matchesTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i')
    .test(text)
}

/**
 * PostgreSQL-compatible patterns for ranking source fragments before an AI
 * analysis run. They are deliberately based on the exact same term boundary
 * rule as `matchesTerm`: the ranking may change order, but it must never
 * promote a substring such as "remacsec" for the demand term "macsec".
 */
export function knowledgeDemandTermPatterns(question: string): string[] {
  return knowledgeDemandTerms(question).map((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `(^|[^a-z0-9])${escaped}($|[^a-z0-9])`
  })
}

export type KnowledgeDemandRelevance = {
  terms: string[]
  matchedTerms: string[]
}

export function assessKnowledgeDemandRelevance(
  question: string,
  evidence: readonly string[],
): KnowledgeDemandRelevance {
  const terms = knowledgeDemandTerms(question)
  if (terms.length === 0) return { terms, matchedTerms: [] }
  const haystack = evidence.join('\n')
  return {
    terms,
    matchedTerms: terms.filter((term) => matchesTerm(haystack, term))
  }
}

export function isRelevantToKnowledgeDemand(
  question: string,
  evidence: readonly string[],
): boolean {
  const relevance = assessKnowledgeDemandRelevance(question, evidence)
  return relevance.terms.length === 0 || relevance.matchedTerms.length > 0
}
