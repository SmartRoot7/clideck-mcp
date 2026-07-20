const conversationalSearchWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'catalyst',
  'check', 'cisco', 'cli', 'command', 'commands', 'could', 'did', 'do',
  'does', 'exact',
  'for', 'from', 'give', 'how', 'i', 'if', 'in', 'inspect', 'increasing',
  'ios', 'is', 'it', 'may', 'mode', 'must', 'my', 'need', 'next', 'of', 'on',
  'or', 'our', 'please', 'provide', 'require', 'required', 'requires',
  'run', 'safe', 'should', 'state', 'tell', 'that', 'the', 'their',
  'then', 'this', 'to', 'use', 'using', 'want', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'workflow', 'would', 'xe', 'you',
  'your'
])

function uniqueTokens(
  input: string,
  aliases: Readonly<Record<string, string>>,
): string[] {
  const tokens = input.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return [...new Set(tokens.map((token) => aliases[token] ?? token))].filter(
    (token) =>
      token.length >= 2 &&
      (!/^[0-9]+$/.test(token) || token.length >= 3) &&
      !conversationalSearchWords.has(token),
  )
}

function pairwiseQuery(tokens: string[]): string {
  if (tokens.length === 1) return tokens[0]!
  const pairs: string[] = []
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      pairs.push(`(${tokens[left]} & ${tokens[right]})`)
    }
  }
  return pairs.join(' | ')
}

export function buildSearchQueries(
  question: string,
  aliases: Readonly<Record<string, string>> = {},
) {
  const normalizedQuestion = question
    .replace(/<[^>]{1,80}>/g, ' ')
    .replace(/[<>{}[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const rawTokens = uniqueTokens(normalizedQuestion, aliases)
  const fallbackTokens =
    normalizedQuestion.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const tokens = (rawTokens.length > 0 ? rawTokens : fallbackTokens).slice(0, 8)
  const safeTokens = tokens.length > 0 ? tokens : ['clidecknomatch']
  const prefixTokens = safeTokens.map((token) => `${token}:*`)

  return {
    normalizedQuestion,
    strictTsQuery: prefixTokens.join(' & '),
    relaxedTsQuery: pairwiseQuery(prefixTokens)
  }
}
