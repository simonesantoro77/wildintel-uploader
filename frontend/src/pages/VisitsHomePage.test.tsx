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
  it('opens on Register visits, which is what the menu opens it on', async () => {
    render(<VisitsHomePage onBack={vi.fn()} />)

    expect(await screen.findByText('Where do the visits come from?')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manage visits' })).not.toBeInTheDocument()   // there is no menu of the visits between
  })

  it('opens on the visit dashboard when the menu asks for it', async () => {
    render(<VisitsHomePage onBack={vi.fn()} startBook />)

    expect(await screen.findByRole('heading', { name: 'Visit dashboard' })).toBeInTheDocument()
  })

  it('goes back to the menu from each, and its breadcrumb is Menu › the page', async () => {
    const onBack = vi.fn()
    const { unmount } = renderWithHeader(<VisitsHomePage onBack={onBack} />)
    expect(await screen.findByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Register visits')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()

    renderWithHeader(<VisitsHomePage onBack={onBack} startBook />)
    expect(await screen.findByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Visit dashboard')
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})
