import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatusHistoryPage from './StatusHistoryPage'
import { api } from '../api'
import { EMPTY_RESEARCH_PROJECT } from '../types'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), listResearchProjects: vi.fn(), rebuildStatusHistory: vi.fn() } }))
const mockedApi = vi.mocked(api, true)

describe('StatusHistoryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'DONA' } } as never)   // the default research project: it is not asked
    mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }] })
  })

  it('rebuilds the history of the default research project from its visits and says how many lines it added', async () => {
    mockedApi.rebuildStatusHistory.mockResolvedValueOnce({ added: 8 }).mockResolvedValueOnce({ added: 0 })
    render(<StatusHistoryPage onBack={vi.fn()} />)
    expect(await screen.findByText('DONA')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild the history from the visits' }))
    expect(mockedApi.rebuildStatusHistory).toHaveBeenCalledWith('DONA')
    expect(await screen.findByRole('status')).toHaveTextContent('8 lines were added to the history.')

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild the history from the visits' }))
    expect(await screen.findByRole('status')).toHaveTextContent('nothing was added')
  })

  it('cannot rebuild it with no default research project, and says where it is set', async () => {
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: '' } } as never)
    render(<StatusHistoryPage onBack={vi.fn()} />)

    expect(await screen.findByText(/There is no default research project/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild the history from the visits' })).toBeDisabled()
  })

  it('says why it could not', async () => {
    mockedApi.rebuildStatusHistory.mockRejectedValue(new Error("The research project 'DONA' isn't in the collections folder."))
    render(<StatusHistoryPage onBack={vi.fn()} />)
    await screen.findByText('DONA')

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild the history from the visits' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't in the collections folder")
  })
})
