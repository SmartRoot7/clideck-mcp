import type { AppConfig } from '../config.js'
import { sha256Label, signPayload, verifySignedPayload } from '../crypto.js'
import type { NetworkContextInput } from './schemas.js'
import { sanitizeSnapshot } from './snapshot.js'

type CheckKind = 'no_critical_errors' | 'output_changed' | 'regex'

type VerificationCheck = {
  id: string
  description: string
  required: boolean
  kind: CheckKind
  pattern?: string
}

type VerificationPayload = {
  version: 1
  expires_at: string
  change_digest: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  checks: VerificationCheck[]
  rollback: string[]
}

const criticalRules: Array<[RegExp, string]> = [
  [/\bwrite erase\b/i, 'erase_startup_configuration'],
  [/\berase\s+(?:startup-config|nvram:)/i, 'erase_startup_configuration'],
  [/\bformat\s+(?:flash|bootflash|nvram)/i, 'format_device_storage'],
  [/\bcrypto key zeroize\b/i, 'zeroize_crypto_keys'],
  [/\bno\s+aaa\s+new-model\b/i, 'disable_aaa'],
  [/\bfactory[- ]reset\b/i, 'factory_reset'],
  [/\breload\b/i, 'device_reload']
]

const highRules: Array<[RegExp, string, string]> = [
  [/\b(?:no\s+)?shutdown\b/i, 'interface_state_change', 'local_device'],
  [/^(?:no\s+)?router\s+(?:bgp|ospf|isis|eigrp)\b/i, 'routing_process_change', 'control_plane'],
  [/^(?:no\s+)?ip route\b/i, 'static_route_change', 'data_plane'],
  [/^(?:(?:no\s+)?ip access-(?:group|list)|access-list)\b/i, 'acl_change', 'data_plane'],
  [/^(?:no\s+)?spanning-tree\b/i, 'spanning_tree_change', 'layer_2_domain'],
  [/^(?:no\s+)?vlan\s+\d+/i, 'vlan_change', 'layer_2_domain'],
  [/\binstall\s+(?:add|activate|commit|remove)\b/i, 'software_install', 'device_or_stack'],
  [/\bboot system\b/i, 'boot_variable_change', 'device_or_stack']
]

const mediumRules: Array<[RegExp, string, string]> = [
  [/\bdescription\b/i, 'interface_description_change', 'local_interface'],
  [/\blogging\b/i, 'logging_change', 'observability'],
  [/\bntp\b/i, 'ntp_change', 'time_synchronization'],
  [/\bsnmp-server\b/i, 'snmp_change', 'management_plane']
]

function normalizedChangeLines(input: {
  commands?: string[] | undefined
  config_diff?: string | undefined
}): string[] {
  const lines = [
    ...(input.commands ?? []).flatMap((command) =>
      command.split(/\r\n|[\n\r\u0085\u2028\u2029]/u),
    ),
    ...(input.config_diff?.split(/\r\n|[\n\r\u0085\u2028\u2029]/u) ?? [])
  ]
  return lines
    .map((line) => line.replace(/^[+-]\s?/, '').trim())
    .filter((line) => line && !line.startsWith('!') && !line.startsWith('#'))
}

function verificationChecksForRules(rules: string[]): VerificationCheck[] {
  const checks: VerificationCheck[] = [{
    id: 'no_critical_errors',
    description: 'The after snapshot contains no critical platform error markers.',
    required: true,
    kind: 'no_critical_errors'
  }]
  if (rules.some((rule) => rule !== 'read_only_operation')) {
    checks.push({
      id: 'output_changed',
      description: 'The relevant before and after snapshots are not identical.',
      required: true,
      kind: 'output_changed'
    })
  }
  if (rules.includes('interface_state_change')) {
    checks.push({
      id: 'interface_state',
      description: 'The after snapshot contains a recognized interface state.',
      required: true,
      kind: 'regex',
      pattern: '\\b(?:up\\s+up|administratively down|down\\s+down)\\b'
    })
  }
  if (rules.includes('routing_process_change') || rules.includes('static_route_change')) {
    checks.push({
      id: 'routing_state',
      description: 'The after snapshot contains a recognized routing state.',
      required: true,
      kind: 'regex',
      pattern: '\\b(?:Routing entry for|Known via|via\\s+\\d{1,3}(?:\\.\\d{1,3}){3}|Codes:)\\b'
    })
  }
  if (rules.includes('acl_change')) {
    checks.push({
      id: 'acl_state',
      description: 'The after snapshot contains the expected ACL inventory.',
      required: true,
      kind: 'regex',
      pattern: '\\b(?:Extended|Standard) IP access list\\b'
    })
  }
  return checks
}

export function reviewNetworkChange(
  config: AppConfig,
  input: {
    intent: string
    context: NetworkContextInput
    commands?: string[] | undefined
    config_diff?: string | undefined
  },
) {
  const lines = normalizedChangeLines(input)
  const matchedRules = new Set<string>()
  const blastRadius = new Set<string>()
  const unknownCommands: string[] = []
  let critical = false
  let high = false
  let medium = false
  let hasWrite = false

  for (const line of lines) {
    const criticalMatch = criticalRules.find(([pattern]) => pattern.test(line))
    if (criticalMatch) {
      critical = true
      hasWrite = true
      matchedRules.add(criticalMatch[1])
      blastRadius.add('device_or_stack')
      continue
    }
    const highMatch = highRules.find(([pattern]) => pattern.test(line))
    if (highMatch) {
      high = true
      hasWrite = true
      matchedRules.add(highMatch[1])
      blastRadius.add(highMatch[2])
      continue
    }
    const mediumMatch = mediumRules.find(([pattern]) => pattern.test(line))
    if (mediumMatch) {
      medium = true
      hasWrite = true
      matchedRules.add(mediumMatch[1])
      blastRadius.add(mediumMatch[2])
      continue
    }
    if (/^(?:show|ping|traceroute|terminal length|dir|more)\b/i.test(line)) {
      matchedRules.add('read_only_operation')
      continue
    }
    if (/^(?:configure terminal|end|exit|interface\s+\S+)/i.test(line)) {
      hasWrite = true
      matchedRules.add('configuration_context')
      blastRadius.add('local_device')
      continue
    }
    unknownCommands.push(
      sanitizeSnapshot(line.slice(0, 240), 'secrets_only').sanitized,
    )
  }

  const riskLevel = critical
    ? 'critical' as const
    : high
      ? 'high' as const
      : medium || hasWrite
        ? 'medium' as const
        : 'low' as const
  const decision = critical
    ? 'blocked' as const
    : unknownCommands.length > 0
      ? 'unknown' as const
      : high
        ? 'manual_review_required' as const
        : 'allowed_with_checks' as const
  const rules = [...matchedRules]
  const checks = verificationChecksForRules(rules)
  const rollback = hasWrite
    ? [
        'Do not save the configuration until all required checks pass.',
        'Apply the revision-specific reverse change from the approved change record.',
        'If service is not restored, stop and escalate instead of attempting additional unreviewed commands.'
      ]
    : ['No configuration change is expected; rollback is not applicable.']
  const prechecks = [
    'Confirm the exact device model and IOS-XE version.',
    'Capture the relevant before-state output.',
    'Confirm an independent management or console path is available.',
    ...(hasWrite ? ['Confirm a current configuration backup and maintenance approval.'] : [])
  ]
  const stopConditions = [
    'Stop if the device context or version does not match the review.',
    'Stop on unexpected parser output, loss of management access, or new critical logs.',
    ...(unknownCommands.length > 0
      ? ['Stop until every unknown command has been independently reviewed.']
      : [])
  ]

  let verificationToken: string | null = null
  let expiresAt: string | null = null
  if (!critical && unknownCommands.length === 0) {
    expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const payload: VerificationPayload = {
      version: 1,
      expires_at: expiresAt,
      change_digest: sha256Label(
        JSON.stringify({
          intent: input.intent,
          context: input.context,
          lines
        }),
      ),
      risk_level: riskLevel,
      checks,
      rollback
    }
    verificationToken = signPayload(
      payload as unknown as Record<string, unknown>,
      config.verificationSigningKey,
    )
  }

  return {
    decision,
    risk_level: riskLevel,
    blast_radius: [...blastRadius],
    matched_rules: rules,
    unknown_commands: unknownCommands,
    prechecks,
    stop_conditions: stopConditions,
    verification_plan: checks.map(({ id, description, required }) => ({
      id,
      description,
      required
    })),
    rollback,
    approval_required: hasWrite || unknownCommands.length > 0,
    verification_token: verificationToken,
    verification_token_expires_at: expiresAt,
    limitations: [
      'This is a deterministic advisory review and does not execute commands.',
      'A manual approval remains mandatory for configuration-changing operations.'
    ]
  }
}

function parseVerificationPayload(
  token: string,
  key: string,
): VerificationPayload {
  const parsed = verifySignedPayload(token, key)
  if (
    parsed['version'] !== 1 ||
    typeof parsed['expires_at'] !== 'string' ||
    typeof parsed['change_digest'] !== 'string' ||
    !Array.isArray(parsed['checks']) ||
    !Array.isArray(parsed['rollback'])
  ) {
    throw new Error('VERIFICATION_TOKEN_INVALID')
  }
  if (Date.parse(parsed['expires_at']) <= Date.now()) {
    throw new Error('VERIFICATION_TOKEN_EXPIRED')
  }
  return parsed as unknown as VerificationPayload
}

export function verifyNetworkChange(
  config: AppConfig,
  input: {
    verification_token: string
    before_snapshot: string
    after_snapshot: string
  },
) {
  const payload = parseVerificationPayload(
    input.verification_token,
    config.verificationSigningKey,
  )
  const before = sanitizeSnapshot(input.before_snapshot, 'secrets_only').sanitized
  const after = sanitizeSnapshot(input.after_snapshot, 'secrets_only').sanitized

  const checks = payload.checks.map((check) => {
    if (check.kind === 'no_critical_errors') {
      const criticalPattern =
        /%[A-Z0-9_-]+-[012]-|Traceback|CRASHED|FAILED|fatal error/i
      const failed = criticalPattern.test(after)
      return {
        id: check.id,
        description: check.description,
        status: failed ? 'failed' as const : 'passed' as const,
        evidence: failed
          ? 'A critical error marker was found in the sanitized after snapshot.'
          : 'No critical error marker was found in the sanitized after snapshot.'
      }
    }
    if (!after.trim()) {
      return {
        id: check.id,
        description: check.description,
        status: 'indeterminate' as const,
        evidence: 'The after snapshot is empty.'
      }
    }
    if (check.kind === 'output_changed') {
      const changed = sha256Label(before) !== sha256Label(after)
      return {
        id: check.id,
        description: check.description,
        status: changed ? 'passed' as const : 'failed' as const,
        evidence: changed
          ? 'The sanitized before and after snapshots differ.'
          : 'The sanitized before and after snapshots are identical.'
      }
    }
    if (check.kind === 'regex' && check.pattern) {
      const matched = new RegExp(check.pattern, 'i').test(after)
      return {
        id: check.id,
        description: check.description,
        status: matched ? 'passed' as const : 'indeterminate' as const,
        evidence: matched
          ? 'The required normalized state marker was found.'
          : 'The required normalized state marker was not found.'
      }
    }
    return {
      id: check.id,
      description: check.description,
      status: 'indeterminate' as const,
      evidence: 'The verification rule is not supported by this parser.'
    }
  })

  const failed = checks.some((check) => check.status === 'failed')
  const indeterminate = checks.filter(
    (check) => check.status === 'indeterminate',
  ).length
  const passed = checks.filter((check) => check.status === 'passed').length
  const result = failed
    ? 'failed' as const
    : indeterminate === 0
      ? 'passed' as const
      : passed > 0
        ? 'partial' as const
        : 'indeterminate' as const

  return {
    result,
    checks,
    rollback_recommended: failed,
    next_action: failed
      ? 'Stop the change and follow the approved rollback procedure.'
      : result === 'passed'
        ? 'Record the successful checks and complete the change record.'
        : 'Collect the missing required output; do not declare success yet.',
    retention: 'not_stored' as const
  }
}
