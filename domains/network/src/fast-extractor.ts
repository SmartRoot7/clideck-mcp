import type {
  DeterministicExtractionInput,
  DeterministicExtractionResult,
  DeterministicExtractor
} from '@clideck/domain-kit'

import type { NetworkKnowledgeCandidate } from './schemas.js'

const commandStart = /^(?:no\s+)?(?:show|display|ping|traceroute|traceroute6|verify|dir|more|less|terminal|configure|interface|router|switchport|spanning-tree|ip|ipv6|aaa|bfd|bgp|ospf|isis|eigrp|route-map|policy-map|class-map|logging|snmp-server|crypto|username|monitor|copy|clear|debug|reload|install|boot|erase|delete|format)\b/i
const readOnlyStart = /^(?:show|display|ping|traceroute|traceroute6|verify|dir|more|less|terminal\s+(?:length|width|monitor))\b/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function commandLines(value: string): string[] {
  const commands: string[] = []
  const seen = new Set<string>()
  for (const rawLine of value.split('\n')) {
    const line = compact(
      rawLine
        .replace(/^[•*]\s*/, '')
        .replace(/^\d+[.)]\s+/, ''),
    )
    if (
      line.length < 3 ||
      line.length > 300 ||
      !commandStart.test(line) ||
      /[.!?]$/.test(line) ||
      /\b(?:example|purpose|description|syntax)\s*:/i.test(line)
    ) {
      continue
    }
    const normalized = line.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    commands.push(line)
    if (commands.length >= 10) break
  }
  return commands
}

function keyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function cliMode(content: string): string | undefined {
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
        const commands = commandLines(fragment.content)
        if (commands.length === 0) continue
        for (const command of commands) {
          const readOnly = readOnlyStart.test(command)
          const commandKey = keyPart(command)
          const hashSuffix = fragment.content_hash.slice(7, 19)
          const title = fragment.section_title
            ? compact(fragment.section_title).slice(0, 240)
            : `Use ${command}`.slice(0, 240)
          const evidence = compact(fragment.content).slice(0, 600)
          const riskLevel = readOnly
            ? 'safe_read_only' as const
            : 'changes_config' as const
          candidates.push({
            fragment_id: fragment.id,
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
              summary: readOnly
                ? `Use ${command} to inspect the documented operational state without changing configuration.`
                : `Use ${command} only in the documented configuration context after capturing the current state.`,
              question_patterns: [
                `How do I use ${command}?`.slice(0, 300),
                `What does ${command} do on ${operatingSystem}?`.slice(0, 300)
              ],
              ...(cliMode(fragment.content)
                ? { cli_mode: cliMode(fragment.content) }
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
                'Applicability is limited to the vendor, operating system, model and version scope attached to this source.'
              ],
              dangerous: !readOnly,
              risk_level: riskLevel,
              confidence: readOnly ? 0.94 : 0.95,
              quality_score: 0.9,
              confidence_reason:
                'Deterministically extracted from a structured official command-reference section and queued for independent Luna verification.',
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
        handled.add(fragment.id)
      }
      return {
        candidates,
        handled_fragment_ids: [...handled]
      }
    }
  }
