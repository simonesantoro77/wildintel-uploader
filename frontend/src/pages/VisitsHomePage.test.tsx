import { renderWithHeader } from '../test/renderWithHeader'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import VisitsHomePage from './VisitsHomePage'

vi.mock('../api', () => ({ api: { listResearchProjects: vi.fn(), trapperGetConfig: vi.fn(), listVisits: vi.fn(), fieldDeployments: vi.fn(), getSettings: vi.fn(), listLocalLocations: vi.fn(), closedVisits: vi.fn() } }))
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperGetConfig.mockRejectedValue(new Error('no account in this test'))
  mockedApi.listResearchProjects.mockResolvedValue({ results: [] } as never)
  mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: null }, FIELDWORK: { trappers: [], sd_cards: [], cameras: [] } } as never)
  mockedApi.listLocalLocations.mockResolvedValue({ results: [] })
  mockedApi.closedVisits.mockResolvedValue({ results: [] })
  mockedApi.listVisits.mockResolvedValue({ results: [] })
  mockedApi.fieldDeployments.mockResolvedValue({ results: [] })
})

describe('VisitsHomePage', () => {
  it('opens on Register visits when the initial setup leads there', async () => {
    render(<VisitsHomePage onBack={vi.fn()} startRegister />)

    expect(await screen.findByText('Where do the visits come from?')).toBeInTheDocument()
  })

  it('offers to register visits or to show the visit book, and comes back from each', async () => {
    const onBack = vi.fn()
    render(<VisitsHomePage onBack={onBack} />)
    expect(screen.getByRole('heading', { name: 'Manage visits' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /register visits/i }))
    expect(await screen.findByText('Where do the visits come from?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    await userEvent.click(screen.getByRole('button', { name: /visit dashboard/i }))
    expect(await screen.findByRole('heading', { name: 'Visit dashboard' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('heading', { name: 'Manage visits' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('says where each page hangs from, and goes back there from the breadcrumb', async () => {
    const onBack = vi.fn()
    renderWithHeader(<VisitsHomePage onBack={onBack} />)
    expect(screen.getByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Manage visits')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(onBack).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /register visits/i }))
    expect(await screen.findByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Manage visits›Register visits')
    await userEvent.click(screen.getByRole('button', { name: 'Manage visits' }))
    expect(screen.getByRole('heading', { name: 'Manage visits' })).toBeInTheDocument()
  })
})
