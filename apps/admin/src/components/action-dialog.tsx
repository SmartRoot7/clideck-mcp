import {
  mutationAckSchema,
  type MutationAck
} from '@clideck/admin-contracts'
import {
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { postJson } from '../lib/api'
import { Button, Toast } from './ui'

export type ActionSpec = {
  title: string
  summary: string
  path: string
  confirmText: string
  danger?: boolean
  requireReason?: boolean
  buildBody: (reason: string) => unknown
}

export function useAdminAction() {
  const queryClient = useQueryClient()
  const [spec, setSpec] = useState<ActionSpec | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const mutation = useMutation({
    mutationFn: async (current: ActionSpec) =>
      postJson<MutationAck>(
        current.path,
        current.buildBody(reason.trim()),
        mutationAckSchema,
      ),
    onSuccess: async (result) => {
      setToast({ tone: 'success', message: result.message })
      setSpec(null)
      setConfirmation('')
      setReason('')
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      setToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Action failed.'
      })
    }
  })

  const open = useCallback((next: ActionSpec) => {
    setConfirmation('')
    setReason('')
    setSpec(next)
  }, [])

  return {
    open,
    dialog: spec ? (
      <ActionDialog
        spec={spec}
        confirmation={confirmation}
        reason={reason}
        pending={mutation.isPending}
        setConfirmation={setConfirmation}
        setReason={setReason}
        onCancel={() => !mutation.isPending && setSpec(null)}
        onConfirm={() => mutation.mutate(spec)}
      />
    ) : null,
    toast: toast ? (
      <Toast tone={toast.tone} onClose={() => setToast(null)}>
        {toast.message}
      </Toast>
    ) : null
  }
}

function ActionDialog({
  spec,
  confirmation,
  reason,
  pending,
  setConfirmation,
  setReason,
  onCancel,
  onConfirm
}: {
  spec: ActionSpec
  confirmation: string
  reason: string
  pending: boolean
  setConfirmation: (value: string) => void
  setReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const reasonValid = !spec.requireReason || reason.trim().length >= 5
  const valid = confirmation === spec.confirmText && reasonValid

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, pending])

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className={spec.danger ? 'dialog__danger-icon' : 'dialog__icon'}>
            <AlertTriangle size={21} />
          </div>
          <div>
            <h2 id="action-dialog-title">{spec.title}</h2>
            <p>{spec.summary}</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        {spec.requireReason && (
          <label className="field">
            Reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={2_000}
              placeholder="Explain why this action is appropriate."
            />
            <small>At least 5 characters. The reason is written to the audit log.</small>
          </label>
        )}
        <label className="field">
          Type <strong>{spec.confirmText}</strong> to confirm
          <input
            ref={inputRef}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <footer>
          <Button onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant={spec.danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!valid || pending}
          >
            {pending ? 'Working…' : spec.title}
          </Button>
        </footer>
      </section>
    </div>
  )
}
