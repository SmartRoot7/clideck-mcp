import { useEffect, useReducer, useRef, useState } from 'react'

type ToolAnnotations = {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

type ToolExecutionOptions = { signal?: AbortSignal }

type ModelContext = {
  registerTool: (
    tool: {
      name: string
      description: string
      inputSchema?: object
      annotations?: ToolAnnotations
      execute: (
        args: Record<string, unknown>,
        options?: ToolExecutionOptions,
      ) => Promise<string>
    },
    options: { signal: AbortSignal },
  ) => Promise<void> | void
}

type WebMcpDocument = Document & { modelContext?: ModelContext }

function toolResult(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function useWebMcpTool(options: {
  name: string
  description: string
  inputSchema: object
  annotations?: ToolAnnotations
  execute: (
    args: Record<string, unknown>,
    options: ToolExecutionOptions,
  ) => Promise<unknown> | unknown
  onError?: (error: unknown) => void
}) {
  const executeRef = useRef(options.execute)
  const onErrorRef = useRef(options.onError)
  const [detectTick, redetect] = useReducer((value) => value + 1, 0)
  const [state, setState] = useState({
    supported: false,
    registered: false,
    error: null as Error | null
  })

  useEffect(() => {
    executeRef.current = options.execute
    onErrorRef.current = options.onError
  })

  const schemaKey = JSON.stringify(options.inputSchema)
  const annotationsKey = JSON.stringify(options.annotations ?? {})

  useEffect(() => {
    const modelContext = (document as WebMcpDocument).modelContext
    if (!modelContext) {
      setState({ supported: false, registered: false, error: null })
      let attempts = 0
      const timer = window.setInterval(() => {
        if ((document as WebMcpDocument).modelContext) {
          window.clearInterval(timer)
          redetect()
        } else if (++attempts >= 20) {
          window.clearInterval(timer)
        }
      }, 500)
      return () => window.clearInterval(timer)
    }

    const registration = new AbortController()
    let active = true
    try {
      const registrationPromise = modelContext.registerTool({
        name: options.name,
        description: options.description,
        inputSchema: options.inputSchema,
        ...(options.annotations ? { annotations: options.annotations } : {}),
        execute: async (args, executionOptions = {}) => {
          try {
            return toolResult(await executeRef.current(args, executionOptions))
          } catch (error) {
            onErrorRef.current?.(error)
            throw error
          }
        }
      }, { signal: registration.signal })
      void Promise.resolve(registrationPromise).then(() => {
        if (active && !registration.signal.aborted) {
          setState({ supported: true, registered: true, error: null })
        }
      }).catch((error) => {
        if (!active) return
        const normalized = error instanceof Error
          ? error
          : new Error(String(error))
        setState({ supported: true, registered: false, error: normalized })
        onErrorRef.current?.(normalized)
      })
      setState({ supported: true, registered: false, error: null })
    } catch (error) {
      setState({
        supported: true,
        registered: false,
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
    return () => {
      active = false
      registration.abort()
    }
  }, [
    options.name,
    options.description,
    schemaKey,
    annotationsKey,
    detectTick
  ])

  return state
}
