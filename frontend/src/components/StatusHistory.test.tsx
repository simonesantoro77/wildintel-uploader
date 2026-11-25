import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatusHistory from './StatusHistory'

vi.mock('../api', () => ({ api: { statusHistory: vi.fn() } }))
import { api } from '../api'
const mocked = vi.mocked(api, true)

describe('StatusHistory', () => {
  beforeEach(() => vi.resetAllMocks())

  it('lists what it was and why it changed, the latest first, with how it was made', async () => {
    mocked.statusHistory.mockResolvedValue({ results: [
      { kind: 'locations', name: 'DONA_01', before: null, after: 'active', at: '2026-11-24T10:00:00Z', day: '2024-09-04', reason: 'Created.' },
      { kind: 'locations', name: 'DONA_01', before: 'active', after: 'archived', at: '2026-11-24T10:01:00Z', day: '2024-10-12', reason: 'The visit R0002 to DONA_01.' },
    ] })
    render(<StatusHistory researchProject="DONA" kind="locations" name="DONA_01" />)

    const lines = await screen.findAllByRole('listitem')
    expect(mocked.statusHistory).toHaveBeenCalledWith('DONA', 'locations', 'DONA_01')
    expect(lines[0]).toHaveTextContent('Active → Archived')
    expect(lines[0]).toHaveTextContent('The visit R0002 to DONA_01.')
    expect(lines[1]).toHaveTextContent('Created as Active')
  })

  it('says that a line was rebuilt from the visits, and that the status before the first one is not known', async () => {
    mocked.statusHistory.mockResolvedValue({ results: [
      { kind: 'cameras', name: 'CAM1', before: 'unknown', after: 'active', at: '2026-11-25T10:00:00Z', day: '2026-01-10', reason: 'The visit R0001 to DONA_01.', reconstructed: true },
    ] })
    render(<StatusHistory researchProject="DONA" kind="cameras" name="CAM1" />)

    const [line] = await screen.findAllByRole('listitem')
    expect(line).toHaveTextContent('Unknown → Active')
    expect(line).toHaveTextContent('The visit R0001 to DONA_01. · rebuilt from the visits')
  })

  it('says nothing when there is no history or the research project is not known', async () => {
    mocked.statusHistory.mockResolvedValue({ results: [] })
    const { container, rerender } = render(<StatusHistory researchProject="DONA" kind="cameras" name="CAM1" />)
    await waitFor(() => expect(mocked.statusHistory).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    mocked.statusHistory.mockClear()
    rerender(<StatusHistory researchProject={null} kind="cameras" name="CAM1" />)
    expect(mocked.statusHistory).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
