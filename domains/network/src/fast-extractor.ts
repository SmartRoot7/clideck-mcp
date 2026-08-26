import type {
  DeterministicExtractionInput,
  DeterministicExtractionResult,
  DeterministicExtractor
} from '@clideck/domain-kit'

import type { NetworkKnowledgeCandidate } from './schemas.js'

const commandStart = /^(?:\[?no\]?\s+)?(?:show|display|ping|traceroute|traceroute6|verify|dir|ls|pwd|cd|mkdir|rmdir|more|less|cat|head|tail|grep|find|terminal|enable|write|configure|interface|router|switchport|shutdown|spanning-tree|ip|ipv6|aaa|bfd|bgp|ospf|isis|eigrp|route-map|policy-map|class-map|logging|snmp-server|crypto|username|monitor|copy|clear|debug|reload|install|boot|erase|delete|del|rm|format|mount|umount|systemctl|journalctl|ethtool|nmcli|net|route|netstat|ss|tcpdump|curl|wget|set|commit|rollback|request|edit|run|save|load)\b/i
const readOnlyStart = /^(?:show|display|ping|traceroute|traceroute6|verify|dir|ls|pwd|more|less|cat|head|tail|grep|find|journalctl|netstat|ss|tcpdump|terminal\s+(?:length|width|monitor))\b/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

type CommandLine = {
  command: string
  lineIndex: number
  structured: boolean
  syntaxDescriptionIndex?: number
}

const syntaxDescriptionStart = /^\s*syntax\s+description\b/i
const commandSectionStart = /^\s*(?:command\s+(?:defaults?|modes?|history)|usage\s+guidelines|examples?|related\s+commands)\b/i

function normalizedCommandLine(rawLine: string): string {
  return compact(
    rawLine
      .replace(/^[•*]\s*/, '')
      .replace(/^\d+[.)]\s+/, ''),
  )
}

function looksLikeResidualCommand(rawLine: string): boolean {
  const line = normalizedCommandLine(rawLine)
  return (
    /^[a-z]/.test(rawLine.trim()) &&
    /^[a-z][a-z0-9-]*(?:\s+\S+)*$/i.test(line) &&
    /^[a-z]/.test(line) &&
    !/^(?:and|are|can|command|default|description|example|for|from|if|is|may|modification|must|or|purpose|release|syntax|the|this|to|usage|when|where|with|without)\b/i.test(line)
  )
}

function commandLines(value: string): {
  commands: CommandLine[]
  fullyStructured: boolean
} {
  const commands: CommandLine[] = []
  const seen = new Set<string>()
  const lines = value.split('\n')
  const add = (
    lineIndex: number,
    structured: boolean,
    commandOverride?: string,
    syntaxDescriptionIndex?: number,
  ) => {
    const line = commandOverride ?? normalizedCommandLine(lines[lineIndex] ?? '')
    if (
      line.length < 3 ||
      line.length > 2_000 ||
      /[.!?]$/.test(line) ||
      /\b(?:example|purpose|description|syntax)\s*:/i.test(line)
    ) {
      return
    }
    const normalized = line.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    commands.push({
      command: line,
      lineIndex,
      structured,
      ...(syntaxDescriptionIndex === undefined
        ? {}
        : { syntaxDescriptionIndex })
    })
  }

  for (const [lineIndex, rawLine] of lines.entries()) {
    if (!syntaxDescriptionStart.test(rawLine)) continue
    let syntaxEnd = lineIndex - 1
    while (syntaxEnd >= 0 && !lines[syntaxEnd]?.trim()) syntaxEnd -= 1
    if (syntaxEnd < 0) continue
    let syntaxStart = -1
    for (
      let index = syntaxEnd;
      index >= Math.max(0, syntaxEnd - 24);
      index -= 1
    ) {
      if (commandStart.test(normalizedCommandLine(lines[index] ?? ''))) {
        syntaxStart = index
        break
      }
      if (index < syntaxEnd && !lines[index]?.trim()) break
    }
    if (syntaxStart < 0) {
      syntaxStart = syntaxEnd
      while (
        syntaxStart > 0 &&
        lines[syntaxStart - 1]?.trim() &&
        !commandSectionStart.test(lines[syntaxStart - 1] ?? '')
      ) {
        syntaxStart -= 1
      }
    }
    const syntaxLines: string[] = []
    for (let index = syntaxStart; index <= syntaxEnd; index += 1) {
      const normalized = normalizedCommandLine(lines[index] ?? '')
      if (!normalized) continue
      if (syntaxLines.length > 0 && /^no\s+/i.test(normalized)) break
      syntaxLines.push(normalized)
    }
    const syntax = compact(syntaxLines.join(' '))
    if (syntax) add(syntaxStart, true, syntax, lineIndex)
  }
  let insideSyntaxDescription = false
  let hasUnparsedResidual = false
  for (const [lineIndex, rawLine] of lines.entries()) {
    if (syntaxDescriptionStart.test(rawLine)) {
      insideSyntaxDescription = true
      continue
    }
    if (/^\s*command\s+modes?\s*$/i.test(rawLine)) {
      insideSyntaxDescription = false
      continue
    }
    if (insideSyntaxDescription) continue
    const line = normalizedCommandLine(rawLine)
    const isStructuredDuplicate = commands.some((command) =>
      command.structured &&
      (
        command.command.toLowerCase().startsWith(line.toLowerCase()) ||
        line.toLowerCase().startsWith(command.command.toLowerCase())
      ),
    )
    if (isStructuredDuplicate) continue
    if (commandStart.test(line)) {
      add(lineIndex, false)
    } else if (
      !seen.has(line.toLowerCase()) &&
      looksLikeResidualCommand(rawLine)
    ) {
      hasUnparsedResidual = true
    }
  }
  return {
    commands,
    fullyStructured:
      commands.length > 0 &&
      commands.every((command) => command.structured) &&
      !insideSyntaxDescription &&
      !hasUnparsedResidual
  }
}

function structuredSectionEnd(lines: string[], syntaxDescriptionIndex: number): number {
  for (let index = syntaxDescriptionIndex + 1; index < lines.length; index += 1) {
    if (syntaxDescriptionStart.test(lines[index] ?? '')) return index
  }
  return lines.length
}

function structuredSyntaxOptions(
  content: string,
  syntaxDescriptionIndex: number | undefined,
): string[] {
  if (syntaxDescriptionIndex === undefined) return []
  const lines = content.split('\n')
  const sectionEnd = structuredSectionEnd(lines, syntaxDescriptionIndex)
  let end = sectionEnd
  for (let index = syntaxDescriptionIndex + 1; index < sectionEnd; index += 1) {
    if (commandSectionStart.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  const firstLine = (lines[syntaxDescriptionIndex] ?? '')
    .replace(syntaxDescriptionStart, '')
    .trim()
  const optionText = [
    firstLine,
    ...lines.slice(syntaxDescriptionIndex + 1, end)
  ].join('\n')
  return optionText
    .split(/\n\s*\n/)
    .map(compact)
    .filter((line) => line.length >= 2)
    .slice(0, 100)
    .map((line) => line.slice(0, 1_000))
}

function structuredReleaseHistory(
  content: string,
  syntaxDescriptionIndex: number | undefined,
): string[] {
  if (syntaxDescriptionIndex === undefined) return []
  const lines = content.split('\n')
  const sectionEnd = structuredSectionEnd(lines, syntaxDescriptionIndex)
  const historyIndex = lines.findIndex((line, index) =>
    index > syntaxDescriptionIndex &&
    index < sectionEnd &&
    /^\s*command\s+history\b/i.test(line),
  )
  if (historyIndex < 0) return []
  let end = sectionEnd
  for (let index = historyIndex + 1; index < sectionEnd; index += 1) {
    if (/^\s*(?:usage\s+guidelines|examples?|related\s+commands)\b/i.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return lines
    .slice(historyIndex + 1, end)
    .join('\n')
    .split(/\n\s*\n/)
    .map(compact)
    .filter((line) => line.length >= 2)
    .slice(0, 30)
    .map((line) => `Documented release history: ${line}`.slice(0, 1_000))
}

function commandEvidence(
  content: string,
  lineIndex: number,
  structured: boolean,
): string {
  const lines = content.split('\n')
  const start = Math.max(0, lineIndex - 2)
  let end = Math.min(lines.length, lineIndex + (structured ? 30 : 7))
  if (structured) {
    const commandModeOffset = lines
      .slice(lineIndex + 1, end)
      .findIndex((line) => /^\s*command\s+modes?\s*$/i.test(line))
    if (commandModeOffset >= 0) end = lineIndex + 1 + commandModeOffset
  }
  return compact(lines.slice(start, end).join(' ')).slice(0, 600)
}

function commandSummary(
  content: string,
  lineIndex: number,
  command: string,
  readOnly: boolean,
  structured: boolean,
): string {
  const lines = content.split('\n')
  let descriptionStart = Math.max(0, lineIndex - 10)
  if (structured) {
    for (let index = lineIndex - 1; index >= descriptionStart; index -= 1) {
      if (/^\s*(?:syntax\s+description|command\s+modes?)\s*$/i.test(lines[index] ?? '')) {
        descriptionStart = index + 1
        break
      }
    }
  }
  let descriptionEnd = Math.min(lines.length, lineIndex + 9)
  if (!structured) {
    for (let index = lineIndex + 1; index < descriptionEnd; index += 1) {
      const line = normalizedCommandLine(lines[index] ?? '')
      if (
        commandStart.test(line) ||
        /^\s*(?:syntax\s+description|command\s+modes?)\s*$/i.test(lines[index] ?? '')
      ) {
        descriptionEnd = index
        break
      }
    }
  }
  const candidates = structured
    ? lines.slice(descriptionStart, lineIndex).reverse()
    : lines.slice(lineIndex + 1, descriptionEnd)
  const description = candidates.map(compact).find((line) =>
    line.length >= 12 &&
    !commandStart.test(line) &&
    !/^(?:syntax|description|purpose|usage|defaults?|command modes?|examples?)\s*:?$/i.test(line) &&
    /[.!?]$/.test(line),
  )
  if (description) return description.slice(0, 4_000)
  return readOnly
    ? `Use ${command} to inspect the documented operational state without changing configuration.`
    : `Use ${command} in the documented command context.`
}

function keyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function cliMode(
  content: string,
  syntaxDescriptionIndex?: number,
): string | undefined {
  if (syntaxDescriptionIndex !== undefined) {
    const lines = content.split('\n')
    const end = structuredSectionEnd(lines, syntaxDescriptionIndex)
    const scoped = lines.slice(syntaxDescriptionIndex, end).join('\n')
    return cliMode(scoped)
  }
  if (/privileged\s+exec/i.test(content)) return 'privileged_exec'
  if (/user\s+exec/i.test(content)) return 'user_exec'
  if (/interface\s+configuration/i.test(content)) {
    return 'interface_configuration'
  }
  if (/global\s+configuration|configuration\s+mode/i.test(content)) {
    return 'global_configuration'
  }
  return undefined
}

export const networkCommandReferenceExtractor:
  DeterministicExtractor<NetworkKnowledgeCandidate> = {
    id: 'network-command-reference-v1',
    max_fragments_per_batch: 100,
    supports(input) {
      return /(?:command|cli)[_-]?reference/i.test(
        input.source.document_type,
      )
    },
    extract(input) {
      const candidates:
        DeterministicExtractionResult<NetworkKnowledgeCandidate>['candidates'] =
        []
      const handled = new Set<string>()
      const vendor = input.context['vendor_slug']
      const operatingSystem = input.context['operating_system_slug']
      if (!vendor || !operatingSystem) {
        return { candidates, handled_fragment_ids: [] }
      }

      for (const fragment of input.fragments) {
        const extraction = commandLines(fragment.content)
        const commands = extraction.commands
        if (commands.length === 0) continue
        for (const extracted of commands) {
          const command = extracted.command
          const readOnly = readOnlyStart.test(command)
          const commandKey = keyPart(command)
          const hashSuffix = fragment.content_hash.slice(7, 19)
          const title = fragment.section_title && commands.length === 1
            ? compact(fragment.section_title).slice(0, 240)
            : `Use ${command}`.slice(0, 240)
          const evidence = commandEvidence(
            fragment.content,
            extracted.lineIndex,
            extracted.structured,
          )
          const syntaxOptions = structuredSyntaxOptions(
            fragment.content,
            extracted.syntaxDescriptionIndex,
          )
          const riskLevel = readOnly
            ? 'safe_read_only' as const
            : 'changes_config' as const
          candidates.push({
            fragment_id: fragment.id,
            ready_for_publication: extracted.structured,
            candidate: {
              stable_key:
                `${vendor}.${operatingSystem}.${commandKey}.${hashSuffix}`
                  .slice(0, 160),
              kind: readOnly ? 'diagnostic' : 'command',
              vendor_slug: vendor,
              operating_system_slug: operatingSystem,
              ...(input.context['platform_slug']
                ? { platform_slug: input.context['platform_slug'] }
                : {}),
              ...(input.context['version_min']
                ? { version_min: input.context['version_min'] }
                : {}),
              ...(input.context['version_max']
                ? { version_max: input.context['version_max'] }
                : {}),
              title,
              summary: commandSummary(
                fragment.content,
                extracted.lineIndex,
                command,
                readOnly,
                extracted.structured,
              ),
              ...(syntaxOptions.length > 0
                ? { syntax_options: syntaxOptions }
                : {}),
              question_patterns: [
                `How do I use ${command}?`.slice(0, 300),
                `What does ${command} do on ${operatingSystem}?`.slice(0, 300)
              ],
              ...(cliMode(fragment.content, extracted.syntaxDescriptionIndex)
                ? { cli_mode: cliMode(
                    fragment.content,
                    extracted.syntaxDescriptionIndex,
                  ) }
                : {}),
              command,
              procedure: [],
              prerequisites: readOnly
                ? []
                : ['Capture the affected running configuration before making the change.'],
              risks: readOnly
                ? []
                : ['This command can change device configuration or service behaviour.'],
              verification: [
                readOnly
                  ? 'Confirm the command is accepted in the documented CLI mode and returns the expected operational output.'
                  : 'Compare the affected running configuration and operational state with the captured pre-change baseline.'
              ],
              rollback: readOnly
                ? []
                : ['Restore the captured pre-change configuration for the affected feature and verify the original operational state.'],
              limitations: [
                'Applicability is limited to the vendor, operating system, model and version scope attached to this source.',
                ...structuredReleaseHistory(
                  fragment.content,
                  extracted.syntaxDescriptionIndex,
                )
              ].slice(0, 30),
              dangerous: !readOnly,
              risk_level: riskLevel,
              confidence: readOnly ? 0.94 : 0.95,
              quality_score: 0.9,
              confidence_reason:
                'Deterministically extracted and schema-validated from a structured official command-reference section.',
              last_verified_at: input.verified_at,
              provenance: [{
                url: input.source.canonical_url,
                document_type: input.source.document_type,
                title: input.source.title.slice(0, 240),
                ...(input.source.document_version
                  ? { document_version: input.source.document_version }
                  : {}),
                ...(input.source.document_date
                  ? { document_date: input.source.document_date }
                  : {}),
                verified_at: input.verified_at,
                content_hash: fragment.content_hash,
                evidence_fragment: evidence,
                evidence_role: 'primary'
              }]
            }
          })
        }
        if (extraction.fullyStructured) {
          handled.add(fragment.id)
        }
      }
      return {
        candidates,
        handled_fragment_ids: [...handled]
      }
    }
  }
