import { describe, expect, it } from 'vitest'

import {
  AFTER_SNAPSHOT,
  createInitialLabState,
  executeRecoveryCommands,
  labReducer,
  RECOVERY_COMMANDS,
  validateRecoveryCommands
} from './lab-state'

describe('WebMCP deterministic lab', () => {
  it('accepts only the complete ordered recovery sequence', () => {
    expect(validateRecoveryCommands(RECOVERY_COMMANDS)).toEqual(RECOVERY_COMMANDS)
    expect(() => validateRecoveryCommands([
      ...RECOVERY_COMMANDS.slice(0, 2),
      'reload',
      ...RECOVERY_COMMANDS.slice(3)
    ])).toThrow('UNSUPPORTED_SANDBOX_COMMAND_SEQUENCE')
    expect(() => validateRecoveryCommands([
      RECOVERY_COMMANDS[1],
      RECOVERY_COMMANDS[0],
      ...RECOVERY_COMMANDS.slice(2)
    ])).toThrow('UNSUPPORTED_SANDBOX_COMMAND_SEQUENCE')
  })

  it('requires human approval and leaves no partial state on failure', () => {
    expect(() => executeRecoveryCommands(
      'staged',
      RECOVERY_COMMANDS,
      RECOVERY_COMMANDS,
    )).toThrow('HUMAN_APPROVAL_REQUIRED')

    const requested: string[] = [...RECOVERY_COMMANDS]
    requested[2] = 'write erase'
    expect(() => executeRecoveryCommands(
      'approved',
      RECOVERY_COMMANDS,
      requested,
    )).toThrow('UNSUPPORTED_SANDBOX_COMMAND_SEQUENCE')

    expect(executeRecoveryCommands(
      'approved',
      RECOVERY_COMMANDS,
      RECOVERY_COMMANDS,
    )).toEqual({ interfaceState: 'up', afterSnapshot: AFTER_SNAPSHOT })
  })

  it('does not allow reducer transitions to skip the approval gate', () => {
    const initial = createInitialLabState()
    expect(labReducer(initial, { type: 'executed' })).toBe(initial)
    expect(labReducer(initial, {
      type: 'verified',
      result: 'passed',
      checks: []
    })).toBe(initial)
    expect(labReducer({ ...initial, phase: 'staged' }, { type: 'approved' }).phase)
      .toBe('approved')
    expect(labReducer({ ...initial, phase: 'verified' }, { type: 'reset' }))
      .toEqual(createInitialLabState())
  })
})
