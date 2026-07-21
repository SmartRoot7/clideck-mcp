import type { CandidateKnowledge } from './publication.js'

export type KnowledgeRiskLevel =
  | 'safe_read_only'
  | 'changes_config'
  | 'credential_sensitive'
  | 'service_disruptive'
  | 'data_loss'
  | 'storage_wipe'
  | 'firmware_change'
  | 'boot_change'
  | 'factory_reset'
  | 'unknown'

const riskPriority: Record<KnowledgeRiskLevel, number> = {
  safe_read_only: 0,
  changes_config: 2,
  credential_sensitive: 5,
  service_disruptive: 6,
  data_loss: 7,
  storage_wipe: 8,
  firmware_change: 6,
  boot_change: 7,
  factory_reset: 9,
  unknown: 4
}

function isDeterministicReadOnlyCommand(line: string): boolean {
  if (
    /^(?:show|display|ping|traceroute|tracert|terminal length|dir|more|verify)\b/i
      .test(line)
  ) return true
  if (/^(?:onie-sysinfo|uname|uptime)(?:\s|$)/i.test(line)) return true
  if (/^nv\s+show\b/i.test(line)) return true
  if (
    /^networkctl(?:\s+(?:list|status|lldp|label)(?:\s|$)|\s*$)/i.test(line)
  ) {
    return true
  }
  if (/^swconfig\s+dev\s+\S+\s+show(?:\s|$)/i.test(line)) return true
  if (
    /^ip(?:\s+-\S+)*\s+(?:link|address|addr|route|neighbor|neigh|rule)\s+(?:show|list)(?:\s|$)/i
      .test(line)
  ) return true
  if (
    /^ethtool(?:\s+(?:-[aAdgiklmnpST]|--show-[a-z-]+))*\s+\S+(?:\s|$)/i
      .test(line) &&
    !/\s(?:-s|--change|--set-[a-z-]+)\b/i.test(line)
  ) return true
  return false
}

export function classifyKnowledgeRisk(
  lines: string[],
): KnowledgeRiskLevel {
  if (lines.length === 0) return 'safe_read_only'
  const operationalLines = lines
    .flatMap((line) => line.split(/\r?\n/))
    .map((line) => line.replace(/^[+-]\s?/, '').trim())
    .filter(Boolean)
  if (
    operationalLines.length > 0 &&
    operationalLines.every(isDeterministicReadOnlyCommand)
  ) {
    return 'safe_read_only'
  }

  const text = operationalLines.join('\n')
  if (/\b(?:factory[- ]reset|write erase|erase\s+startup-config)\b/i.test(text)) {
    return 'factory_reset'
  }
  if (/\bformat\s+(?:flash|bootflash|nvram)\b/i.test(text)) {
    return 'storage_wipe'
  }
  if (/\b(?:delete|erase)\s+(?:flash|bootflash|nvram):/i.test(text)) {
    return 'data_loss'
  }
  if (/\b(?:crypto key zeroize|no\s+aaa\s+new-model)\b/i.test(text)) {
    return 'credential_sensitive'
  }
  if (/\bboot system\b/i.test(text)) return 'boot_change'
  if (/\binstall\s+(?:add|activate|commit|remove)\b/i.test(text)) {
    return 'firmware_change'
  }
  if (/\breload\b/i.test(text)) return 'service_disruptive'

  if (
    operationalLines.some((line) =>
      /^(?:configure terminal|interface\b|router\b|ip route\b|access-list\b|vlan\b|spanning-tree\b|no\b|shutdown\b|snmp-server\b|ntp\b|logging\b)/i
        .test(line),
    )
  ) {
    return 'changes_config'
  }
  return 'unknown'
}

export function escalateKnowledgeRisk(
  declared: KnowledgeRiskLevel,
  lines: string[],
): KnowledgeRiskLevel {
  const deterministic = classifyKnowledgeRisk(lines)
  return riskPriority[deterministic] > riskPriority[declared]
    ? deterministic
    : declared
}

export function enforceKnowledgeRisk(
  candidate: CandidateKnowledge,
): CandidateKnowledge {
  const lines = [
    ...(candidate.command ? [candidate.command] : []),
    ...candidate.procedure
  ]
  const deterministic = classifyKnowledgeRisk(lines)
  const declared = candidate.risk_level ?? (
    candidate.dangerous ? 'changes_config' : 'safe_read_only'
  )
  const riskLevel = escalateKnowledgeRisk(declared, lines)
  const dangerous =
    candidate.dangerous ||
    deterministic !== 'safe_read_only' ||
    riskLevel !== 'safe_read_only'
  const escalated =
    dangerous !== candidate.dangerous ||
    riskLevel !== candidate.risk_level
  return {
    ...candidate,
    dangerous,
    risk_level: riskLevel,
    risks: escalated
      ? [
          ...candidate.risks,
          `Deterministic safety classifier enforced risk level ${riskLevel}.`
        ].slice(0, 30)
      : candidate.risks
  }
}
