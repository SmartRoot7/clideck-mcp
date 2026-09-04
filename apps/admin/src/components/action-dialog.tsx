import {
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import { useState } from 'react'

import { useOperationsRuntime } from '../lib/runtime'
import { Toast } from './ui'

const ADMIN_ACTION_REASON = 'Requested directly from the admin console.'

export type ActionSpec = {
  title: string
  path: string
  buildBody: (reason: string) => unknown
}

/**
 * Admin actions intentionally run on the first click. Authentication,
 * authorization, validation and audit logging remain server-side controls;
 * the console does not add a second confirmation dialog or typed phrase.
 */
export function useAdminAction() {
  const queryClient = useQueryClient()
  const runtime = useOperationsRuntime()
  const [toast, setToast] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const mutation = useMutation({
    mutationFn: async (current: ActionSpec) =>
      runtime.executeMutation(
        current.path,
        current.buildBody(ADMIN_ACTION_REASON),
      ),
    onSuccess: async (result) => {
      setToast({ tone: 'success', message: result.message })
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      setToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Action failed.'
      })
    }
  })

  return {
    open: (spec: ActionSpec) => {
      if (!mutation.isPending) mutation.mutate(spec)
    },
    pending: mutation.isPending,
    dialog: null,
    toast: toast ? (
      <Toast tone={toast.tone} onClose={() => setToast(null)}>
        {toast.message}
      </Toast>
    ) : null
  }
}
