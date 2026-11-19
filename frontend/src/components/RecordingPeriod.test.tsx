import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecordingPeriod from './RecordingPeriod'

const visits = { left: 'R0002', collected: 'R0003' }
const base = { visits, fromVisits: true, start: '2020-11-16T14:24:00+00:00', end: '2020-12-18T10:45:00+00:00', timezone: 'UTC', editForm: <label>Start<input aria-label="Start" /></label> }

describe('RecordingPeriod', () => {
  it('shows the dates of the visits locked, with where they come from in bold, and the duration and the timezone', () => {
    render(<RecordingPeriod {...base} onEdit={vi.fn()} onRestore={vi.fn()} />)

    expect(screen.getByText(/Locked · Field work \(R0002 → R0003\)/)).toBeInTheDocument()
    const sentence = screen.getByText(/Dates come from field work visits/)
    expect(sentence).toHaveTextContent('Dates come from field work visits R0002 (card left) and R0003 (card collected). Visits themselves are never modified.')
    expect([...sentence.querySelectorAll('strong')].map((b) => b.textContent)).toEqual(['R0002', 'R0003'])   // what varies is in bold
    expect(screen.getByText('Visit R0002')).toBeInTheDocument()
    expect(screen.getByText('Visit R0003')).toBeInTheDocument()
    expect(screen.getByText(/Duration:/)).toHaveTextContent('Duration: 31 days 20 h 21 min · Times are in the deployment’s time zone, UTC.')
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
    expect(screen.queryByText(/Quick fill/)).not.toBeInTheDocument()
  })

  it('unlocks the form with Edit dates, and Cancel restores the dates of the visits, Apply keeps what was typed', async () => {
    const onEdit = vi.fn(); const onRestore = vi.fn()
    render(<RecordingPeriod {...base} onEdit={onEdit} onRestore={onRestore} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit dates' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Unlocked · Custom override/)).toBeInTheDocument()
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore from Visits of the field work' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Start')).toBeInTheDocument()                 // still unlocked
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRestore).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()          // locked again, with the visits' dates

    await userEvent.click(screen.getByRole('button', { name: 'Edit dates' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(onRestore).toHaveBeenCalledTimes(2)                                 // what was typed is kept
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
  })

  it('says the dates were changed by hand, once they are, and offers to restore them', async () => {
    const onRestore = vi.fn()
    render(<RecordingPeriod {...base} fromVisits={false} onEdit={vi.fn()} onRestore={onRestore} />)

    expect(screen.getByText(/Locked · Custom dates/)).toBeInTheDocument()
    expect(screen.queryByText('Visit R0002')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore from Visits of the field work' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('has nothing to lock when there is no visit: the form is there', () => {
    render(<RecordingPeriod {...base} visits={null} onEdit={vi.fn()} onRestore={vi.fn()} />)

    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit dates' })).not.toBeInTheDocument()
  })
})
