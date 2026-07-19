import { fireEvent, render, screen } from '@testing-library/react'
import { Activity } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { IconTooltip, ProgressBar } from './ui'

describe('dashboard UI primitives', () => {
  it('opens card help only from the existing icon trigger', () => {
    render(
      <IconTooltip icon={Activity} label="Published knowledge">
        Verified revisions in the active release.
      </IconTooltip>,
    )
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-open')
    fireEvent.mouseEnter(screen.getByRole('button', {
      name: 'Published knowledge help'
    }))
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')
    fireEvent.mouseLeave(screen.getByRole('button', {
      name: 'Published knowledge help'
    }))
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-open')

    const trigger = screen.getByRole('button', {
      name: 'Published knowledge help'
    })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')
    fireEvent.blur(trigger)
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-open')

    fireEvent.click(trigger)
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')
    fireEvent.blur(trigger)
    expect(screen.getByRole('tooltip')).not.toHaveClass('is-open')
  })

  it('clamps progress values for accessible output', () => {
    render(<ProgressBar value={140} label="Source progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})
