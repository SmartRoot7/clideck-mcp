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

const destructiveRules: Array<[RegExp, string]> = [
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

function operationalGuidanceForRules(
  rules: string[],
  hasUnknownCommands: boolean,
): string[] {
  const guidance = new Set<string>()
  for (const rule of rules) {
    switch (rule) {
      case 'erase_startup_configuration':
        guidance.add(
          'Erases the saved startup configuration. The current running configuration may remain in memory until a reload; confirm the exact platform behavior before use.',
        )
        break
      case 'format_device_storage':
        guidance.add(
          'Formats device storage and can remove software images, packages, logs, and recovery files stored on that filesystem.',
        )
        break
      case 'zeroize_crypto_keys':
        guidance.add(
          'Removes cryptographic key material. Services that depend on those keys can fail until keys and trust relationships are recreated.',
        )
        break
      case 'disable_aaa':
        guidance.add(
          'Changes the authentication model and can remove working remote-access paths. Verify console access and the resulting login method first.',
        )
        break
      case 'factory_reset':
        guidance.add(
          'Returns the device toward its factory state and can remove configuration, identity, and management access.',
        )
        break
      case 'device_reload':
        guidance.add(
          'Restarts the device or stack, interrupts forwarding, and applies the saved boot configuration and software state.',
        )
        break
      case 'software_install':
        guidance.add(
          'Changes the installed software state and may require activation, commit, and reload steps that are specific to the platform and release.',
        )
        break
      default:
        break
    }
  }
  if (hasUnknownCommands) {
    guidance.add(
      'At least one command was not recognized by the deterministic rule set. Its meaning was not inferred; use the returned command text to confirm syntax and platform applicability.',
    )
  }
  if (guidance.size === 0) {
    guidance.add(
      'The review classifies operational risk and supplies checks without withholding the requested command or procedure.',
    )
  }
  return [...guidance]
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
  let destructive = false
  let high = false
  let medium = false
  let hasWrite = false

  for (const line of lines) {
    const destructiveMatch = destructiveRules.find(([pattern]) =>
      pattern.test(line)
    )
    if (destructiveMatch) {
      destructive = true
      hasWrite = true
      matchedRules.add(destructiveMatch[1])
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
    high = true
    hasWrite = true
    blastRadius.add('unknown_scope')
    unknownCommands.push(
      sanitizeSnapshot(line.slice(0, 240), 'secrets_only').sanitized,
    )
  }

  const riskLevel = destructive || high
    ? 'high' as const
    : medium || hasWrite
      ? 'medium' as const
      : 'low' as const
  const decision = 'allowed_with_checks' as const
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
    'Confirm the exact device model and operating-system version.',
    'Capture the relevant before-state output.',
    'Confirm an independent management or console path is available.',
    ...(hasWrite ? ['Confirm a current configuration backup and maintenance approval.'] : []),
    ...(destructive
      ? [
          'Confirm the restore source and recovery procedure before applying the command.',
          'Record the current boot, storage, configuration, identity, and access state that the command can remove or interrupt.'
        ]
      : [])
  ]
  const stopConditions = [
    'Stop if the device context or version does not match the review.',
    'Stop on unexpected parser output, loss of management access, or new critical logs.',
    ...(unknownCommands.length > 0
      ? [
          'Confirm the syntax and platform applicability of every unrecognized command before applying it.'
        ]
      : [])
  ]

  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
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
  const verificationToken = signPayload(
    payload as unknown as Record<string, unknown>,
    config.verificationSigningKey,
  )

  return {
    decision,
    risk_level: riskLevel,
    blast_radius: [...blastRadius],
    matched_rules: rules,
    unknown_commands: unknownCommands,
    operational_guidance: operationalGuidanceForRules(
      rules,
      unknownCommands.length > 0,
    ),
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
      'Risk classification never hides documentation or prevents verification.',
      'Command-specific recognition is strongest for Cisco IOS-XE; unrecognized syntax receives conservative checks.'
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
