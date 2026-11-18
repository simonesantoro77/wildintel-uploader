import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportDeploymentsPage from './ImportDeploymentsPage'
import type { DeploymentQueue } from './ImportDeploymentPage'
import type { ClosedVisitTarget } from '../types'

const target = (location_id: string, session = 'R0001') => ({ researchProjectId: 'DONA', visit: { location_id, session } }) as unknown as ClosedVisitTarget

// the two pages that Import deployments hands over to, as what each is given
vi.mock('./ImportSessionPage', () => ({
  default: ({ onQueue, onSingleVisit }: { onQueue: (t: ClosedVisitTarget[]) => void; onSingleVisit: (t: ClosedVisitTarget) => void }) => (
    <div>
      <p>the page of the visits</p>
      <button onClick={() => onQueue([target('DONA_0006'), target('DONA_0007'), target('DONA_0008')])}>queue three</button>
      <button onClick={() => onSingleVisit(target('DONA_0009'))}>one visit</button>
    </div>
  ),
}))
vi.mock('./ImportDeploymentPage', () => ({
  default: ({ closedVisit, queue, onBack }: { closedVisit: ClosedVisitTarget; queue?: DeploymentQueue; onBack: () => void }) => (
    <div>
      <p>deployment page of {closedVisit.visit.session}-{closedVisit.visit.location_id}</p>
      {queue && <p>queue {queue.index + 1} of {queue.total}; next {queue.next ?? 'none'}; parent {queue.parentFolder ?? 'none'}</p>}
      {queue && <button onClick={() => queue.onFolder('/data/R0001')}>folder chosen</button>}
      {queue && <button onClick={queue.onNext}>next</button>}
      {queue && <button onClick={queue.onSkip}>skip</button>}
      {queue && <button onClick={queue.onStop}>stop</button>}
      <button onClick={onBack}>back</button>
    </div>
  ),
}))

describe('ImportDeploymentsPage', () => {
  it('imports the visits one after another: the first, then the second… and tells the folder of the one before to the next', async () => {
    render(<ImportDeploymentsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'queue three' }))

    expect(screen.getByText('deployment page of R0001-DONA_0006')).toBeInTheDocument()
    expect(screen.getByText('queue 1 of 3; next R0001-DONA_0007; parent none')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'folder chosen' }))
    await userEvent.click(screen.getByRole('button', { name: 'next' }))

    expect(screen.getByText('deployment page of R0001-DONA_0007')).toBeInTheDocument()
    expect(screen.getByText('queue 2 of 3; next R0001-DONA_0008; parent /data/R0001')).toBeInTheDocument()   // beside the one before
    await userEvent.click(screen.getByRole('button', { name: 'skip' }))

    expect(screen.getByText('queue 3 of 3; next none; parent /data/R0001')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'next' }))   // the last one: it ends, back to the visits
    expect(screen.getByText('the page of the visits')).toBeInTheDocument()
  })

  it('stops the queue where it is, and goes back to the page of the visits', async () => {
    render(<ImportDeploymentsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'queue three' }))
    await userEvent.click(screen.getByRole('button', { name: 'next' }))
    await userEvent.click(screen.getByRole('button', { name: 'stop' }))

    expect(screen.getByText('the page of the visits')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'queue three' }))   // a new queue starts again from the first
    expect(screen.getByText('queue 1 of 3; next R0001-DONA_0007; parent none')).toBeInTheDocument()
  })

  it('has no queue for one visit: it is Import deployment', async () => {
    render(<ImportDeploymentsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'one visit' }))

    expect(screen.getByText('deployment page of R0001-DONA_0009')).toBeInTheDocument()
    expect(screen.queryByText(/^queue /)).not.toBeInTheDocument()
  })
})
