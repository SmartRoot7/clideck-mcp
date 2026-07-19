import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  type LucideIcon,
  X
} from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode
} from 'react'
import { useId, useState } from 'react'

import {
  compactNumber,
  formatDate,
  toneFor,
  type Tone,
  valueNode
} from '../lib/format'

export function IconTooltip({
  icon: Icon,
  label,
  children
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="icon-tooltip">
      <button
        type="button"
        className="icon-tooltip__trigger"
        aria-label={`${label} help`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`icon-tooltip__content ${open ? 'is-open' : ''}`}
      >
        <strong>{label}</strong>
        <span>{children}</span>
      </span>
    </span>
  )
}

export function Status({
  children,
  tone
}: {
  children: ReactNode
  tone?: Tone
}) {
  const resolvedTone = tone ?? toneFor(String(children))
  return (
    <span className={`status status--${resolvedTone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
}) {
  return (
    <button
      className={`button button--${variant} ${className}`}
      {...props}
    />
  )
}

export function Panel({
  title,
  icon,
  help,
  action,
  className = '',
  children
}: {
  title: string
  icon: LucideIcon
  help: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__header">
        <div className="panel__title">
          <IconTooltip icon={icon} label={title}>{help}</IconTooltip>
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Metric({
  label,
  value,
  icon,
  help,
  detail,
  tone = 'info',
  className = ''
}: {
  label: string
  value: string | number | null | undefined
  icon: LucideIcon
  help: string
  detail?: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <article className={`metric metric--${tone} ${className}`}>
      <div className="metric__label">
        <IconTooltip icon={icon} label={label}>{help}</IconTooltip>
        <span>{label}</span>
      </div>
      <strong>{typeof value === 'number' ? compactNumber(value) : valueNode(value)}</strong>
      {detail && <small>{detail}</small>}
    </article>
  )
}

export type TableColumn<Row> = {
  key: string
  label: string
  render: (row: Row) => ReactNode
  className?: string
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  actions
}: {
  columns: Array<TableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  empty: string
  actions?: (row: Row) => ReactNode
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>{column.label}</th>
            ))}
            {actions && <th className="data-table__actions">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
              {actions && <td className="data-table__actions">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({
  offset,
  limit,
  total,
  onChange
}: {
  offset: number
  limit: number
  total: number
  onChange: (offset: number) => void
}) {
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="pagination">
      <span>{total.toLocaleString()} records · page {page} of {pages}</span>
      <div>
        <Button
          variant="quiet"
          aria-label="Previous page"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={17} />
        </Button>
        <Button
          variant="quiet"
          aria-label="Next page"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={17} />
        </Button>
      </div>
    </div>
  )
}

export function LoadingState({ label = 'Loading live data…' }: { label?: string }) {
  return (
    <div className="state state--loading" role="status">
      <LoaderCircle className="spin" size={20} />
      {label}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state state--empty">{children}</div>
}

export function ErrorState({
  children,
  onRetry
}: {
  children: ReactNode
  onRetry?: () => void
}) {
  return (
    <div className="state state--error" role="alert">
      <AlertTriangle size={20} />
      <span>{children}</span>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  )
}

export function Toast({
  tone,
  children,
  onClose
}: {
  tone: 'success' | 'error'
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className={`toast toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
      <span>{children}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}

export function ProgressBar({
  value,
  tone = 'info',
  label
}: {
  value: number
  tone?: Tone
  label?: string
}) {
  const bounded = Math.max(0, Math.min(100, value))
  return (
    <div className="progress" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} role="progressbar">
      <span
        className={`progress__fill progress__fill--${tone}`}
        style={{ '--progress': `${bounded}%` } as CSSProperties}
      />
    </div>
  )
}

export function KeyValue({
  items
}: {
  items: Array<{
    label: string
    value: ReactNode
    date?: boolean
  }>
}) {
  return (
    <dl className="key-value">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.date && typeof item.value === 'string'
            ? formatDate(item.value)
            : item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
