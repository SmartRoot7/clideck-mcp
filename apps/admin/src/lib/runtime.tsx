import {
  mutationAckSchema,
  type MutationAck
} from '@clideck/admin-contracts'
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo
} from 'react'

import { postJson } from './api'

export type OperationsRole = 'super_admin' | 'public_demo'

type OperationsRuntime = {
  role: OperationsRole
  apiPrefix: '/admin/api/v1' | '/public/v1/demo'
  routePrefix: '/admin' | '/demo'
  executeMutation: (
    path: string,
    body: unknown,
  ) => Promise<MutationAck>
}

const RuntimeContext = createContext<OperationsRuntime | null>(null)

export function OperationsRuntimeProvider({
  role,
  children
}: {
  role: OperationsRole
  children: ReactNode
}) {
  const value = useMemo<OperationsRuntime>(() => {
    const publicDemo = role === 'public_demo'
    return {
      role,
      apiPrefix: publicDemo ? '/public/v1/demo' : '/admin/api/v1',
      routePrefix: publicDemo ? '/demo' : '/admin',
      executeMutation: publicDemo
        ? async () => ({
            ok: true,
            message: 'Read-only demo — no changes were made.',
            audit_target: null
          })
        : (path, body) => postJson(path, body, mutationAckSchema)
    }
  }, [role])

  return (
    <RuntimeContext.Provider value={value}>
      {children}
    </RuntimeContext.Provider>
  )
}

export function useOperationsRuntime(): OperationsRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) {
    throw new Error('OperationsRuntimeProvider is missing')
  }
  return runtime
}
