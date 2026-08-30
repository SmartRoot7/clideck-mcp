export const LAB_DEVICE = {
  vendor: 'Cisco',
  model: 'C9300-48P',
  operatingSystem: 'IOS XE',
  version: '17.12.4',
  interfaceName: 'GigabitEthernet1/0/24'
} as const

export const RECOVERY_COMMANDS = [
  'configure terminal',
  `interface ${LAB_DEVICE.interfaceName}`,
  'shutdown',
  'no shutdown',
  'end'
] as const

export const BEFORE_SNAPSHOT = [
  'Cisco IOS XE Software, Version 17.12.4',
  'cisco C9300-48P processor',
  `${LAB_DEVICE.interfaceName} err-disabled down`,
  '%PM-4-ERR_DISABLE: psecure-violation error detected on Gi1/0/24, putting Gi1/0/24 in err-disable state',
  'Port Security              : Enabled',
  'Port Status                : Secure-shutdown',
  'Violation Mode             : Shutdown',
  'Last Source Address:Vlan   : 0011.2233.4455:20'
].join('\n')

export const AFTER_SNAPSHOT = [
  'Cisco IOS XE Software, Version 17.12.4',
  'cisco C9300-48P processor',
  `${LAB_DEVICE.interfaceName} up up`,
  'Port Security              : Enabled',
  'Port Status                : Secure-up',
  'Violation Mode             : Shutdown',
  'SecureStatic Address Aging : Disabled'
].join('\n')

export type LabPhase =
  | 'ready'
  | 'inspected'
  | 'guided'
  | 'staged'
  | 'approved'
  | 'executed'
  | 'verified'

export type TimelineEvent = {
  id: number
  kind: 'agent' | 'human' | 'system' | 'error'
  title: string
  detail: string
}

export type GuidanceReference = {
  revisionRef: string
  title: string
  kind: string
  confidence: number
  lastVerifiedAt: string
}

export type LabState = {
  phase: LabPhase
  interfaceState: 'err-disabled' | 'up'
  contextConfidence: number | null
  redactionCount: number
  guidance: GuidanceReference[]
  coverageStatus: 'unknown' | 'complete' | 'partial'
  stagedCommands: string[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | null
  prechecks: string[]
  rollback: string[]
  verificationToken: string | null
  verificationResult: 'passed' | 'failed' | 'partial' | 'indeterminate' | null
  verificationChecks: Array<{
    id: string
    status: 'passed' | 'failed' | 'indeterminate'
    evidence: string
  }>
  timeline: TimelineEvent[]
  nextEventId: number
}

export type LabAction =
  | { type: 'record'; kind: TimelineEvent['kind']; title: string; detail: string }
  | { type: 'inspected'; confidence: number; redactionCount: number }
  | { type: 'guided'; references: GuidanceReference[]; coverageStatus: LabState['coverageStatus'] }
  | {
      type: 'staged'
      commands: string[]
      riskLevel: NonNullable<LabState['riskLevel']>
      prechecks: string[]
      rollback: string[]
      verificationToken: string
    }
  | { type: 'approved' }
  | { type: 'executed' }
  | {
      type: 'verified'
      result: NonNullable<LabState['verificationResult']>
      checks: LabState['verificationChecks']
    }
  | { type: 'reset' }

export function createInitialLabState(): LabState {
  return {
    phase: 'ready',
    interfaceState: 'err-disabled',
    contextConfidence: null,
    redactionCount: 0,
    guidance: [],
    coverageStatus: 'unknown',
    stagedCommands: [],
    riskLevel: null,
    prechecks: [],
    rollback: [],
    verificationToken: null,
    verificationResult: null,
    verificationChecks: [],
    timeline: [{
      id: 1,
      kind: 'system',
      title: 'Sandbox ready',
      detail: 'Gi1/0/24 is err-disabled after a simulated port-security violation.'
    }],
    nextEventId: 2
  }
}

function appendEvent(
  state: LabState,
  kind: TimelineEvent['kind'],
  title: string,
  detail: string,
): LabState {
  return {
    ...state,
    timeline: [...state.timeline, {
      id: state.nextEventId,
      kind,
      title,
      detail
    }],
    nextEventId: state.nextEventId + 1
  }
}

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'record':
      return appendEvent(state, action.kind, action.title, action.detail)
    case 'inspected':
      if (state.phase !== 'ready') return state
      return appendEvent({
        ...state,
        phase: 'inspected',
        contextConfidence: action.confidence,
        redactionCount: action.redactionCount
      }, 'agent', 'Device inspected', 'CliDeck detected C9300-48P · IOS XE 17.12.4 and sanitized the snapshot.')
    case 'guided':
      if (state.phase !== 'inspected') return state
      return appendEvent({
        ...state,
        phase: 'guided',
        guidance: action.references,
        coverageStatus: action.coverageStatus
      }, 'agent', 'Guidance found', `${action.references.length} active knowledge reference${action.references.length === 1 ? '' : 's'} matched the incident.`)
    case 'staged':
      if (state.phase !== 'guided') return state
      return appendEvent({
        ...state,
        phase: 'staged',
        stagedCommands: [...action.commands],
        riskLevel: action.riskLevel,
        prechecks: [...action.prechecks],
        rollback: [...action.rollback],
        verificationToken: action.verificationToken
      }, 'agent', 'Change staged', `${action.commands.length} sandbox commands reviewed as ${action.riskLevel} risk. Human approval is required.`)
    case 'approved':
      if (state.phase !== 'staged') return state
      return appendEvent({ ...state, phase: 'approved' }, 'human', 'Sandbox change approved', 'The operator reviewed the commands and unlocked sandbox execution.')
    case 'executed':
      if (state.phase !== 'approved') return state
      return appendEvent({
        ...state,
        phase: 'executed',
        interfaceState: 'up'
      }, 'agent', 'Commands executed in simulator', 'The exact staged sequence ran atomically. Gi1/0/24 is now up/up.')
    case 'verified':
      if (state.phase !== 'executed') return state
      return appendEvent({
        ...state,
        phase: 'verified',
        verificationResult: action.result,
        verificationChecks: [...action.checks]
      }, 'agent', 'Change verified', `Signed verification result: ${action.result}.`)
    case 'reset':
      return createInitialLabState()
  }
}

export function validateRecoveryCommands(commands: readonly string[]): string[] {
  const normalized = commands.map((command) => command.trim())
  if (
    normalized.length !== RECOVERY_COMMANDS.length ||
    normalized.some((command, index) => command !== RECOVERY_COMMANDS[index])
  ) {
    throw new Error('UNSUPPORTED_SANDBOX_COMMAND_SEQUENCE')
  }
  return normalized
}

export function executeRecoveryCommands(
  phase: LabPhase,
  stagedCommands: readonly string[],
  requestedCommands: readonly string[],
): { interfaceState: 'up'; afterSnapshot: string } {
  if (phase !== 'approved') throw new Error('HUMAN_APPROVAL_REQUIRED')
  const staged = validateRecoveryCommands(stagedCommands)
  const requested = validateRecoveryCommands(requestedCommands)
  if (requested.some((command, index) => command !== staged[index])) {
    throw new Error('COMMANDS_DO_NOT_MATCH_APPROVED_CHANGE')
  }
  return { interfaceState: 'up', afterSnapshot: AFTER_SNAPSHOT }
}
