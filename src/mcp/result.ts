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
