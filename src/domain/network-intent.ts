export const networkRuntimeModes = [
  'normal',
  'rescue',
  'installer',
  'update',
  'uninstall',
  'recovery',
  'diagnostic'
] as const

export type NetworkRuntimeMode = (typeof networkRuntimeModes)[number]

const runtimeModeAliases: Readonly<Record<string, NetworkRuntimeMode>> = {
  diag: 'diagnostic',
  diagnostic: 'diagnostic',
  install: 'installer',
  installer: 'installer',
  recovery: 'recovery',
  rescue: 'rescue',
  uninstall: 'uninstall',
  update: 'update'
}

const shellAliases: Readonly<Record<string, string>> = {
  busybox: 'BusyBox',
  bash: 'Bash',
  ash: 'BusyBox ash'
}

function normalizedWords(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9._-]+/g, ''))
    .filter(Boolean)
}

function normalizedRuntimeMode(value: string | undefined): NetworkRuntimeMode | null {
  if (!value) return null
  const direct = runtimeModeAliases[value.trim().toLowerCase()]
  if (direct) return direct
  for (const word of normalizedWords(value)) {
    const matched = runtimeModeAliases[word.toLowerCase()]
    if (matched) return matched
  }
  return null
}

export function normalizeOperatingSystemIntent(input: {
  operatingSystem?: string
  runtimeMode?: string
  shellEnvironment?: string
}): {
  familyRequest?: string
  runtimeMode: NetworkRuntimeMode | null
  shellEnvironment: string | null
} {
  const words = normalizedWords(input.operatingSystem ?? '')
  let runtimeMode = normalizedRuntimeMode(input.runtimeMode)
  let shellEnvironment = input.shellEnvironment?.trim() || null

  const retained: string[] = []
  for (const word of words) {
    const normalized = word.toLowerCase()
    if (!runtimeMode && runtimeModeAliases[normalized]) {
      runtimeMode = runtimeModeAliases[normalized]
      continue
    }
    if (runtimeMode && normalized === 'mode') continue
    if (!shellEnvironment && shellAliases[normalized]) {
      shellEnvironment = shellAliases[normalized]
      continue
    }
    retained.push(word)
  }

  return {
    ...(retained.length > 0
      ? { familyRequest: retained.join(' ') }
      : input.operatingSystem
        ? { familyRequest: input.operatingSystem }
        : {}),
    runtimeMode,
    shellEnvironment
  }
}

export type NetworkQuestionPart = {
  capability: string
  label: string
  query: string
}

const capabilityPatterns: ReadonlyArray<{
  capability: string
  label: string
  pattern: RegExp
  query: string
}> = [
  {
    capability: 'system-reboot',
    label: 'System reboot',
    pattern: /\b(?:reboot|reload|restart|перезагруз)/i,
    query: 'reboot restart system safely'
  },
  {
    capability: 'ip-configuration',
    label: 'IP configuration',
    pattern: /\b(?:static\s+ip|ip\s+address|address\s+eth|ifconfig|настро(?:ить|йка)\s+ip)/i,
    query: 'configure temporary IP address interface netmask gateway'
  },
  {
    capability: 'arp-diagnostics',
    label: 'ARP diagnostics',
    pattern: /\barp\b|address resolution/i,
    query: 'inspect ARP neighbor resolution diagnostics'
  },
  {
    capability: 'interface-counters',
    label: 'Interface counters',
    pattern: /\b(?:rx|tx|counter|packet|drop|error|ошибк|сч[её]тчик)/i,
    query: 'inspect interface RX TX packet error counters'
  },
  {
    capability: 'tftp-transfer',
    label: 'TFTP transfer',
    pattern: /\btftp\b/i,
    query: 'TFTP get download file BusyBox client'
  },
  {
    capability: 'boot-behavior',
    label: 'Boot behavior',
    pattern: /\b(?:boot|booting|startup|загруз)/i,
    query: 'boot mode rescue installer behavior'
  },
  {
    capability: 'vlan-trunk',
    label: 'VLAN trunk',
    pattern: /\b(?:vlan|trunk)\b/i,
    query: 'VLAN trunk configuration verification rollback'
  },
  {
    capability: 'port-security',
    label: 'Port security',
    pattern: /\b(?:port[- ]security|err[- ]disable|bpdu\s*guard)\b/i,
    query: 'port security err-disable diagnosis recovery'
  }
]

export function decomposeNetworkQuestion(question: string): NetworkQuestionPart[] {
  const parts = capabilityPatterns
    .filter((candidate) => candidate.pattern.test(question))
    .map(({ capability, label, query }) => ({ capability, label, query }))
  if (parts.length > 0) return parts.slice(0, 8)
  return [{
    capability: 'general',
    label: 'Requested operation',
    query: question
  }]
}

export function normalizeTopicSlug(value: string | null | undefined): string {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return normalized && normalized.length >= 2 ? normalized : 'unspecified'
}
