import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import ResearchProjectSelect from './ResearchProjectSelect'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), listResearchProjects: vi.fn(), setDefaultResearchProject: vi.fn() } }))
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'WICP_02' } } as never)
  mocked.listResearchProjects.mockResolvedValue({ results: [{ name: 'Doñana census', acronym: 'WICP_02' }, { name: 'Tatra', acronym: 'TATR' }] } as never)
})

describe('ResearchProjectSelect', () => {
  it('says the default research project and lists the defined ones to change it', async () => {
    mocked.setDefaultResearchProject.mockResolvedValue({ default_research_project: 'TATR' })
    render(<ResearchProjectSelect />)

    const pill = await screen.findByRole('button', { name: 'Default research project' })
    await waitFor(() => expect(pill).toHaveTextContent('WICP_02 — Doñana census'))
    await userEvent.click(pill)
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(options[1])
    expect(mocked.setDefaultResearchProject).toHaveBeenCalledWith('TATR')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not save when the one that is already the default is chosen, and says why when saving fails', async () => {
    mocked.setDefaultResearchProject.mockRejectedValue(new Error('There is no research project called "TATR".'))
    render(<ResearchProjectSelect />)
    await userEvent.click(await screen.findByRole('button', { name: 'Default research project' }))

    await userEvent.click((await screen.findAllByRole('option'))[0])
    expect(mocked.setDefaultResearchProject).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Default research project' }))
    await userEvent.click((await screen.findAllByRole('option'))[1])
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no research project called')
  })
})
