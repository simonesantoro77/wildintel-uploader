import { renderWithHeader } from '../test/renderWithHeader'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import Navbar from '../components/Navbar'
import { TrailProvider } from '../components/Trail'
import VisitBookPage from './VisitBookPage'
import { download } from '../csvFile'

vi.mock('../api', () => ({ api: { listResearchProjects: vi.fn(), trapperGetConfig: vi.fn(), visitBook: vi.fn(), getSettings: vi.fn(), exportVisitsCsv: vi.fn(), updateVisit: vi.fn(), saveVisit: vi.fn(), listLocalLocations: vi.fn(), createRevision: vi.fn(), markNotVisited: vi.fn() } }))
vi.mock('../csvFile', () => ({ download: vi.fn() }))
const mockedApi = vi.mocked(api)

const visit = (over: object) => ({
  location_id: 'TATR_0001', session: 'R0003', date: '2024-09-04', time: '09:00:00', actions: ['Installation'], trappers: 'Ana', camera_status: null, battery_status: null, card_status: null, num_photos: null,
  sd: 'A13', date_time_ok: null, latitude: null, longitude: null, camera_id: 'P800', camera_model: null, deployment: null, deployment_status: null, not_done: false, ...over,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.trapperGetConfig.mockRejectedValue(new Error('no account in this test'))
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ name: 'Tatra', acronym: 'TATR' }] } as never)
  mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' } } as never)
  mockedApi.visitBook.mockResolvedValue({ results: [
    visit({ deployment: 'R0003-TATR_0001', deployment_status: 'closed' }),
    visit({ date: '2024-10-12', session: 'R0004', actions: ['Revision'], num_photos: 241, sd: 'B2', deployment: 'R0004-TATR_0001', deployment_status: 'open', comments: 'pilas cambiadas' }),
    visit({ location_id: 'TATR_0002', trappers: 'Luis', camera_id: 'P900', deployment: 'R0003-TATR_0002', deployment_status: 'closed', deployment_id: 'R0003-TATR_0002', on_trapper: true, uploaded_at: '2024-10-20T10:00:00+00:00' }),
  ] })
})

// The book is of the default research project: nothing to pick.
async function pickProject() {
  render(<VisitBookPage onBack={vi.fn()} onImportImages={vi.fn()} />)
  await screen.findByRole('table', { name: 'Visits' })
}

const showAll = async () => { await userEvent.click(await screen.findByRole('button', { name: /^All revisions/ })) }  // the dashboard opens on the latest revision

describe('VisitBookPage', () => {
  it('has a Register visits button in its header, beside the export and the next revision, that goes to Register visits', async () => {
    const onRegisterVisits = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onImportImages={vi.fn()} onRegisterVisits={onRegisterVisits} />)
    await screen.findByRole('table', { name: 'Visits' })

    const buttons = within(screen.getByRole('group', { name: 'Dashboard actions' })).getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Export visits (CSV)', 'Register the visits', 'Create the next revision', 'Help & Legend'])
    await userEvent.click(screen.getByRole('button', { name: 'Register the visits' }))
    expect(onRegisterVisits).toHaveBeenCalledTimes(1)
  })

  it('has no Register visits button where there is nowhere to go to register', async () => {
    await pickProject()

    expect(screen.queryByRole('button', { name: 'Register the visits' })).not.toBeInTheDocument()
  })

  it('ticks visits, and a bar over the table says how many are selected and creates their deployments — when the card of each was collected and they are of one revision', async () => {
    const onImportImages = vi.fn()
    const onCreateDeployments = vi.fn()
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', state: 'collected', deployment_status: 'closed', date: '2024-05-01' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', state: 'collected', deployment_status: 'closed', date: '2024-05-01', time: '10:00:00' }),
      visit({ session: 'R0002', location_id: 'TATR_0001', state: 'deployed', deployment_status: 'open', date: '2024-06-01' }),
    ] })
    render(<VisitBookPage onBack={vi.fn()} onImportImages={onImportImages} onCreateDeployments={onCreateDeployments} />)
    const table = await screen.findByRole('table', { name: 'Visits' })
    await userEvent.click(await screen.findByRole('button', { name: /^All revisions/ }))

    expect(screen.queryByRole('group', { name: 'Action on the selected visits' })).not.toBeInTheDocument()   // no bar while nothing is ticked
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the visit R0001 to TATR_0001' }))
    const bar = screen.getByRole('group', { name: 'Action on the selected visits' })
    expect(within(bar).getByText('1 selected')).toBeInTheDocument()
    expect((within(table).getByRole('checkbox', { name: 'Select all the visits of the page' }) as HTMLInputElement).indeterminate).toBe(true)   // some of the page
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the visit R0001 to TATR_0002' }))
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
    expect(within(bar).getByText('Select all 3 matching')).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: /Import the images/ }))
    expect(onCreateDeployments).toHaveBeenCalledWith([expect.objectContaining({ researchProjectId: 'TATR', visit: expect.objectContaining({ location_id: 'TATR_0001', session: 'R0001' }) }), expect.objectContaining({ visit: expect.objectContaining({ location_id: 'TATR_0002' }) })])

    await userEvent.click(within(bar).getByRole('button', { name: 'Select all 3 matching' }))        // the three, one of which is still deployed: its card was not collected
    expect(within(bar).getByText('3 selected')).toBeInTheDocument()
    expect(bar).not.toHaveTextContent('Only visits whose card was collected')                  // no message in the bar: the button is just not active
    expect(within(bar).getByRole('button', { name: /Import the images/ })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: /Import the images/ })).toHaveAttribute('title', 'Only visits whose card was collected, and have no deployment yet, can create their deployments.')   // what it says if the pointer stays on it
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('group', { name: 'Action on the selected visits' })).not.toBeInTheDocument()

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the visit R0001 to TATR_0002' }))        // one alone goes to Import deployment
    await userEvent.click(within(screen.getByRole('group', { name: 'Action on the selected visits' })).getByRole('button', { name: /Import the images/ }))
    expect(onImportImages).toHaveBeenCalledWith(expect.objectContaining({ researchProjectId: 'TATR', visit: expect.objectContaining({ location_id: 'TATR_0002' }) }))
  })

  it('exports the visits of the research project as a CSV file', async () => {
    mockedApi.exportVisitsCsv.mockResolvedValue({ csv: 'location_id,actions\r\n', filename: 'TATR_visits.csv', count: 3 })
    await pickProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Export visits (CSV)' }))
    expect(mockedApi.exportVisitsCsv).toHaveBeenCalledWith('TATR')
    expect(download).toHaveBeenCalledWith('TATR_visits.csv', 'location_id,actions\r\n')
  })

  it('opens on the latest revision from the first render of its table — not after it — and shows all of them again when asked', async () => {
    await pickProject()

    const table = await screen.findByRole('table', { name: 'Visits' })
    // the first time the table is there it is already the latest revision's: it does not change under a click
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('R0004')
    await showAll()
    expect(within(await screen.findByRole('table', { name: 'Visits' })).getAllByRole('row').slice(1)).toHaveLength(3)
  })

  it('lists the visits of a research project, the newest first, and filters them', async () => {
    await pickProject()
    await showAll()

    const table = await screen.findByRole('table', { name: 'Visits' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('12 Oct 2024, 09:00') // the Revision, the newest
    await userEvent.type(screen.getByLabelText('Filter the visits'), 'luis')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(mockedApi.visitBook).toHaveBeenCalledWith('TATR')
  })

  it('is of the default research project, which the header says and lets change', async () => {
    renderWithHeader(<VisitBookPage onBack={vi.fn()} onOpenSettings={vi.fn()} />)

    await screen.findByRole('table', { name: 'Visits' })
    expect(await screen.findByRole('button', { name: 'Default research project' })).toHaveTextContent('TATR — Tatra')
    expect(mockedApi.visitBook).toHaveBeenCalledWith('TATR')
  })

  it('says when there is no default research project, or it is not in the collections folder', async () => {
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: null } } as never)
    const { unmount } = render(<VisitBookPage onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(await screen.findByText(/No default research project is set\./)).toBeInTheDocument()
    expect(mockedApi.visitBook).not.toHaveBeenCalled()
    unmount()

    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'GONE' } } as never)
    render(<VisitBookPage onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(await screen.findByText(/is not in the collections folder/)).toBeInTheDocument()
  })

  it('has a row for each location not visited in a session, as Planned, with only the options that apply to it', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed' }),
      visit({ location_id: 'TATR_0002', session: 'R0001', date: '', time: '', actions: [], sd: null, camera_id: null, trappers: null, not_done: true, when: null }),
    ] })
    await pickProject()

    const table = await screen.findByRole('table', { name: 'Visits' })
    const [done, notDone] = within(table).getAllByRole('row').slice(1)
    expect(within(notDone).getAllByRole('cell').slice(1, 6).map((c) => c.textContent)).toEqual(['R0001', 'TATR_0002', '—', '', 'Planned'])
    // only the options that apply to the row are there: nothing to look at, and no deployment to create, where nothing was done
    expect(within(notDone).queryByRole('button', { name: /^View the visit/ })).not.toBeInTheDocument()
    expect(within(notDone).queryByRole('button', { name: /^Create the deployment/ })).not.toBeInTheDocument()
    expect(within(done).getByRole('button', { name: /^View the visit/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Planned/ }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
  })

  it('has a button to create the visit of a location that is Planned, which goes to it with the research project and the location', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed' }),
      visit({ location_id: 'TATR_0002', session: 'R0001', date: '', time: '', actions: [], sd: null, camera_id: null, trappers: null, not_done: true, when: null }),
    ] })
    const onCreateVisit = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onImportImages={vi.fn()} onCreateVisit={onCreateVisit} />)
    await screen.findByRole('table', { name: 'Visits' })

    const table = await screen.findByRole('table', { name: 'Visits' })
    const [done, notDone] = within(table).getAllByRole('row').slice(1)
    expect(within(done).queryByRole('button', { name: /^Create the visit/ })).not.toBeInTheDocument()   // only a planned one has it
    await userEvent.click(within(notDone).getByRole('button', { name: 'Create the visit R0001 to TATR_0002' }))
    expect(onCreateVisit).toHaveBeenCalledWith({ researchProjectId: 'TATR', site: 'TATR_0002' })
  })

  it('shows when the visit was as the day and the time on the wall clock of its location, with the timezone of the location beside in brackets', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', date: '2024-09-04', time: '13:10:00', when: '2024-09-04T11:10:00Z', timezone: 'Europe/Madrid' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '2024-01-04', time: '08:30:00', when: '2024-01-04T09:00:00Z' }),    // its location has no timezone said
    ] })
    await pickProject()
    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getByText('4 Sep 2024, 13:10 (Europe/Madrid)')).toBeInTheDocument()
    expect(within(table).getByText('4 Jan 2024, 08:30')).toBeInTheDocument()
  })

  it('says on each revision the days it went from and to', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', date: '2024-06-01' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '2024-06-03' }),
    ] })
    await pickProject()
    const revisions = await screen.findByRole('region', { name: 'Revision' })
    expect(within(revisions).getByRole('button', { name: /^R0001/ })).toHaveTextContent('2024-06-01 → 2024-06-03')
  })

  it('leaves the end of a revision open while a visit of it is still planned', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', date: '2024-06-01' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null, when: null }),
    ] })
    await pickProject()
    const revisions = await screen.findByRole('region', { name: 'Revision' })
    expect(within(revisions).getByRole('button', { name: /^R0001/ })).toHaveTextContent('2024-06-01 → …')
  })

  it('shows, for a visit, the earlier one that left the card it collects with dots for the revisions between that say nothing — and says there is none when it left no camera or there is no earlier one', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0003', date: '2024-05-01', state: 'collected', deployment_status: 'closed', sd: 'A1' }),
      visit({ session: 'R0004', date: '2024-06-01', state: 'unknown', unknown: true, actions: [], sd: null, camera_id: null }),
      visit({ session: 'R0005', date: '2024-07-01', state: 'collected', deployment_status: 'closed', actions: ['Revision'], sd: 'A2' }),
      visit({ session: 'R0006', date: '2024-08-01', state: 'no_camera', deployment_status: null, actions: ['Desinstallation'], sd: null, camera_id: null }),
      visit({ session: 'R0007', date: '2024-09-01', state: 'deployed', deployment_status: 'open', actions: ['Installation'], sd: 'A3' }),
    ] } as never)
    render(<VisitBookPage onBack={vi.fn()} />)
    await showAll()
    await screen.findByRole('table', { name: 'Visits' })

    await userEvent.click(screen.getByRole('button', { name: 'View the visit R0005 to TATR_0001' }))      // collects what R0003 left, with R0004 unknown between
    let panel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0005 to TATR_0001' }))
    expect(within(panel.getByRole('region', { name: 'The visit that left the card' })).getByText('R0003')).toBeInTheDocument()
    expect(panel.getByText('Unknown', { exact: false })).toBeInTheDocument()                                 // the revision between, as dots
    expect(within(panel.getByRole('region', { name: 'The visit that collected it' })).getByText('R0005')).toBeInTheDocument()
    await userEvent.click(panel.getByRole('button', { name: 'Close' }))

    await userEvent.click(screen.getByRole('button', { name: 'View the visit R0007 to TATR_0001' }))      // R0006 left no camera: there is no card of it to collect
    panel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0007 to TATR_0001' }))
    expect(panel.getByText('There is no earlier revision in which the card was left.')).toBeInTheDocument()
    expect(panel.queryByRole('region', { name: 'The visit that collected it' })).not.toBeInTheDocument()
    await userEvent.click(panel.getByRole('button', { name: 'Close' }))

    await userEvent.click(screen.getByRole('button', { name: 'View the visit R0003 to TATR_0001' }))      // the first one: nothing before it
    panel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0003 to TATR_0001' }))
    expect(panel.getByText('There is no earlier revision in which the card was left.')).toBeInTheDocument()
  })

  it('has, in the details of a visit, the location and the camera underlined with dots, each opening its own panel over the visit', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [visit({ session: 'R0004', deployment_status: 'open', camera_id: 'P800', camera_model: 'Reconyx' })] })
    mockedApi.listLocalLocations.mockResolvedValue({ results: [{ location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5 }] } as never)
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' }, FIELDWORK: { cameras: [{ label: 'Cam 7', camera_id: 'P800', camera_model: 'Reconyx HF2', research_project: 'TATR', status: 'active', in_service: '2023-05-01' }] } } as never)
    const onOpenSettings = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await showAll()
    await screen.findByRole('table', { name: 'Visits' })
    await userEvent.click(screen.getByRole('button', { name: 'View the visit R0004 to TATR_0001' }))
    const visitPanel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' }))

    const location = visitPanel.getByRole('button', { name: 'TATR_0001' })
    expect(location).toHaveClass('decoration-dotted')                                               // underlined with dots, as the other links are
    const camera = visitPanel.getByRole('button', { name: 'P800 · Reconyx' })
    expect(camera).toHaveClass('decoration-dotted')

    await userEvent.click(location)
    const siteDialog = within(await screen.findByRole('dialog', { name: 'Details of the location TATR_0001' }))
    expect(siteDialog.getByText('Ridge')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' })).toBeInTheDocument()   // the visit is still under it
    await userEvent.keyboard('{Escape}')                                                                // Escape shuts the one on top only
    expect(screen.queryByRole('dialog', { name: 'Details of the location TATR_0001' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' })).toBeInTheDocument()

    await userEvent.click(camera)
    const cameraDialog = within(await screen.findByRole('dialog', { name: 'Details of the camera Cam 7' }))
    expect(cameraDialog.getByRole('heading', { name: 'Cam 7' })).toBeInTheDocument()
    expect(cameraDialog.getByLabelText('The camera')).toHaveTextContent('Serial numberP800')
    await userEvent.click(cameraDialog.getByRole('button', { name: 'Open it in the settings' }))
    expect(onOpenSettings).toHaveBeenCalledWith('cameras', 'TATR', 'Cam 7')
  })

  it('opens the data of the location of a visit in a panel at the right, with a way on to its page in the settings', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [visit({ session: 'R0001', deployment_status: 'closed' })] })
    mockedApi.listLocalLocations.mockResolvedValue({ results: [{ location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5, trapper_pk: null }] } as never)
    const onOpenSettings = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await screen.findByRole('table', { name: 'Visits' })
    const table = await screen.findByRole('table', { name: 'Visits' })

    await userEvent.click(within(table).getByRole('button', { name: 'TATR_0001' }))
    const panel = within(await screen.findByRole('dialog', { name: 'Details of the location TATR_0001' }))
    expect(mockedApi.listLocalLocations).toHaveBeenCalledWith('TATR')
    expect(panel.getByRole('heading', { name: 'TATR_0001' })).toBeInTheDocument()
    expect(panel.getByText('Ridge')).toBeInTheDocument()
    expect(panel.getByText('Not UTC')).toBeInTheDocument()         // Europe/Warsaw: the time zone is not UTC, a red label says it
    expect(onOpenSettings).not.toHaveBeenCalled()                 // it goes to the settings from the panel, not at once
    await userEvent.click(panel.getByRole('button', { name: 'Open it in the settings' }))
    expect(onOpenSettings).toHaveBeenCalledWith('locations', 'TATR', 'TATR_0001')
  })

  it('has a button to see the visit of the revision before and the one after, to the same location — there only where there is one', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', date: '2024-06-01', comments: 'first trip', deployment_status: 'closed' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '2024-06-02' }),
      visit({ session: 'R0002', date: '2024-09-04', actions: ['Revision'], deployment_status: 'open' }),
      visit({ session: 'R0002', location_id: 'TATR_0003', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null, when: null }),
    ] })
    await pickProject()
    await showAll()

    const table = await screen.findByRole('table', { name: 'Visits' })
    const row = (site: string, session: string) => within(table).getAllByRole('row').find((r) => { const cells = within(r).queryAllByRole('cell'); return cells[1]?.textContent === session && cells[2]?.textContent === site })!
    expect(within(row('TATR_0001', 'R0001')).queryByRole('button', { name: /^Show the previous visit to TATR_0001/ })).not.toBeInTheDocument()   // the first revision of the location
    expect(within(row('TATR_0003', 'R0002')).queryByRole('button', { name: /^Show the previous visit to TATR_0003/ })).not.toBeInTheDocument()   // nothing before it
    expect(within(row('TATR_0001', 'R0002')).queryByRole('button', { name: /^Show the next visit to TATR_0001/ })).not.toBeInTheDocument()          // the last revision of the location
    expect(within(row('TATR_0002', 'R0001')).queryByRole('button', { name: /^Show the next visit to TATR_0002/ })).not.toBeInTheDocument()          // nothing after it
    // only what applies is there, View between the one before and the one after: the first revision has no one before; a visit made is not created again, its deployment is
    expect(within(row('TATR_0001', 'R0001')).getAllByRole('button').filter((b) => b.hasAttribute('aria-label')).map((b) => b.getAttribute('aria-label')?.split(' to ')[0])).toEqual(['Edit the visit R0001', 'View the visit R0001', 'Show the next visit', 'Create the deployment of the visit R0001'])

    await userEvent.click(within(row('TATR_0001', 'R0002')).getByRole('button', { name: 'Show the previous visit to TATR_0001 (R0001)' }))
    // the revision before is picked and its visit to the location is the current one
    expect(screen.getByRole('button', { name: /^R0001/ })).toHaveAttribute('aria-pressed', 'true')
    expect(row('TATR_0001', 'R0001')).toHaveAttribute('aria-current', 'true')                // and its row is the current one

    // and the one after goes back to the revision of the row
    await userEvent.click(within(row('TATR_0001', 'R0001')).getByRole('button', { name: 'Show the next visit to TATR_0001 (R0002)' }))
    expect(screen.getByRole('button', { name: /^R0002/ })).toHaveAttribute('aria-pressed', 'true')
    expect(row('TATR_0001', 'R0002')).toHaveAttribute('aria-current', 'true')
  })

  it('shows the state the visit is kept with, whatever its deployment says', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'open', state: 'collected' }),
      visit({ session: 'R0002', location_id: 'TATR_0002', camera_status: 'Not revised', not_visited: true, state: 'not_visited' }),
    ] })
    await pickProject()
    await showAll()

    const squares = await screen.findByRole('region', { name: 'Visits by status' })
    expect(within(squares).getByRole('button', { name: /^Collected/ })).toHaveTextContent('1')
    expect(within(squares).getByRole('button', { name: /^Deployed/ })).toHaveTextContent('0')
    expect(within(squares).getByRole('button', { name: /^Not visited/ })).toHaveTextContent('1')
    expect(squares).toHaveTextContent('2/ 2')   // a visit that could not be made counts as completed
  })

  it('counts the visits by status in squares that filter them, with how many are done', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', deployment: 'R0001-TATR_0002', deployment_status: 'closed', deployment_id: 'R0001-TATR_0002' }),
      visit({ session: 'R0002', deployment: 'R0002-TATR_0001', deployment_status: 'open' }),
      visit({ session: 'R0002', location_id: 'TATR_0002', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null }),
    ] })
    await pickProject()
    await showAll()
    const squares = await screen.findByRole('region', { name: 'Visits by status' })
    const square = (name: RegExp) => within(squares).getByRole('button', { name })

    expect(squares).toHaveTextContent('3/ 4')
    expect(square(/^Planned/)).toHaveTextContent('1')
    expect(square(/^Deployed/)).toHaveTextContent('1')
    expect(square(/^Collected/)).toHaveTextContent('2')                   // the card collected, whether the deployment is made (images stored) or not
    expect(square(/^Not visited/)).toHaveTextContent('0')
    expect(within(squares).getByRole('progressbar', { name: 'Visits done' })).toHaveAttribute('aria-valuenow', '3')
    expect(squares).toHaveTextContent('75%'); expect(within(squares).getByText('1 pending visit')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Visits' })
    await userEvent.click(square(/^Collected/))
    expect(square(/^Collected/)).toHaveAttribute('aria-pressed', 'true')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2)
    await userEvent.click(square(/^Collected/))                              // pressed again: all
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4)
  })

  it('has a square for each revision — one visit to every site — with how many are done, and the status squares follow the one picked', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null }),
      visit({ session: 'R0002', deployment: 'R0002-TATR_0001', deployment_status: 'open' }),
      visit({ session: 'R0002', location_id: 'TATR_0002', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null }),
      visit({ session: 'R0003', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null }),
    ] })
    await pickProject()
    const revisions = await screen.findByRole('region', { name: 'Revision' })
    const pick = (name: RegExp) => within(revisions).getByRole('button', { name })

    expect(within(revisions).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['All revisions2 of 5 done40%', 'R00030 of 1 done', 'R00022024-09-04 → …1 of 2 done', 'R00012024-09-04 → …1 of 2 done'])

    await userEvent.click(pick(/^R0002/))
    expect(pick(/^R0002/)).toHaveAttribute('aria-pressed', 'true')
    const squares = screen.getByRole('region', { name: 'Visits by status' })
    expect(within(squares).getByRole('button', { name: /^Deployed/ })).toHaveTextContent('1')
    expect(squares).toHaveTextContent('50%'); expect(within(squares).getByText('1 pending visit')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Visits' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['R0002', 'R0002'])

    await userEvent.click(pick(/^All revisions/))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(5)
  })

  it('filters by status from the selector as from the cards', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'open' }),
      visit({ session: 'R0001', location_id: 'TATR_0002', date: '', time: '', actions: [], not_done: true, sd: null, camera_id: null, trappers: null }),
    ] })
    await pickProject()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'Planned')
    expect(within(screen.getByRole('table', { name: 'Visits' })).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Planned' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('pages the visits, ten at a time, and goes back to the first page when the filter changes', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: Array.from({ length: 23 }, (_, n) => visit({ session: `R${String(n + 1).padStart(4, '0')}`, date: `2024-09-${String(n + 1).padStart(2, '0')}`, location_id: n === 22 ? 'TATR_0099' : 'TATR_0001' })) })
    await pickProject()
    await showAll()

    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(10)
    expect(screen.getByText(/Showing 1–10 of 23 visits/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(3)
    expect(screen.getByText(/Showing 21–23 of 23 visits/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')

    await userEvent.type(screen.getByLabelText('Filter the visits'), '0099')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument() // one page: nothing to page
  })

  it('sorts by a column, and turns it round when it is pressed again — the rows not made always last', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ location_id: 'TATR_0002', session: 'R0001', date: '2024-09-05', actions: ['Installation'] }),
      visit({ location_id: 'TATR_0001', session: 'R0001', date: '2024-09-07', actions: ['Revision'], deployment_status: 'open' }),
      visit({ location_id: 'TATR_0003', session: 'R0001', date: '', time: '', actions: [], not_done: true, camera_id: null, sd: null, trappers: null }),
      visit({ location_id: 'TATR_0004', session: 'R0001', date: '2024-09-06', actions: ['Revision'], deployment_status: 'closed', deployment: 'R0001-TATR_0004', deployment_id: 'R0001-TATR_0004' }),
    ] })
    await pickProject()
    const table = await screen.findByRole('table', { name: 'Visits' })
    const where = () => within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)

    await userEvent.click(within(table).getByRole('button', { name: 'Location' }))
    expect(where()).toEqual(['TATR_0001', 'TATR_0002', 'TATR_0003', 'TATR_0004'])
    expect(within(table).getByRole('columnheader', { name: /Location/ })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(within(table).getByRole('button', { name: 'Location' }))
    expect(where()).toEqual(['TATR_0004', 'TATR_0003', 'TATR_0002', 'TATR_0001'])
    expect(within(table).getByRole('columnheader', { name: /Location/ })).toHaveAttribute('aria-sort', 'descending')

    await userEvent.click(within(table).getByRole('button', { name: 'When' }))
    expect(where()).toEqual(['TATR_0002', 'TATR_0004', 'TATR_0001', 'TATR_0003']) // oldest first, the one not made last
    await userEvent.click(within(table).getByRole('button', { name: 'When' }))
    expect(where()).toEqual(['TATR_0001', 'TATR_0004', 'TATR_0002', 'TATR_0003']) // newest first, the one not made still last

    await userEvent.click(within(table).getByRole('button', { name: 'Status' }))
    expect(where().slice(0, 2)).toEqual(['TATR_0004', 'TATR_0001']) // closed, then open
  })

  it('has the session first, then where and when, the status of the visit (closed or open), the actions and whether its images are stored (a tick, or the button to create the deployment)', async () => {
    await pickProject()
    await showAll()

    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getAllByRole('columnheader').slice(1, 7).map((h) => h.textContent)).toEqual(['Revision', 'Location', 'When', 'Actions', 'Status', 'Images'])
    const [first, second] = within(table).getAllByRole('row').slice(1)
    expect(within(first).getAllByRole('cell').slice(1, 7).map((c) => c.textContent)).toEqual(['R0004', 'TATR_0001', '12 Oct 2024, 09:00', 'Revision', 'Deployed', ''])
    // a tick when the images are stored — the deployment is created and imported —, a button to create it when the visit is closed and they are not
    expect(within(table).getAllByRole('button', { name: /^Details of the deployment/ })).toHaveLength(1) // a tick, not the id of the deployment
    expect(within(table).getByRole('button', { name: /^Details of the deployment/ })).toHaveAttribute('title', 'Show image details')
    expect(within(table).queryByText('R0003-TATR_0002')).not.toBeInTheDocument()
    // a visit that is closed and has no deployment yet has its button to store the images beside View, in the last column — not in Images, which says it is not stored
    expect(within(table).getAllByLabelText('Images not stored')).toHaveLength(2)
    expect(within(second).getAllByRole('cell').slice(1, 7).map((c) => c.textContent)).toEqual(['R0003', 'TATR_0001', '4 Sep 2024, 09:00', 'Installation', 'Collected', ''])
    // the options are icons, and only the ones that apply: a closed visit without a deployment has its button to create it; the open one, nothing to create yet
    const options = (row: HTMLElement) => within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label')?.replace(/ to .*$/, '').replace(/ of the visit .*$/, '')).filter((l) => /^(View the visit|Create the visit|Create the deployment)/.test(l ?? ''))
    expect(options(second)).toEqual(['View the visit R0003', 'Create the deployment'])
    expect(options(first)).toEqual(['View the visit R0004'])
  })

  it('links the tick of a visit with a deployment to the status of the deployment', async () => {
    const onShowDeployment = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onShowDeployment={onShowDeployment} />)
    await showAll()
    await screen.findByRole('table', { name: 'Visits' })

    expect(screen.queryByRole('tab')).not.toBeInTheDocument() // the deployments are on Manage deployments, not here
    await userEvent.click(screen.getByRole('button', { name: 'Details of the deployment R0003-TATR_0002' }))
    expect(onShowDeployment).toHaveBeenCalledWith('R0003-TATR_0002')
  })

  it('shows the details of a visit, and creates the deployment of a closed visit that has none yet', async () => {
    const onImportImages = vi.fn()
    render(<VisitBookPage onBack={vi.fn()} onImportImages={onImportImages} />)
    await showAll()
    await screen.findByRole('table', { name: 'Visits' })

    await userEvent.click(screen.getByRole('button', { name: 'View the visit R0004 to TATR_0001' }))
    const panel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' }))      // in a panel at the right
    expect(panel.getByText('pilas cambiadas')).toBeInTheDocument()
    // opening R0004 shows the visit before it that left the card it collects — R0003 — and then R0004: the camera and the card are of the first, the photos and the notes of the second
    expect(within(panel.getByRole('region', { name: 'The visit that left the card' })).getByText('R0003')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'The visit that collected it' })).getByText('R0004')).toBeInTheDocument()
    expect(panel.getByText('P800')).toBeInTheDocument()
    expect(panel.getByText('A13')).toBeInTheDocument()
    expect(panel.getByText('241 images')).toBeInTheDocument()
    await userEvent.click(panel.getByRole('button', { name: 'Close' }))
    expect(within(screen.getByRole('table', { name: 'Visits' })).queryByRole('columnheader', { name: 'Camera' })).not.toBeInTheDocument()

    // only a closed visit offers it — not the open one, nor the closed one already imported
    expect(screen.getAllByRole('button', { name: /Create the deployment of the visit/ }).filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Create the deployment of the visit R0003 to TATR_0001' }))
    expect(onImportImages).toHaveBeenCalledWith({ researchProjectId: 'TATR', visit: expect.objectContaining({ session: 'R0003', location_id: 'TATR_0001' }) })
  })

  it('says where it hangs from, the menu, and goes back there', async () => {
    const onBack = vi.fn()
    const onMenu = vi.fn()
    // The path is said in the header of the application.
    render(<TrailProvider onMenu={onMenu}><Navbar version={null} onHome={vi.fn()} onOpenSettings={vi.fn()} settingsOpen={false} /><VisitBookPage onBack={onBack} onOpenSettings={vi.fn()} /></TrailProvider>)

    const here = await screen.findByRole('navigation', { name: 'You are here' })
    expect(here).toHaveTextContent('Menu›Visit dashboard')
    await userEvent.click(within(here).getByRole('button', { name: 'Menu' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('opens on the visit a link of the deployments dashboard goes to: its revision picked and its row the current one', async () => {
    render(<VisitBookPage onBack={vi.fn()} focus={{ session: 'R0003', site: 'TATR_0002' }} />)

    const row = await screen.findByRole('row', { name: /R0003.*TATR_0002/ })
    await waitFor(() => expect(row).toHaveAttribute('aria-current', 'true'))
    expect(within(screen.getByRole('region', { name: 'Revision' })).getByRole('button', { name: /^R0003/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('has no chevron to open the details inside the table: the eye of the row opens them in a panel', async () => {
    await pickProject()
    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).queryByRole('button', { name: /^(Show|Hide) the details of the visit/ })).not.toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Revision', 'Location', 'When', 'Actions', 'Status', 'Images', 'What to do'])   // the first is the box to tick the visits
  })

  it('keeps the marked visit when the view changes to the map: its site is the chosen point, with its card open', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    const table = await screen.findByRole('table', { name: 'Visits' })
    await userEvent.click(within(table).getByText('TATR_0002').closest('tr')!)                          // a row is marked
    expect(within(table).getByText('TATR_0002').closest('tr')).toHaveAttribute('aria-current', 'true')

    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })

    expect(await within(map).findByRole('button', { name: /^TATR_0002/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(map).getByRole('region', { name: 'Details of TATR_0002' })).toBeInTheDocument()
    expect(within(map).getByRole('button', { name: /^TATR_0001/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the sites on a map — a point for each, coloured by its latest visit — and a point goes to its visit in the table', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: 'Europe/Warsaw', coordinate_uncertainty: 5, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))

    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    expect(await within(map).findByRole('button', { name: 'TATR_0001: Deployed · R0004. Choose it' })).toBeInTheDocument()   // the latest visit of the site says its colour
    expect(within(map).getByRole('button', { name: 'TATR_0002: Collected · R0003. Choose it' })).toBeInTheDocument()
    expect(within(map).getByText('2 locations on the map')).toBeInTheDocument()
    const legend = within(map).getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Deployed').parentElement).toHaveTextContent('1')
    expect(within(legend).getByText('Collected').parentElement).toHaveTextContent('1')
    expect(screen.queryByRole('table', { name: 'Visits' })).not.toBeInTheDocument()                      // the table is not there while the map is

    await userEvent.hover(within(map).getByRole('button', { name: /^TATR_0001/ }))
    const card = await within(map).findByRole('region', { name: 'Details of TATR_0001' })
    expect(card).toHaveTextContent('Ridge')
    expect(card).toHaveTextContent('49.2000, 20.1000')
    expect(card).toHaveTextContent('2')                                                                  // its visits, in all the revisions

    expect(within(map).queryByText('Table of the points')).not.toBeInTheDocument()                       // no table under the picture

    await userEvent.click(within(map).getByRole('button', { name: /^TATR_0002/ }))                      // choosing it keeps its card
    const details = await within(map).findByRole('region', { name: 'Details of TATR_0002' })
    expect(details).toHaveTextContent('Stream')
    expect(within(map).getByRole('button', { name: /^TATR_0002/ })).toHaveAttribute('aria-pressed', 'true')
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    await userEvent.click(within(details).getByRole('button', { name: 'Show it in the table' }))         // and takes to its visit
    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getByText('TATR_0002')).toBeInTheDocument()
    // its row is marked so that it is seen: an arrow before the revision, and it is brought into view
    const marked = within(table).getByText('TATR_0002').closest('tr')!
    expect(marked).toHaveAttribute('aria-current', 'true')
    expect(marked.querySelector('[data-marker]')).not.toBeNull()
    expect(marked.className).toContain('bg-blue-100')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(within(table).getAllByRole('row').filter((r) => r.querySelector('[data-marker]'))).toHaveLength(1)   // only that one
    expect(within(table).queryByText('R0004')).not.toBeInTheDocument()                                   // on its revision
  })

  it('has the buttons of the row in the card itself, which stays while the pointer goes from the point to it', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [{ location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null }] } as never)
    await pickProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })

    await userEvent.hover(await within(map).findByRole('button', { name: /^TATR_0001/ }))              // only pointed at, not chosen
    const card = await within(map).findByRole('region', { name: 'Details of TATR_0001' })
    const eye = within(card).getByRole('button', { name: 'View the visit R0004 to TATR_0001' })
    await userEvent.hover(eye)                                                                           // the pointer goes to the card
    await new Promise((resolve) => setTimeout(resolve, 450))                                              // longer than it takes the card to go
    expect(within(map).getByRole('region', { name: 'Details of TATR_0001' })).toBeInTheDocument()

    await userEvent.unhover(eye)                                                                         // and leaves it
    await waitFor(() => expect(within(map).queryByRole('region', { name: /^Details of/ })).not.toBeInTheDocument())
  })

  it('keeps the card of a chosen site with the buttons of its row — the eye opens the visit — and closes it', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    expect(within(map).queryByRole('region', { name: /^Details of/ })).not.toBeInTheDocument()            // nothing is chosen at first

    await userEvent.click(await within(map).findByRole('button', { name: /^TATR_0001/ }))
    const details = within(await within(map).findByRole('region', { name: 'Details of TATR_0001' }))
    expect(details.getByRole('group', { name: 'Options of the visit R0004 to TATR_0001' })).toBeInTheDocument()   // the buttons of the row
    expect(details.getByRole('button', { name: 'Edit the visit R0004 to TATR_0001' })).toBeInTheDocument()
    expect(details.getByRole('button', { name: 'Show the previous visit to TATR_0001 (R0003)' })).toBeInTheDocument()

    await userEvent.click(details.getByRole('button', { name: 'View the visit R0004 to TATR_0001' }))      // the eye
    expect(await screen.findByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' })).toBeInTheDocument()
  })

  it('zooms in on the site that was chosen, so it does not leave the view', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    await userEvent.click(await within(map).findByRole('button', { name: /^TATR_0001/ }))
    for (let i = 0; i < 4; i += 1) await userEvent.click(within(map).getByRole('button', { name: 'Zoom in' }))
    expect(within(map).getByRole('button', { name: /^TATR_0001/ })).toBeInTheDocument()                  // the one chosen is still there
    expect(within(map).queryByRole('button', { name: /^TATR_0002/ })).not.toBeInTheDocument()            // the other is far out of the view
  })

  it('closes the card of a chosen site with its cross', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [{ location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null }] } as never)
    await pickProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    await userEvent.click(await within(map).findByRole('button', { name: /^TATR_0001/ }))
    await within(map).findByRole('region', { name: 'Details of TATR_0001' })
    await userEvent.click(within(map).getByRole('button', { name: 'Close the details' }))
    expect(within(map).queryByRole('region', { name: /^Details of/ })).not.toBeInTheDocument()
  })

  it('zooms the map in and out with the buttons at its corner, shows all the sites again, and moves it by dragging', async () => {
    window.localStorage.clear()
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))
    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    await waitFor(() => expect(document.querySelectorAll('img[data-tile]').length).toBeGreaterThan(0))
    const zoom = () => Number(/openstreetmap\.org\/(\d+)\//.exec((document.querySelector('img[data-tile]') as HTMLImageElement).src)![1])
    const ticks = () => within(map).getAllByText(/°$/).map((t) => t.textContent).join(' ')
    const fitted = zoom(), fittedTicks = ticks()
    expect(within(map).getByRole('button', { name: 'Show all the locations' })).toBeDisabled()               // already showing them all

    await userEvent.click(within(map).getByRole('button', { name: 'Zoom in' }))
    expect(zoom()).toBeGreaterThan(fitted)                                                                 // closer: more detailed tiles
    expect(ticks()).not.toBe(fittedTicks)
    expect(within(map).getByRole('button', { name: 'Show all the locations' })).toBeEnabled()
    await userEvent.click(within(map).getByRole('button', { name: 'Zoom out' }))
    await userEvent.click(within(map).getByRole('button', { name: 'Zoom out' }))
    expect(zoom()).toBeLessThan(fitted)                                                                    // further: wider tiles
    await userEvent.click(within(map).getByRole('button', { name: 'Show all the locations' }))
    expect(zoom()).toBe(fitted)
    expect(ticks()).toBe(fittedTicks)

    // dragging moves what is looked at
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 500, top: 0, left: 0, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) })
    const surface = map.querySelector('svg[viewBox^="0 0 1000"]')!                                         // the map, not the icon of a button
    const pointer = (type: string, clientX: number, clientY: number) => fireEvent(surface, new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }))   // jsdom has no PointerEvent
    pointer('pointerdown', 500, 200)
    pointer('pointermove', 700, 260)
    pointer('pointerup', 700, 260)
    box.mockRestore()
    expect(ticks()).not.toBe(fittedTicks)
    expect(within(map).getByRole('button', { name: 'Show all the locations' })).toBeEnabled()
  })

  it('draws the map of OpenStreetMap behind the points, with its attribution, and the button of the background turns it off and keeps it off', async () => {
    window.localStorage.clear()
    mockedApi.listLocalLocations.mockResolvedValue({ results: [
      { location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
      { location_id: 'TATR_0002', name: 'Stream', latitude: 49.25, longitude: 20.2, timezone: null, coordinate_uncertainty: null, trapper_pk: null },
    ] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))

    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    const tiles = () => [...document.querySelectorAll<HTMLImageElement>('img[data-tile]')]
    await waitFor(() => expect(tiles().length).toBeGreaterThan(0))
    expect(tiles().every((t) => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(t.src))).toBe(true)
    expect(tiles().length).toBeLessThanOrEqual(36)
    expect(within(map).getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')

    // no connection: every tile fails, and it says so — the points are there all the same
    tiles().forEach((t) => fireEvent.error(t))
    expect(await within(map).findByRole('status')).toHaveTextContent('could not be loaded')
    expect(within(map).getByRole('button', { name: /^TATR_0001/ })).toBeInTheDocument()

    await userEvent.click(within(map).getByRole('button', { name: 'Background map' }))
    expect(within(map).getByRole('button', { name: 'Background map' })).toHaveAttribute('aria-pressed', 'false')
    expect(tiles()).toHaveLength(0)
    expect(window.localStorage.getItem('wildintel.mapBackground')).toBe('off')                           // kept for the next time
    expect(within(map).queryByRole('status')).not.toBeInTheDocument()
  })

  it('says how many sites the map leaves out for having no coordinates, and the filters of the table apply to it', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [{ location_id: 'TATR_0001', name: 'Ridge', latitude: 49.2, longitude: 20.1, timezone: null, coordinate_uncertainty: null, trapper_pk: null }] } as never)
    await pickProject()
    await showAll()
    await userEvent.click(await screen.findByRole('button', { name: 'Show the visits on a map' }))

    const map = await screen.findByRole('group', { name: 'Visits on a map' })
    expect(await within(map).findByText('1 location on the map · 1 with no coordinates, not drawn')).toBeInTheDocument()   // TATR_0002 has no place

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter the visits' }), 'TATR_0002')
    expect(await within(await screen.findByRole('group', { name: 'Visits on a map' })).findByText(/None of the 1 locations has coordinates/)).toBeInTheDocument()
  })

  it('marks a row when it is pressed — and clears it when it is pressed again — without scrolling the page', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    await pickProject()
    await showAll()
    const table = await screen.findByRole('table', { name: 'Visits' })
    const row = (site: string, session: string) => within(table).getAllByRole('row').find((r) => r.textContent?.includes(site) && r.textContent?.includes(session))!
    expect(table.querySelector('tr[aria-current]')).toBeNull()

    await userEvent.click(within(row('TATR_0002', 'R0003')).getByText('Installation'))                    // a plain part of the row
    expect(row('TATR_0002', 'R0003')).toHaveAttribute('aria-current', 'true')
    expect(row('TATR_0002', 'R0003').querySelector('[data-marker]')).not.toBeNull()
    await userEvent.click(within(row('TATR_0001', 'R0004')).getByText('Revision'))                         // another one: the mark goes to it
    expect(row('TATR_0001', 'R0004')).toHaveAttribute('aria-current', 'true')
    expect(row('TATR_0002', 'R0003')).not.toHaveAttribute('aria-current')
    await userEvent.click(within(row('TATR_0001', 'R0004')).getByText('Revision'))                         // pressed again, it is cleared
    expect(table.querySelector('tr[aria-current]')).toBeNull()

    await userEvent.click(within(row('TATR_0002', 'R0003')).getByRole('button', { name: 'View the visit R0003 to TATR_0002' }))   // a button of the row only does what it does
    expect(table.querySelector('tr[aria-current]')).toBeNull()
    expect(await screen.findByRole('dialog', { name: 'Details of the visit R0003 to TATR_0002' })).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()                                                          // pressing never moves the page
  })

  const planned = (session: string, sites: string[]) => sites.map((site) => visit({ session, location_id: site, date: '', time: '', actions: [], sd: null, camera_id: null, trappers: null, when: null, not_done: true, state: 'planned' }))

  it('plans the next revision with a button — a visit to each location that is ready — and opens the visit book on it', async () => {
    mockedApi.createRevision.mockResolvedValue({ session: 'R0005', planned: ['TATR_0001', 'TATR_0002'], previous: null })
    await pickProject()
    const first = (await mockedApi.visitBook.mock.results[0].value).results
    mockedApi.visitBook.mockResolvedValue({ results: [...first, ...planned('R0005', ['TATR_0001', 'TATR_0002'])] } as never)

    await userEvent.click(await screen.findByRole('button', { name: 'Create the next revision' }))
    expect(mockedApi.createRevision).toHaveBeenCalledWith('TATR')
    const notice = (await screen.findByText(/has been created/)).closest('[role="status"]') as HTMLElement
    expect(notice).toHaveTextContent('R0005 has been created: a visit is planned to each of the 2 locations that can be visited (TATR_0001, TATR_0002)')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()                                          // the revision before is finished: nothing to warn of
    await waitFor(() => expect(screen.getByRole('button', { name: /^R0005/ })).toHaveAttribute('aria-pressed', 'true'))   // the book is on the new revision
    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2)                                    // a planned visit to each
    expect(within(table).getAllByText('Planned')).toHaveLength(2)

    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/has been created/)).not.toBeInTheDocument()
  })

  // R0005 was planned and has no visit; R0004 still has TATR_0002 to be visited: R0005 cannot take a visit until R0004 is finished
  const base = () => [visit({}), visit({ session: 'R0004', date: '2024-10-12', actions: ['Revision'], deployment_status: 'open' }), visit({ location_id: 'TATR_0002' })]
  const unfinishedBook = () => ({ results: [...base(), ...planned('R0004', ['TATR_0002']), ...planned('R0005', ['TATR_0001', 'TATR_0002'])] }) as never
  const finishedBook = () => ({ results: [...base(), visit({ session: 'R0004', location_id: 'TATR_0002', date: '2024-10-12', time: '23:59:00', actions: [], not_visited: true, state: 'not_visited' }), ...planned('R0005', ['TATR_0001', 'TATR_0002'])] }) as never

  it('says whenever a planned revision has no visit and the one before is not finished — with no need to press anything — and offers to finish it by marking what is left as not visited', async () => {
    mockedApi.visitBook.mockResolvedValue(unfinishedBook())
    mockedApi.markNotVisited.mockResolvedValue({ session: 'R0004', marked: ['TATR_0002'] })
    await pickProject()

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('R0005 is planned, but R0004 is not finished: 1 location is still to be visited in it (TATR_0002). No visit can be made in R0005 until it is finished')
    expect(mockedApi.markNotVisited).not.toHaveBeenCalled()                                             // nothing is marked by itself

    await userEvent.click(within(warning).getByRole('button', { name: 'Mark them as not visited' }))
    const sure = await screen.findByRole('alert')
    expect(sure).toHaveTextContent('the visit book of R0004 will be consolidated')                      // asked again, as the form of a visit does
    await userEvent.click(within(sure).getByRole('button', { name: 'Cancel' }))
    expect(mockedApi.markNotVisited).not.toHaveBeenCalled()

    mockedApi.visitBook.mockResolvedValue(finishedBook())                                               // the book as it is read again, with the visit that could not be made
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Mark them as not visited' }))
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Yes, mark them as not visited' }))
    expect(mockedApi.markNotVisited).toHaveBeenCalledWith('TATR', 'R0004')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())                    // it is finished now: nothing to say
  })

  it('says nothing of the revision before when the planned one has a visit, or the one before is finished', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [...base(), ...planned('R0004', ['TATR_0002']), visit({ session: 'R0005', date: '2024-11-12', actions: ['Revision'] })] } as never)   // R0005 has a visit
    await pickProject()
    await screen.findByRole('table', { name: 'Visits' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says why the next revision could not be planned, and still offers to finish the revision before when that is what is in the way', async () => {
    mockedApi.visitBook.mockResolvedValue(unfinishedBook())
    mockedApi.createRevision.mockRejectedValue(new Error('R0005 is planned and has no visit yet: register its first visit before planning the next revision.'))
    await pickProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Create the next revision' }))

    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' | ')).toContain('R0005 is planned and has no visit yet'))   // what it said
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' | ')).toContain('R0004 is not finished')
    expect(screen.getByRole('button', { name: 'Mark them as not visited' })).toBeInTheDocument()       // and the way to finish it
    expect(screen.queryByText(/has been created/)).not.toBeInTheDocument()
  })

  it('offers to close a planned revision that has no visit by marking all its locations as not visited, and then plans the next one', async () => {
    mockedApi.createRevision
      .mockRejectedValueOnce(new Error('R0004 is planned and has no visit yet: register its first visit before planning the next revision.'))
      .mockResolvedValueOnce({ session: 'R0005', planned: ['TATR_0001'], previous: null })
    mockedApi.markNotVisited.mockResolvedValue({ session: 'R0004', marked: ['TATR_0001'] })
    await pickProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Create the next revision' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Mark R0004 as not visited' }))
    expect(mockedApi.markNotVisited).not.toHaveBeenCalled()                          // it asks first: it cannot be undone
    await userEvent.click(screen.getByRole('button', { name: 'Yes, mark them and plan the next revision' }))

    await waitFor(() => expect(mockedApi.markNotVisited).toHaveBeenCalledWith('TATR', 'R0004'))
    await waitFor(() => expect(mockedApi.createRevision).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/has been created/)).toBeInTheDocument()
  })

  it('says Site start for the visit that starts a site', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [visit({ session: 'R0004', actions: ['SiteStart', 'Installation'], deployment: 'R0004-TATR_0001', deployment_status: 'open' })] })
    await pickProject()

    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Site start + Installation')
  })

  it('shows the visits as a table, as labels or on a map — three buttons at the right of Reset', async () => {
    await pickProject()
    await screen.findByRole('table', { name: 'Visits' })
    expect(screen.getAllByRole('button', { name: /^Show the visits/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Show the visits as a table', 'Show the visits as labels', 'Show the visits on a map'])

    await userEvent.click(screen.getByRole('button', { name: 'Show the visits as labels' }))
    expect(screen.queryByRole('table', { name: 'Visits' })).not.toBeInTheDocument()
    const label = screen.getByRole('article', { name: 'Visit R0004 to TATR_0001' })
    expect(label).toHaveTextContent('R0004 · Revision')
    expect(label).toHaveTextContent('Deployed')
    await userEvent.click(within(label).getByRole('button', { name: 'View the visit R0004 to TATR_0001' }))
    expect(await screen.findByRole('dialog', { name: 'Details of the visit R0004 to TATR_0001' })).toBeInTheDocument()
  })

  it('tells the filters that are on, clears the search with its cross, and puts all of them back with Reset', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed' }),
      visit({ session: 'R0002', deployment: 'R0002-TATR_0001', deployment_status: 'open' }),
    ] })
    await pickProject()
    await showAll()
    const active = await screen.findByLabelText('Active filters')
    expect(active).toHaveTextContent('Revision: All'); expect(active).toHaveTextContent('Status: All'); expect(active).toHaveTextContent('2 of 2 visits match')

    await userEvent.click(within(screen.getByRole('region', { name: 'Visits by status' })).getByRole('button', { name: 'Deployed' }))
    await userEvent.type(screen.getByLabelText('Filter the visits'), 'R0002')
    expect(active).toHaveTextContent('Status: Deployed'); expect(active).toHaveTextContent('1 of 2 visits match')

    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }))
    expect(screen.getByLabelText('Filter the visits')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Reset the filters' }))
    expect(screen.getByLabelText('Status')).toHaveValue('')
    expect(active).toHaveTextContent('Status: All'); expect(active).toHaveTextContent('2 of 2 visits match')
  })

  it('folds away the revisions and the status cards with their chevron, to leave the table alone, and brings them back', async () => {
    await pickProject()
    await screen.findByRole('table', { name: 'Visits' })
    expect(screen.getByRole('group', { name: 'Revision' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Visits by status' })).toHaveTextContent('Click a card')

    await userEvent.click(screen.getByRole('button', { name: 'Fold away the revision selection' }))
    expect(screen.queryByRole('group', { name: 'Revision' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fold away the status metrics' }))
    expect(within(screen.getByRole('region', { name: 'Visits by status' })).queryAllByRole('button', { name: 'Deployed' })).toHaveLength(0)
    expect(screen.getByRole('table', { name: 'Visits' })).toBeInTheDocument()                    // the table stays

    await userEvent.click(screen.getByRole('button', { name: 'Show the revision selection' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show the status metrics' }))
    expect(screen.getByRole('group', { name: 'Revision' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Visits by status' })).getAllByRole('button', { name: 'Deployed' })).toHaveLength(1)
  })

  it('opens the legend and the help in a panel from the header, and closes it with its button, the one at the foot, the background or Escape', async () => {
    await pickProject()
    await screen.findByRole('table', { name: 'Visits' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    const panel = await screen.findByRole('dialog', { name: 'Dashboard legend and help' })
    expect(within(panel).getByText('Visit states')).toBeInTheDocument()
    expect(within(panel).getByText('Collected')).toBeInTheDocument()
    expect(within(panel).getByText('Overall progress')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Got it, close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Close the help' })[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says Stolen of the visit whose camera was stolen, with no button to create a deployment', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', deployment: 'R0001-TATR_0001', deployment_status: 'closed', deployment_no_images: 'stolen' }),
    ] })
    render(<VisitBookPage onBack={vi.fn()} onImportImages={vi.fn()} />)

    const table = await screen.findByRole('table', { name: 'Visits' })
    const row = within(table).getAllByRole('row')[1]
    expect(within(row).getByText('Stolen')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Create the deployment of the visit/ })).not.toBeInTheDocument()
    const cards = screen.getByRole('region', { name: 'Visits by status' })
    expect(within(cards).getByRole('button', { name: 'Stolen' })).toHaveTextContent('1')
    expect(within(cards).getByRole('button', { name: 'Collected' })).toHaveTextContent('0')
  })

  it('edits a visit that is not locked, and shows what the server refuses', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', comments: 'before', deployment_status: 'open' }),
      visit({ session: 'R0002', location_id: 'TATR_0002', locked: true, deployment_status: 'closed' }),
    ] })
    mockedApi.updateVisit.mockRejectedValueOnce(new Error('R0002 TATR_0001 would no longer be possible'))
    await pickProject()
    await showAll()

    expect(await screen.findByRole('button', { name: 'Edit the visit R0002 to TATR_0002' })).toBeDisabled()   // it closes a deployment that is imported
    await userEvent.click(screen.getByRole('button', { name: 'Edit the visit R0001 to TATR_0001' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Edit R0001 of TATR_0001' }))
    await userEvent.clear(dialog.getByLabelText('Notes'))
    await userEvent.type(dialog.getByLabelText('Notes'), 'after')
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('would no longer be possible')

    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    expect(mockedApi.updateVisit).toHaveBeenLastCalledWith('TATR', expect.objectContaining({ location_id: 'TATR_0001', session: 'R0001', comments: 'after' }))
    expect(mockedApi.visitBook).toHaveBeenCalledTimes(2)   // the book is read again
  })

  it('offers only the statuses of the camera that are accepted, and shows the one a visit was kept with that is not, so that it can be changed', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [visit({ session: 'R0001', camera_status: 'Damaged', deployment_status: 'open' })] })
    await pickProject()
    await showAll()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit the visit R0001 to TATR_0001' }))
    const status = within(screen.getByRole('dialog', { name: 'Edit R0001 of TATR_0001' })).getByLabelText('Status of the camera')
    expect(within(status).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not said', 'OK', 'Altered', 'Stolen', 'Not revised', 'New site', 'Inactive site', 'Damaged (no longer accepted)'])
    expect(status).toHaveValue('Damaged')
  })

  it('shows an unknown visit as Unknown, with nothing to see, and fills it in with a known one', async () => {
    mockedApi.visitBook.mockResolvedValue({ results: [
      visit({ session: 'R0001', date: '', time: '', actions: [], sd: null, camera_id: null, trappers: null, when: null, unknown: true, locked: true, state: 'unknown' }),
      visit({ session: 'R0002', deployment_status: 'open' }),
    ] })
    mockedApi.saveVisit.mockResolvedValue({} as never)
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' }, FIELDWORK: {
      cameras: [{ label: 'P800', camera_id: 'P800', camera_model: 'Reconyx-PC800', research_project: 'TATR', status: 'active' }, { label: 'OTHER', camera_id: 'OTHER', research_project: 'DONA', status: 'active' }],
      sd_cards: [{ label: 'A13', research_project: 'TATR', status: 'active' }], trappers: [{ name: 'Ana', affiliation: null }],
    } } as never)
    await pickProject()
    await showAll()

    const table = await screen.findByRole('table', { name: 'Visits' })
    expect(within(table).getByText('Unknown')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'View the visit R0001 to TATR_0001' })).not.toBeInTheDocument()
    await userEvent.click(within(table).getByRole('button', { name: 'Fill in the visit R0001 to TATR_0001' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Fill in R0001 of TATR_0001' }))
    await userEvent.type(dialog.getByLabelText('Day'), '2024-06-01')
    await userEvent.type(dialog.getByLabelText('Time'), '10:00:00')
    // the camera, the SD card and who went are the ones of the settings, of this research project: another one cannot be typed
    await userEvent.type(dialog.getByLabelText('Camera'), 'OTHER')
    expect(dialog.getByText('No matches')).toBeInTheDocument()
    await userEvent.clear(dialog.getByLabelText('Camera'))
    await userEvent.type(dialog.getByLabelText('Camera'), 'P800')
    await userEvent.click(dialog.getByRole('option', { name: 'P800' }))
    expect(dialog.getByText('Model: Reconyx-PC800')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Ana' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Fill in' }))
    expect(mockedApi.saveVisit).toHaveBeenCalledWith('TATR', expect.objectContaining({ location_id: 'TATR_0001', session: 'R0001', date: '2024-06-01', time: '10:00:00', actions: ['Installation'], camera_id: 'P800', trappers: 'Ana' }))
  })
})
