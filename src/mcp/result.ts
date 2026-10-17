import { z } from 'zod'

import { isTransientDatabaseError } from '../db.js'

export function textAndStructured<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value
  }
}

const publicErrors: Record<string, string> = {
  NETWORK_CONTEXT_VENDOR_NOT_RESOLVED:
    'Vendor could not be resolved. Provide an explicit vendor name.',
  NETWORK_CONTEXT_OS_NOT_RESOLVED:
    'Operating system could not be resolved. Provide an explicit OS name.',
  EXPERT_TASK_NOT_FOUND:
    'Expert task was not found, expired, or the access credentials are invalid.',
  EXPERT_TASK_NOT_WAITING_FOR_INPUT:
    'Expert task is not waiting for additional input.',
  KNOWLEDGE_REVISION_NOT_FOUND:
    'The referenced active knowledge revision was not found.',
  VERIFICATION_TOKEN_INVALID:
    'The verification handle is invalid or has been altered.',
  VERIFICATION_TOKEN_EXPIRED:
    'The verification handle has expired. Review the change again.',
  RATE_LIMITED:
    'The privacy-preserving contribution limit has been reached.'
}

export function publicToolError(error: unknown) {
  if (error instanceof z.ZodError) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text:
          'INVALID_DOMAIN_CONTEXT: Context does not match the selected domain schema.'
      }]
    }
  }
  if (
    error instanceof Error &&
    error.message.startsWith('DOMAIN_PACK_NOT_FOUND:')
  ) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: 'UNKNOWN_DOMAIN: The requested knowledge domain is not installed.'
      }]
    }
  }
  if (
    error instanceof Error &&
    (
      error.message.startsWith('DOMAIN_PACK_NOT_ENABLED:') ||
      error.message.startsWith('DOMAIN_PACK_CATALOG_VERSION_MISMATCH:')
    )
  ) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text:
          'DOMAIN_UNAVAILABLE: The requested knowledge domain is disabled or incompatible.'
      }]
    }
  }
  const retryable = isTransientDatabaseError(error)
  const code = retryable
    ? 'RETRYABLE_INTERNAL_ERROR'
    : error instanceof Error && publicErrors[error.message]
      ? error.message
      : 'INTERNAL_ERROR'
  const message =
    (code === 'RETRYABLE_INTERNAL_ERROR'
      ? 'A temporary storage error interrupted the request. Retry once with identical inputs.'
      : publicErrors[code]) ??
    'The request could not be completed. Retry later with the same safe inputs.'

  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${code}: ${message}` }],
    _meta: {
      'clideck/retryable': retryable,
      ...(retryable ? { 'clideck/retry_after_ms': 200 } : {})
    }
  }
}

/** Restricted researcher validation is actionable artifact feedback, not an
 * upstream model outage. Messages contain no source text or private context. */
export function technicalArtifactRejection(error:unknown) {
  if (!(error instanceof Error)) return null
  const code=error.message.split(':',1)[0] ?? ''
  const messages:Record<string,string>={
    TECHNICAL_PROVENANCE_NOT_IN_TASK:'Use the leased URL/hash and an exact contiguous source quote; do not paraphrase evidence_fragment.',
    TECHNICAL_CANDIDATE_INVALID:'Correct the documented candidate context and required record fields using leased evidence.',
    TECHNICAL_QUESTION_KEY_MISMATCH:'Copy the leased question key exactly.',
    TECHNICAL_PRIVATE_CONTEXT_IN_PUBLIC_ANSWER:'Remove private case context from the public candidate.',
    TECHNICAL_REVIEW_WITHOUT_SUPPORTED_ANSWER:'Do not approve an unsupported or absent answer.',
    TECHNICAL_REVIEW_INCOMPLETE:'Retain missing capabilities/context; complete requires every leased capability identifier.',
    TECHNICAL_REVIEW_COMPONENT_MISMATCH:'The documented component does not match the requested component.',
    TECHNICAL_REVIEW_OS_MISMATCH:'The documented operating system does not match the request.',
    TECHNICAL_REVIEW_OS_VERSION_MISMATCH:'The documented operating system version does not match the request.',
    TECHNICAL_REVIEW_COMPONENT_VERSION_MISMATCH:'The documented component version does not match the request.',
    TECHNICAL_UNREVIEWED_PUBLICATION:'Publication requires an approved supported candidate.'
  }
  return messages[code] ? {isError:true,content:[{type:'text' as const,text:`${code}: ${messages[code]}`}]} : null
}
