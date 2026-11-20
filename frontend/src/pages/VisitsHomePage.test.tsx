import { renderWithHeader } from '../test/renderWithHeader'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import VisitsHomePage from './VisitsHomePage'

vi.mock('../api', () => ({ api: { listResearchProjects: vi.fn(), trapperGetConfig: vi.fn(), listVisits: vi.fn(), visitBook: vi.fn(), fieldDeployments: vi.fn(), getSettings: vi.fn(), listLocalLocations: vi.fn(), closedVisits: vi.fn() } }))
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperGetConfig.mockRejectedValue(new Error('no account in this test'))
  mockedApi.listResearchProjects.mockResolvedValue({ results: [] } as never)
  mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: null }, FIELDWORK: { trappers: [], sd_cards: [], cameras: [] } } as never)
  mockedApi.listLocalLocations.mockResolvedValue({ results: [] })
  mockedApi.closedVisits.mockResolvedValue({ results: [] })
  mockedApi.listVisits.mockResolvedValue({ results: [] })
  mockedApi.visitBook.mockResolvedValue({ results: [] })
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

  it('goes from the visit dashboard to Register visits with its button', async () => {
    render(<VisitsHomePage onBack={vi.fn()} startBook />)
    await userEvent.click(await screen.findByRole('button', { name: 'Register the visits' }))

    expect(await screen.findByText('Where do the visits come from?')).toBeInTheDocument()
  })

  it('hands the visits ticked in the visit dashboard over, to create their deployments', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', session: 'R0001', date: '2024-05-01', time: '09:00:00', actions: ['Installation'], trappers: 'Ana', camera_status: null, battery_status: null, card_status: null, num_photos: null, sd: 'A1',
        date_time_ok: null, latitude: null, longitude: null, deployment: null, deployment_status: 'closed', not_done: false, state: 'collected' },
    ] } as never)
    mockedApi.listResearchProjects.mockResolvedValue({ results: [{ name: 'Tatra', acronym: 'TATR' }] } as never)
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' }, FIELDWORK: { trappers: [], sd_cards: [], cameras: [] } } as never)
    const onCreateDeployments = vi.fn(); const onImportImages = vi.fn()
    render(<VisitsHomePage onBack={vi.fn()} startBook onCreateDeployments={onCreateDeployments} onImportImages={onImportImages} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select the visit R0001 to TATR_0001' }))
    await userEvent.click(await screen.findByRole('button', { name: /Import the images/ }))

    expect(onImportImages).toHaveBeenCalledTimes(1)       // one visit: Import deployment, as the button of its row does
    expect(onCreateDeployments).not.toHaveBeenCalled()
  })

  it('goes back to the menu from each, and its breadcrumb is Menu › the page', async () => {
    const onBack = vi.fn()
    const { unmount } = renderWithHeader(<VisitsHomePage onBack={onBack} />)
    expect(await screen.findByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Register the visits')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()

    renderWithHeader(<VisitsHomePage onBack={onBack} startBook />)
    expect(await screen.findByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Visit dashboard')
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})
