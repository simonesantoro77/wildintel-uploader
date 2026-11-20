import { renderWithHeader } from '../test/renderWithHeader'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import DeploymentStatusPage from './DeploymentStatusPage'

vi.mock('../api', () => ({ api: { listResearchProjects: vi.fn(), fieldDeployments: vi.fn(), getSettings: vi.fn(), collectionPath: vi.fn(), listLocalDeployments: vi.fn(), visitBook: vi.fn(), listVisits: vi.fn(), listLocalLocations: vi.fn() } }))
const mockedApi = vi.mocked(api)

const deployment = (over: object) => ({
  deployment_id: 'R0003-TATR_0001', collection: 'R0003', site: 'TATR_0001', status: 'closed', start: '2024-09-04T09:00:00Z', end: '2024-10-12T09:30:00Z', setup_by: 'Ana', camera_id: 'P800',
  card: 'A13', photos_counted: 241, start_session: 'R0003', end_session: 'R0004', images_stored: true, on_trapper: false, ...over,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ name: 'Tatra', acronym: 'TATR' }] } as never)
  mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' } } as never)
  mockedApi.fieldDeployments.mockResolvedValue({ results: [
    deployment({ on_trapper: true, uploaded_at: '2024-10-20T10:00:00+00:00' }),
    deployment({ deployment_id: 'R0003-TATR_0002', site: 'TATR_0002', card: 'C7', photos_counted: 10 }),
    deployment({ deployment_id: 'R0003-TATR_0003', site: 'TATR_0003', card: 'C8', photos_counted: 12, images_stored: false }),
    deployment({ deployment_id: 'R0004-TATR_0001', collection: 'R0004', status: 'open', start: '2024-10-12T09:30:00Z', end: null, card: 'B2', photos_counted: null, images_stored: false }),
  ] })
})

const showAll = async () => { await userEvent.click(await screen.findByRole('button', { name: /^All revisions/ })) }  // the dashboard opens on the latest revision

describe('DeploymentStatusPage', () => {
  it('is of the default research project, which the header says and lets change', async () => {
    renderWithHeader(<DeploymentStatusPage onBack={vi.fn()} onOpenSettings={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Default research project' })).toHaveTextContent('TATR')
    await waitFor(() => expect(mockedApi.fieldDeployments).toHaveBeenCalledWith('TATR'))
  })

  it('opens the data of the SD card of a deployment in a panel at the right, with a way on to its state in the settings', async () => {
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'TATR' }, FIELDWORK: { sd_cards: [
      { label: 'A13', brand: 'SanDisk', capacity: '64 GB', in_service: '2025-01-10', research_project: 'TATR', status: 'active' },
      { label: 'C7', brand: 'Other', capacity: '8 GB', in_service: null, research_project: 'OTHER' },
    ] } } as never)
    const onOpenSettings = vi.fn()
    render(<DeploymentStatusPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await showAll()

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    await userEvent.click(within(region).getAllByRole('button', { name: 'Show the state of the SD card A13' })[0])
    const panel = within(await screen.findByRole('dialog', { name: 'Details of the SD card A13' }))
    expect(panel.getByRole('heading', { name: 'A13' })).toBeInTheDocument()
    expect(panel.getByText('SanDisk', { selector: 'dd' })).toBeInTheDocument()
    expect(onOpenSettings).not.toHaveBeenCalled()                           // it goes to the settings from the panel, not at once

    await userEvent.click(panel.getByRole('button', { name: 'Open it in the settings' }))
    expect(onOpenSettings).toHaveBeenCalledWith('sdcards', 'TATR', 'A13')
    expect(screen.queryByRole('dialog', { name: /Details of the SD card/ })).not.toBeInTheDocument()

    // one that is not among the SD cards of the research project says so (C7 is of another)
    await userEvent.click(within(region).getAllByRole('button', { name: 'Show the state of the SD card C7' })[0])
    expect(screen.getByText(/The SD card C7 is not one of the SD cards of this research project yet/)).toBeInTheDocument()
  })

  it('tells the period of a deployment on the wall clock of its location, with the timezone beside in brackets', async () => {
    mockedApi.fieldDeployments.mockResolvedValue({ results: [
      deployment({ start: '2024-09-04T07:00:00Z', end: '2024-10-12T07:30:00Z', start_local: '2024-09-04T09:00:00', end_local: '2024-10-12T09:30:00', timezone: 'Europe/Madrid' }),
    ] })
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    const table = await screen.findByRole('table', { name: 'Deployments' })

    expect(within(table).getByText('4 Sep 2024, 09:00 → 12 Oct 2024, 09:30 (Europe/Madrid)')).toBeInTheDocument()      // not the instants in UTC, which are two hours before
  })

  it('has the deployments as a book: a square for each revision, the status squares of the one picked, and a table', async () => {
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    await showAll()

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    const revisions = within(region).getByRole('region', { name: 'Revision' })
    expect(within(revisions).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['All revisions4 deployments50%', 'R00041 deployment', 'R00033 deployments'])   // the first button folds the section away
    const squares = within(region).getByRole('region', { name: 'Deployments by status' })
    const square = (name: RegExp) => within(squares).getByRole('button', { name })
    expect(squares).toHaveTextContent('2/ 4')      // created, of all that was planned
    expect(square(/^Planned/)).toHaveTextContent('2')                 // a card was left: the deployment is to be created — the camera may be still out
    expect(square(/^Created/)).toHaveTextContent('2')                 // the images stored — whether they were uploaded is another thing, told by the Upload column
    expect(within(squares).queryByRole('button', { name: /^Uploaded/ })).not.toBeInTheDocument()

    await userEvent.click(within(revisions).getByRole('button', { name: /^R0003/ }))
    const table = within(region).getByRole('table', { name: 'Deployments' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Deployment', 'Visit', 'SD and images', 'Creation', 'Upload', 'What to do'])
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getAllByRole('cell').slice(1).map((c) => c.textContent)).toEqual(['R0003-TATR_0001', 'R0003 · TATR_00014 Sep 2024, 09:00 → 12 Oct 2024, 09:30', 'SD A13 · 241 images', 'Created', '', ''])
    expect(within(first).getByRole('button', { name: 'View the deployment R0003-TATR_0001' })).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: 'Uploaded' })).toBeInTheDocument() // it was uploaded: a tick

    await userEvent.click(square(/^Created/))
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['R0003-TATR_0001', 'R0003-TATR_0002'])   // both have their images stored — what was uploaded is another state
  })

  it('shows the deployments as labels, with their options, or only the search field that lists what matches as it is written and goes to the one picked', async () => {
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    await showAll()
    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    expect(within(region).getAllByRole('button', { name: /^Show (the deployments as|only the search)/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Show the deployments as a table', 'Show the deployments as labels', 'Show only the search field'])

    // labels: the same deployments, six to a page, each with what the row says and what can be done with it
    await userEvent.click(within(region).getByRole('button', { name: 'Show the deployments as labels' }))
    expect(within(region).queryByRole('table', { name: 'Deployments' })).not.toBeInTheDocument()
    const label = within(within(region).getByRole('group', { name: 'Deployments' })).getByRole('article', { name: 'Deployment R0003-TATR_0001' })
    expect(label).toHaveTextContent('Created')
    expect(label).toHaveTextContent('R0003 · TATR_0001')
    expect(label).toHaveTextContent('SD A13 · 241 images')
    expect(within(label).getByRole('img', { name: 'Uploaded' })).toBeInTheDocument()
    await userEvent.click(within(label).getByRole('button', { name: 'View the deployment R0003-TATR_0001' }))      // its details open in a panel at the right
    const panel = await screen.findByRole('dialog', { name: 'Details of the deployment R0003-TATR_0001' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))

    // only the search field: nothing until something is written, then what matches; picking one goes to it in the table
    await userEvent.click(within(region).getByRole('button', { name: 'Show only the search field' }))
    expect(within(region).queryByRole('group', { name: 'Deployments' })).not.toBeInTheDocument()
    const field = within(region).getByLabelText('Filter the deployments')
    expect(field).toHaveAttribute('placeholder', 'Select a deployment…')
    await userEvent.click(field)
    expect(within(region).queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.type(field, 'TATR_0003')
    expect(within(within(region).getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['R0003-TATR_0003 · TATR_0003 · Planned'])
    await userEvent.click(within(within(region).getByRole('listbox')).getByRole('option'))
    const table = within(region).getByRole('table', { name: 'Deployments' })
    expect(within(table).getAllByRole('row').find((r) => r.getAttribute('aria-current') === 'true')).toHaveTextContent('R0003-TATR_0003')
  })

  it('opens the legend in a panel from its button in the header, and folds away the revisions and the cards', async () => {
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    const panel = await screen.findByRole('dialog', { name: 'Dashboard legend and help' })
    expect(within(panel).getByText('Deployment states')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(within(region).getByRole('button', { name: 'Fold away the revision selection' }))
    expect(within(region).queryByRole('group', { name: 'Revision' })).not.toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Fold away the status metrics' }))
    expect(within(region).queryAllByRole('button', { name: /^Created/ })).toHaveLength(0)

    expect(within(region).queryByRole('button', { name: /^(Show|Hide) the details of the deployment/ })).not.toBeInTheDocument()   // no chevron to fold the details of a row: its eye opens them in a panel
  })

  it('shows highlighted the deployment a link of the visit book goes to, on its revision', async () => {
    render(<DeploymentStatusPage onBack={vi.fn()} focus="R0003-TATR_0002" />)

    const table = await screen.findByRole('table', { name: 'Deployments' })
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Revision' })).getByRole('button', { name: /^R0003/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(within(table).getByText('R0003-TATR_0002').closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  it('opens the visit that started a deployment in a panel at the right, with the one that collected its card, and from there goes to the visit dashboard on it', async () => {
    const stored = (over: object) => ({ location_id: 'TATR_0001', session: 'R0003', date: '2024-09-04', time: '09:00:00', actions: ['Installation'], trappers: 'Ana', camera_id: 'P800', sd: 'A13', num_photos: null, ...over }) as never
    mockedApi.listVisits.mockResolvedValue({ results: [stored({}), stored({ session: 'R0004', date: '2024-10-12', time: '09:30:00', actions: ['Revision'], num_photos: 241 })] })
    const onShowVisit = vi.fn()
    render(<DeploymentStatusPage onBack={vi.fn()} onShowVisit={onShowVisit} />)
    await screen.findByRole('table', { name: 'Deployments' })

    await userEvent.click(screen.getAllByRole('button', { name: 'Show the visit R0003 to TATR_0001' })[0])
    const panel = within(await screen.findByRole('dialog', { name: 'Details of the visit R0003 to TATR_0001' }))
    expect(mockedApi.listVisits).toHaveBeenCalledWith('TATR', 'TATR_0001')
    expect(panel.getByText('The visit that left the card')).toBeInTheDocument()
    expect(panel.getByText('The visit that collected it')).toBeInTheDocument()
    expect(panel.getByText('241 images')).toBeInTheDocument()
    expect(onShowVisit).not.toHaveBeenCalled()

    // a button under each of the two visits goes to it in the dashboard of the visits — to the visit, not to its revision
    await userEvent.click(panel.getByRole('button', { name: /Open visit R0004/ }))
    expect(onShowVisit).toHaveBeenCalledWith({ session: 'R0004', site: 'TATR_0001' })
    expect(screen.queryByRole('dialog', { name: /Details of the visit/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Show the visit R0003 to TATR_0001' })[0])
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Details of the visit R0003 to TATR_0001' })).getByRole('button', { name: /Open visit R0003/ }))
    expect(onShowVisit).toHaveBeenLastCalledWith({ session: 'R0003', site: 'TATR_0001' })
  })

  it('says when the visit of a deployment is not among the visits kept', async () => {
    mockedApi.listVisits.mockResolvedValue({ results: [] })
    render(<DeploymentStatusPage onBack={vi.fn()} onShowVisit={vi.fn()} />)
    await showAll()
    await screen.findByRole('table', { name: 'Deployments' })

    await userEvent.click(screen.getAllByRole('button', { name: 'Show the visit R0003 to TATR_0001' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('The visit R0003 to TATR_0001 was not found.')
  })

  it('opens what a created deployment says of itself in a panel at the right with its View button, and has none for one that is not created', async () => {
    mockedApi.collectionPath.mockResolvedValue({ path: '/collections/TATR/R0003', collection: 'R0003' } as never)
    mockedApi.listLocalDeployments.mockResolvedValue({ results: [{
      deployment_id: 'R0003-TATR_0002', location_id: 'TATR_0002', location_name: 'Ridge', latitude: 37.0123, longitude: -6.4412, coordinate_uncertainty: 5,
      start_date: '2024-09-04T09:00:00Z', end_date: '2024-10-12T09:30:00Z', setup_by: 'Setup: Ana Pérez | Retrieval: Luis Gómez', camera_id: 'P800', camera_model: 'GardePro', camera_interval: 5,
      detection_distance: 10, camera_height: 1.2, camera_tilt: 0, camera_heading: 90, feature_type: 'trailHiking', habitat: 'Holm oak', bait_use: false, comments: 'Setup: First camera | SD card: SD 1',
    }] } as never)
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    await showAll()
    await screen.findByRole('table', { name: 'Deployments' })

    expect(screen.queryByRole('button', { name: 'View the deployment R0003-TATR_0003' })).not.toBeInTheDocument() // not created: nothing to see
    await userEvent.click(screen.getByRole('button', { name: 'View the deployment R0003-TATR_0002' }))
    const dialog = await screen.findByRole('dialog', { name: 'Details of the deployment R0003-TATR_0002' })
    const panel = within(dialog)
    expect(await panel.findByRole('region', { name: 'Location' })).toBeInTheDocument()
    expect(mockedApi.collectionPath).toHaveBeenCalledWith('TATR', 'R0003-TATR_0002')
    expect(mockedApi.listLocalDeployments).toHaveBeenCalledWith('/collections/TATR/R0003')
    expect(panel.getByRole('heading', { name: 'R0003-TATR_0002' })).toBeInTheDocument()
    expect(panel.getByText('Created')).toBeInTheDocument()
    expect(panel.getByText('Not uploaded')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Location' })).getByText('37.0123, -6.4412')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Location' })).getByText('± 5 m')).toBeInTheDocument()
    const period = within(panel.getByRole('region', { name: 'Period' }))
    expect(period.getByText('4 Sep 2024, 09:00')).toBeInTheDocument()                     // the wall clock the date says, in the format of the app
    expect(period.getByText('Ana Pérez')).toBeInTheDocument()                             // the mix of the two visits, told as who set it up…
    expect(period.getByText('Luis Gómez')).toBeInTheDocument()                            // …and who retrieved it
    expect(period.getByText('38 days in the field')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Camera' })).getByText('GardePro')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Placement' })).getByText('90° (E)')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Site' })).getByText('Trail (hiking)')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Site' })).getByText('No')).toBeInTheDocument()
    expect(within(panel.getByRole('region', { name: 'Notes' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Setup: First camera', 'SD card: SD 1'])
    await userEvent.click(panel.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: /Details of the deployment/ })).not.toBeInTheDocument()

  })

  it('says Card full instead of the number of photos when the card was full when it was collected', async () => {
    mockedApi.fieldDeployments.mockResolvedValue({
      results: [
        deployment({ deployment_id: 'R0003-TATR_0002', site: 'TATR_0002', card: 'C7', photos_counted: null, card_full: true, images_stored: false }),
        deployment({ deployment_id: 'R0003-TATR_0003', site: 'TATR_0003', card: 'C8', photos_counted: null, images_stored: false }),
      ],
    } as never)
    render(<DeploymentStatusPage onBack={vi.fn()} />)

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    const table = within(region).getByRole('table', { name: 'Deployments' })
    const full = within(table).getByText('R0003-TATR_0002').closest('tr')!
    expect(within(full).getByText('SD C7', { exact: false }).closest('td')).toHaveTextContent('SD C7 · Card full')
    expect(within(full).getByText('Card full')).toHaveClass('bg-red-100', 'text-red-700')              // in red, as a state
    expect(within(table).getByText('R0003-TATR_0003').closest('tr')!.textContent).not.toMatch(/Card full|images/)  // no count and not full: nothing is said
  })

  it('has a button on the row of a created deployment that goes to its statistics', async () => {
    const onShowStatistics = vi.fn()
    render(<DeploymentStatusPage onBack={vi.fn()} onShowStatistics={onShowStatistics} />)
    await showAll()

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    const table = within(region).getByRole('table', { name: 'Deployments' })
    const created = within(table).getByText('R0003-TATR_0001').closest('tr')!
    await userEvent.click(within(created).getByRole('button', { name: 'Show the statistics of the deployment R0003-TATR_0001' }))
    expect(onShowStatistics).toHaveBeenCalledWith(expect.objectContaining({ deployment_id: 'R0003-TATR_0001', collection: 'R0003' }))
    // one that is not created has no images to count
    const planned = within(table).getByText('R0003-TATR_0003').closest('tr')!
    expect(within(planned).queryByRole('button', { name: /Show the statistics/ })).not.toBeInTheDocument()
  })

  const place = (location_id: string, name: string, latitude: number | null, longitude: number | null) => ({ location_id, name, latitude, longitude, timezone: null, coordinate_uncertainty: null, trapper_pk: null })

  it('keeps the marked deployment when the view changes to the map: its site is the chosen point, with its card open', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [place('TATR_0001', 'Ridge', 49.2, 20.1), place('TATR_0002', 'Stream', 49.25, 20.2), place('TATR_0003', 'Pond', 49.22, 20.3)] } as never)
    render(<DeploymentStatusPage onBack={vi.fn()} focus="R0003-TATR_0002" />)                          // the one a link goes to: marked in the table
    await userEvent.click(await screen.findByRole('button', { name: 'Show the deployments on a map' }))

    const map = await screen.findByRole('group', { name: 'Deployments on a map' })
    expect(await within(map).findByRole('button', { name: /^TATR_0002/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(map).getByRole('region', { name: 'Details of TATR_0002' })).toBeInTheDocument()
    expect(within(map).getByRole('button', { name: /^TATR_0001/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the deployments on a map — a point for each site, coloured by its state, with a tick when it was uploaded — whose card has the buttons of its row', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [place('TATR_0001', 'Ridge', 49.2, 20.1), place('TATR_0002', 'Stream', 49.25, 20.2), place('TATR_0003', 'Pond', 49.22, 20.3)] } as never)
    const onShowStatistics = vi.fn()
    render(<DeploymentStatusPage onBack={vi.fn()} onShowStatistics={onShowStatistics} />)
    await userEvent.click(await screen.findByRole('button', { name: /^R0003/ }))                         // the revision with the three sites
    expect(screen.getAllByRole('button', { name: /^Show the deployments/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Show the deployments as a table', 'Show the deployments as labels', 'Show the deployments on a map'])
    await userEvent.click(screen.getByRole('button', { name: 'Show the deployments on a map' }))

    const map = await screen.findByRole('group', { name: 'Deployments on a map' })
    expect(await within(map).findByRole('button', { name: 'TATR_0001: Created · R0003-TATR_0001 · Uploaded. Choose it' })).toBeInTheDocument()   // uploaded: it has the tick
    expect(within(map).getByRole('button', { name: 'TATR_0002: Created · R0003-TATR_0002. Choose it' })).toBeInTheDocument()                      // created, not uploaded
    expect(within(map).getByRole('button', { name: 'TATR_0003: Planned · R0003-TATR_0003. Choose it' })).toBeInTheDocument()
    const legend = within(map).getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Created').parentElement).toHaveTextContent('2')
    expect(within(legend).getByText('Planned').parentElement).toHaveTextContent('1')
    expect(within(legend).getByText('Uploaded')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Deployments' })).not.toBeInTheDocument()                  // no table while the map is

    await userEvent.click(within(map).getByRole('button', { name: /^TATR_0002/ }))                       // the card of a site
    const card = within(await within(map).findByRole('region', { name: 'Details of TATR_0002' }))
    expect(card.getByText('Stream')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'View the deployment R0003-TATR_0002' })).toBeInTheDocument()  // the buttons of its row
    await userEvent.click(card.getByRole('button', { name: 'Show the statistics of the deployment R0003-TATR_0002' }))
    expect(onShowStatistics).toHaveBeenCalledWith(expect.objectContaining({ deployment_id: 'R0003-TATR_0002' }))

    await userEvent.click(card.getByRole('button', { name: 'Show it in the table' }))                    // and to its row, marked
    const table = await screen.findByRole('table', { name: 'Deployments' })
    const row = within(table).getByText('R0003-TATR_0002').closest('tr')!
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row.querySelector('[data-marker]')).not.toBeNull()
  })

  it('shares the point of a site between its deployments in all the revisions, and says how many sites have no coordinates', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [place('TATR_0001', 'Ridge', 49.2, 20.1), place('TATR_0002', 'Stream', null, null)] } as never)
    render(<DeploymentStatusPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^All revisions/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Show the deployments on a map' }))

    const map = await screen.findByRole('group', { name: 'Deployments on a map' })
    expect(await within(map).findByText('1 site on the map · 2 with no coordinates, not drawn')).toBeInTheDocument()   // TATR_0002 has none, TATR_0003 is not a location here
    await userEvent.click(within(map).getByRole('button', { name: /^TATR_0001/ }))
    const card = await within(map).findByRole('region', { name: 'Details of TATR_0001' })
    expect(card).toHaveTextContent('R0004-TATR_0001')                                                    // the latest deployment of the site
    expect(card).toHaveTextContent('Deployments:2')                                                      // and it has two
  })

  it('lists the deployment of a stolen camera as Not created — nothing to create or upload — and counts it in what was planned', async () => {
    mockedApi.fieldDeployments.mockResolvedValue({
      results: [
        deployment({ on_trapper: true }),
        deployment({ deployment_id: 'R0003-TATR_0002', site: 'TATR_0002', images_stored: false, no_images: 'stolen', photos_counted: null, card: 'C7' }),
      ],
    } as never)
    render(<DeploymentStatusPage onBack={vi.fn()} />)

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    const squares = within(region).getByRole('region', { name: 'Deployments by status' })
    expect(within(squares).getByRole('button', { name: /^Not created/ })).toHaveTextContent('1')
    expect(within(squares).getByRole('button', { name: /^Planned/ })).toHaveTextContent('0')
    expect(squares).toHaveTextContent('1/ 2')   // of all that was planned: the one that will not be made was planned too
    const table = within(region).getByRole('table', { name: 'Deployments' })
    const stolen = within(table).getByText('R0003-TATR_0002').closest('tr')!
    expect(within(stolen).getByText('Not created')).toBeInTheDocument()
    expect(within(stolen).queryByRole('button', { name: /View the deployment|Upload the deployment/ })).not.toBeInTheDocument()
  })

  it('links the visit and the SD card in the same style, and has no buttons to jump to the deployments before and after at the same site', async () => {
    const onOpenSettings = vi.fn()
    mockedApi.fieldDeployments.mockResolvedValue({ results: [
      deployment({ deployment_id: 'R0001-TATR_0001', collection: 'R0001', start_session: 'R0001' }),
      deployment({ deployment_id: 'R0002-TATR_0001', collection: 'R0002', start_session: 'R0002' }),
      deployment({ deployment_id: 'R0003-TATR_0001', collection: 'R0003', start_session: 'R0003' }),
    ] })
    render(<DeploymentStatusPage onBack={vi.fn()} onOpenSettings={onOpenSettings} onShowVisit={vi.fn()} />)
    await showAll()
    const table = await screen.findByRole('table', { name: 'Deployments' })
    const rowOf = (id: string) => within(table).getAllByRole('row').find((r) => within(r).queryByRole('button', { name: new RegExp(`^View the deployment ${id}`) }))!

    const first = rowOf('R0001-TATR_0001')
    expect(within(table).queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument()   // the site is told in the visit
    for (const name of ['Show the visit R0001 to TATR_0001', 'Show the state of the SD card A13']) {
      expect(within(first).getByRole('button', { name })).toHaveClass('underline', 'decoration-dotted')
    }

    // the row has the options of the deployment, and not those that jumped to the one before or after at the same site
    expect(within(table).queryByRole('button', { name: /^Show the (previous|next) deployment/ })).not.toBeInTheDocument()
  })

  it('ticks deployments, and a bar over the table uploads them — active only when each is created and not on Trapper yet, and they are of one revision', async () => {
    const onUpload = vi.fn()
    const states = (trapper: 'planned' | 'done' | 'failed') => [{ destination: 'trapper', state: trapper, kind: trapper === 'done' ? 'uploaded' : null, uploaded_at: trapper === 'done' ? '2024-10-20T10:00:00+00:00' : null, note: null }]
    mockedApi.fieldDeployments.mockResolvedValue({ results: [
      deployment({ deployment_id: 'R0003-TATR_0001', site: 'TATR_0001', upload_states: states('planned') }),
      deployment({ deployment_id: 'R0003-TATR_0002', site: 'TATR_0002', upload_states: states('failed') }),
      deployment({ deployment_id: 'R0003-TATR_0003', site: 'TATR_0003', upload_states: states('done') }),
    ] })
    render(<DeploymentStatusPage onBack={vi.fn()} onUpload={onUpload} />)
    const table = await screen.findByRole('table', { name: 'Deployments' })

    expect(screen.queryByRole('group', { name: 'Action on the selected deployments' })).not.toBeInTheDocument()
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the deployment R0003-TATR_0001' }))
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the deployment R0003-TATR_0002' }))
    const bar = screen.getByRole('group', { name: 'Action on the selected deployments' })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: 'Upload the images' }))
    expect(onUpload).toHaveBeenCalledWith({ researchProjectId: expect.any(String), collection: 'R0003', deployments: ['R0003-TATR_0001', 'R0003-TATR_0002'] })

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select the deployment R0003-TATR_0003' }))     // already on Trapper
    expect(within(bar).getByRole('button', { name: 'Upload the images' })).toBeDisabled()
    expect(bar).not.toHaveTextContent('Only deployments')
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('group', { name: 'Action on the selected deployments' })).not.toBeInTheDocument()
  })

  it('has, in the Upload column, a tick when the deployment was uploaded — it goes to its uploads — and a cross when it was not, and the button to upload its images', async () => {
    const onUpload = vi.fn()
    const onShowUploads = vi.fn()
    const states = (trapper: 'planned' | 'done' | 'failed') => [{ destination: 'trapper', state: trapper, kind: trapper === 'done' ? 'uploaded' : null, uploaded_at: trapper === 'done' ? '2024-10-20T10:00:00+00:00' : null, note: null }]
    mockedApi.fieldDeployments.mockResolvedValue({ results: [
      deployment({ on_trapper: true, uploaded_at: '2024-10-20T10:00:00+00:00', upload_states: states('done') }),
      deployment({ deployment_id: 'R0003-TATR_0002', site: 'TATR_0002', upload_states: states('planned') }),
      deployment({ deployment_id: 'R0003-TATR_0004', site: 'TATR_0004', upload_states: states('failed') }),
      deployment({ deployment_id: 'R0003-TATR_0003', site: 'TATR_0003', images_stored: false, upload_states: states('planned') }),
    ] })
    render(<DeploymentStatusPage onBack={vi.fn()} onUpload={onUpload} onShowUploads={onShowUploads} />)
    const table = await screen.findByRole('table', { name: 'Deployments' })
    const rowOf = (site: string) => within(table).getAllByRole('row').find((r) => within(r).queryAllByRole('cell')[1]?.textContent?.endsWith(`-${site}`))!
    const uploadCell = (site: string) => within(rowOf(site)).getAllByRole('cell')[5]

    // uploaded: a tick that goes to the uploads of the deployment
    await userEvent.click(within(uploadCell('TATR_0001')).getByRole('button', { name: 'Show the uploads of the deployment R0003-TATR_0001' }))
    expect(onShowUploads).toHaveBeenCalledWith('R0003-TATR_0001')
    // planned or failed: a cross, which is not a link; a deployment that is not created yet has nothing to say
    expect(within(uploadCell('TATR_0002')).getByRole('img', { name: 'Not uploaded' })).toBeInTheDocument()
    expect(within(uploadCell('TATR_0002')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(uploadCell('TATR_0004')).getByRole('img', { name: 'Not uploaded' })).toHaveAttribute('title', 'Not uploaded (TRAPPER: failed)')
    expect(uploadCell('TATR_0003')).toHaveTextContent('—')

    await userEvent.click(screen.getByRole('button', { name: 'Upload the deployment R0003-TATR_0002' }))
    expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'TATR', collection: 'R0003' })
    expect(screen.getByRole('button', { name: 'Upload the deployment R0003-TATR_0004' })).toHaveAttribute('title', 'Upload the images again')   // a failed one is tried again
  })

  it('has a button to create the deployment of a card that was collected and whose images are not stored, which goes to Import deployment on the visit that left the camera', async () => {
    const visit = { location_id: 'TATR_0003', session: 'R0003', date: '2024-09-04', time: '09:00:00', actions: ['Installation'], sd: 'C8' }
    mockedApi.visitBook.mockResolvedValue({ results: [{ ...visit, location_id: 'TATR_0001' }, visit] } as never)
    const onImportImages = vi.fn()
    render(<DeploymentStatusPage onBack={vi.fn()} onImportImages={onImportImages} />)
    await showAll()

    const region = await screen.findByRole('region', { name: 'Deployments the visits say' })
    // the one that is created, the one that is still open and the one that is planned with the card collected: only the last can be made now
    expect(within(region).queryByRole('button', { name: 'Create the deployment R0003-TATR_0002' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Create the deployment R0004-TATR_0001' })).not.toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Create the deployment R0003-TATR_0003' }))
    await waitFor(() => expect(onImportImages).toHaveBeenCalledWith({ researchProjectId: 'TATR', visit }))
    expect(mockedApi.visitBook).toHaveBeenCalledWith('TATR')
  })
})
