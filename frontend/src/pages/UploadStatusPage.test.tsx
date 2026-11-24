import { renderWithHeader } from '../test/renderWithHeader'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentUploadState, FieldDeployment, UploadEntry } from '../types'

vi.mock('../api', () => ({ api: { statusHistory: vi.fn(async () => ({ results: [] })), fieldDeployments: vi.fn(), listResearchProjects: vi.fn(), getSettings: vi.fn(), listVisits: vi.fn(), listLocalLocations: vi.fn(), collectionPath: vi.fn(), listLocalDeployments: vi.fn() } }))
import { api } from '../api'
import UploadStatusPage from './UploadStatusPage'

const sent = (extra: Partial<UploadEntry> = {}): UploadEntry => ({ destination: 'trapper', kind: 'uploaded', uploaded_at: '2026-10-20T10:00:00+00:00', parts: 2, location_created: true, deployment_created: true, url: 'https://trapper.example.org/geomap/deployment/detail/7/', ...extra })
const upload = (state: DeploymentUploadState['state'], destination = 'trapper', extra: Partial<DeploymentUploadState> = {}): DeploymentUploadState => ({
  destination, state, kind: state === 'done' ? 'uploaded' : null, uploaded_at: state === 'done' ? '2026-10-20T10:00:00+00:00' : null, note: null, ...extra })
const deployment = (id: string, states: DeploymentUploadState[], extra: Partial<FieldDeployment> = {}): FieldDeployment => ({
  deployment_id: id, collection: id.split('-')[0], site: id.split('-')[1], status: 'closed', start: '2026-06-10T09:00:00Z', end: '2026-08-05T08:00:00Z', setup_by: null, camera_id: null, card: null,
  photos_counted: null, start_session: id.split('-')[0], end_session: null, images_stored: true, uploads: states.some((s) => s.state === 'done') ? [sent()] : [], upload_states: states, ...extra })
const DEPLOYMENTS = [
  deployment('R0002-DONA_01', [upload('done')]),
  deployment('R0002-DONA_02', [upload('planned')], { images_stored: false }),                          // not created yet: its upload waits
  deployment('R0001-DONA_01', [upload('done', 'trapper', { uploaded_at: '2026-09-01T08:30:00+00:00' })]),
  deployment('R0001-DONA_02', [upload('failed', 'trapper', { note: 'Trapper refused the package' })]),
  deployment('R0001-DONA_03', [], { images_stored: false, no_images: 'stolen' }),                       // a stolen camera: the card is gone, nothing to upload
]

const showAll = async () => { await userEvent.click(await screen.findByRole('button', { name: /^All revisions/ })) }  // the dashboard opens on the latest revision

describe('UploadStatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSettings).mockResolvedValue({ GENERAL: { default_research_project: 'DONA' } } as never)
    vi.mocked(api.listResearchProjects).mockResolvedValue({ results: [{ acronym: 'DONA', name: 'Doñana' }] } as never)
    vi.mocked(api.fieldDeployments).mockResolvedValue({ results: DEPLOYMENTS })
  })

  it('opens on the latest revision from the first render of its table — not after it', async () => {
    render(<UploadStatusPage onBack={() => {}} />)

    const table = await screen.findByRole('table', { name: 'Uploads' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent).every((t) => /R0002/.test(t ?? ''))).toBe(true)   // the first time it is there it is already the latest revision's
    expect(within(table).queryByText(/R0001-DONA_01/)).not.toBeInTheDocument()
  })

  it('lists the uploads — one for each deployment that will be made and each uploader in use — with where, when, the uploader and its status', async () => {
    render(<UploadStatusPage onBack={() => {}} />)
    await showAll()

    const table = await screen.findByRole('table', { name: 'Uploads' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Details', 'Deployment', 'Location', 'Visit', 'Uploader', 'Status', 'What to do'])
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(within(table).getAllByRole('row').slice(1).map(cells)).toEqual([
      ['', 'R0002-DONA_01', 'DONA_01', 'R0002 · DONA_0110 Jun 2026, 09:00 → 5 Aug 2026, 08:00', 'TRAPPER', 'Done20 Oct 2026, 12:00 (Europe/Madrid)', ''],
      ['', 'R0002-DONA_02', 'DONA_02', 'R0002 · DONA_0210 Jun 2026, 09:00 → 5 Aug 2026, 08:00', 'TRAPPER', 'Planned', ''],
      ['', 'R0001-DONA_01', 'DONA_01', 'R0001 · DONA_0110 Jun 2026, 09:00 → 5 Aug 2026, 08:00', 'TRAPPER', 'Done1 Sep 2026, 10:30 (Europe/Madrid)', ''],
      ['', 'R0001-DONA_02', 'DONA_02', 'R0001 · DONA_0210 Jun 2026, 09:00 → 5 Aug 2026, 08:00', 'TRAPPER', 'Failed', ''],
    ])
    expect(within(table).queryByText('R0001-DONA_03')).not.toBeInTheDocument()   // the camera was stolen: there is no deployment to upload
  })

  it('starts on the uploads of one deployment when it is reached from its tick in the deployments dashboard', async () => {
    render(<UploadStatusPage onBack={() => {}} search="R0001-DONA_01" />)
    await showAll()

    const table = await screen.findByRole('table', { name: 'Uploads' })
    expect(screen.getByLabelText('Filter the uploads')).toHaveValue('R0001-DONA_01')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1)
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('R0001-DONA_01')
  })

  it('counts the planned, the done and the failed, over every upload there is — the deployments times the uploaders —, and a card shows only its uploads', async () => {
    render(<UploadStatusPage onBack={() => {}} />)
    await showAll()

    const region = await screen.findByRole('region', { name: 'Uploads by status' })
    expect(region).toHaveTextContent('2/ 4')
    expect(within(region).getByRole('button', { name: 'Planned' })).toHaveTextContent('1')
    expect(within(region).getByRole('button', { name: 'Done' })).toHaveTextContent('2')
    expect(within(region).getByRole('button', { name: 'Failed' })).toHaveTextContent('1')
    expect(within(region).getByRole('progressbar', { name: 'Uploads done' })).toHaveAttribute('aria-valuenow', '2')

    await userEvent.click(within(region).getByRole('button', { name: 'Failed' }))
    const table = screen.getByRole('table', { name: 'Uploads' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['R0001-DONA_02'])
    await userEvent.click(within(region).getByRole('button', { name: 'Failed' }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4)
  })

  it('plans an upload for each uploader in use, so the deployments are told once for each', async () => {
    vi.mocked(api.fieldDeployments).mockResolvedValue({ results: [
      deployment('R0001-DONA_01', [upload('done'), upload('planned', 'agouti')]),
      deployment('R0001-DONA_02', [upload('planned'), upload('planned', 'agouti')], { images_stored: false }),
    ] })
    render(<UploadStatusPage onBack={() => {}} />)

    const region = await screen.findByRole('region', { name: 'Uploads by status' })
    expect(region).toHaveTextContent('1/ 4')          // 2 deployments × 2 uploaders: the number planned from the start
    await userEvent.selectOptions(screen.getByLabelText('Uploader'), 'Agouti')
    expect(region).toHaveTextContent('0/ 2'); expect(region).toHaveTextContent('to Agouti')
    const table = screen.getByRole('table', { name: 'Uploads' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['Agouti', 'Agouti'])
  })

  it('lets a planned upload be made once its deployment is created, and a failed one be tried again — a done one has its details instead', async () => {
    const onUpload = vi.fn()
    render(<UploadStatusPage onBack={() => {}} onUpload={onUpload} />)
    await showAll()
    await screen.findByRole('table', { name: 'Uploads' })

    expect(screen.getByRole('button', { name: 'Upload the deployment R0002-DONA_02' })).toBeDisabled()    // its images are not stored yet
    await userEvent.click(screen.getByRole('button', { name: 'Try again the upload of the deployment R0001-DONA_02' }))
    expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0001' })
    expect(screen.queryByRole('button', { name: /^(Upload|Try again the upload of) the deployment R0002-DONA_01$/ })).not.toBeInTheDocument() // done: nothing to upload

    await userEvent.click(screen.getByRole('button', { name: 'View the upload of R0002-DONA_01 to TRAPPER' }))
    const list = screen.getByRole('list', { name: 'Uploads of R0002-DONA_01' })
    expect(list).toHaveTextContent('TRAPPERUploaded on 20 Oct 2026, 12:00 (Europe/Madrid) · 2 packages · location and deployment created there')
    expect(within(list).getByRole('link', { name: 'Open R0002-DONA_01 in TRAPPER' })).toHaveAttribute('href', 'https://trapper.example.org/geomap/deployment/detail/7/')
    await userEvent.click(screen.getByRole('button', { name: 'View the upload of R0002-DONA_01 to TRAPPER' }))
    expect(screen.queryByRole('list', { name: 'Uploads of R0002-DONA_01' })).not.toBeInTheDocument()
  })

  it('has the revisions to pick one, and the progress follows it', async () => {
    render(<UploadStatusPage onBack={() => {}} />)

    const revisions = await screen.findByRole('region', { name: 'Revision' })
    expect(within(revisions).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['All revisions4 uploads50%', 'R00022 uploads', 'R00012 uploads'])   // the first button folds the section away
    await userEvent.click(within(revisions).getByRole('button', { name: /^R0002/ }))

    const table = screen.getByRole('table', { name: 'Uploads' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['R0002-DONA_01', 'R0002-DONA_02'])
    const progress = screen.getByRole('region', { name: 'Uploads by status' })
    expect(progress).toHaveTextContent('· R0002')
    expect(progress).toHaveTextContent('1/ 2')
  })

  it('tells the period of a deployment on the wall clock of its location, with the timezone beside in brackets', async () => {
    vi.mocked(api.fieldDeployments).mockResolvedValue({ results: [
      deployment('R0001-DONA_01', [upload('done')], { start: '2026-06-10T07:00:00Z', end: '2026-08-05T06:00:00Z', start_local: '2026-06-10T09:00:00', end_local: '2026-08-05T08:00:00', timezone: 'Europe/Madrid' }),
    ] })
    render(<UploadStatusPage onBack={() => {}} />)
    const table = await screen.findByRole('table', { name: 'Uploads' })

    expect(within(table).getByText('10 Jun 2026, 09:00 → 5 Aug 2026, 08:00 (Europe/Madrid)')).toBeInTheDocument()
  })

  it('opens the visit that started a deployment, the deployment and its location in panels at the right, with a way on to each from the panel', async () => {
    const stored = (over: object) => ({ location_id: 'DONA_01', session: 'R0001', date: '2026-06-10', time: '09:00:00', actions: ['Installation'], trappers: 'Ana', camera_id: 'P800', sd: 'A13', num_photos: null, ...over }) as never
    vi.mocked(api.listVisits).mockResolvedValue({ results: [stored({})] })
    vi.mocked(api.listLocalLocations).mockResolvedValue({ results: [{ location_id: 'DONA_01', name: 'Doñana site 1', latitude: 37.01, longitude: -6.44, timezone: 'UTC', coordinate_uncertainty: 5, trapper_pk: null }] } as never)
    vi.mocked(api.collectionPath).mockResolvedValue({ path: '/collections/DONA/R0001', collection: 'R0001' } as never)
    vi.mocked(api.listLocalDeployments).mockResolvedValue({ results: [{ deployment_id: 'R0001-DONA_01', location_id: 'DONA_01', start_date: '2026-06-10T09:00:00Z', camera_id: 'P800' }] } as never)
    const onShowVisit = vi.fn(), onShowDeployment = vi.fn(), onOpenSettings = vi.fn()
    render(<UploadStatusPage onBack={() => {}} onShowVisit={onShowVisit} onShowDeployment={onShowDeployment} onOpenSettings={onOpenSettings} />)
    await showAll()
    await screen.findByRole('table', { name: 'Uploads' })

    await userEvent.click(screen.getAllByRole('button', { name: 'Show the visit R0001 to DONA_01' })[0])
    const visit = within(await screen.findByRole('dialog', { name: 'Details of the visit R0001 to DONA_01' }))
    expect(api.listVisits).toHaveBeenCalledWith('DONA', 'DONA_01')
    await userEvent.click(visit.getByRole('button', { name: /Open visit R0001/ }))
    expect(onShowVisit).toHaveBeenCalledWith({ session: 'R0001', site: 'DONA_01' })

    await userEvent.click(screen.getByRole('button', { name: 'Show the details of the deployment R0001-DONA_01' }))
    const deployment = within(await screen.findByRole('dialog', { name: 'Details of the deployment R0001-DONA_01' }))
    expect(await deployment.findByRole('region', { name: 'Location' })).toBeInTheDocument()
    await userEvent.click(deployment.getByRole('button', { name: /Open it in the deployments dashboard/ }))
    expect(onShowDeployment).toHaveBeenCalledWith('R0001-DONA_01')

    await userEvent.click(screen.getAllByRole('button', { name: 'DONA_01' })[0])
    const site = within(await screen.findByRole('dialog', { name: 'Details of the location DONA_01' }))
    await userEvent.click(site.getByRole('button', { name: 'Open it in the settings' }))
    expect(onOpenSettings).toHaveBeenCalledWith('locations', 'DONA', 'DONA_01')
  })

  it('shows the uploads as a table or as labels — two buttons at the right of Reset', async () => {
    render(<UploadStatusPage onBack={() => {}} />)
    await screen.findByRole('table', { name: 'Uploads' })
    expect(screen.getAllByRole('button', { name: /^Show the uploads as/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Show the uploads as a table', 'Show the uploads as labels'])
    expect(screen.queryByRole('button', { name: 'Show only the search field' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show the uploads as labels' }))
    expect(screen.queryByRole('table', { name: 'Uploads' })).not.toBeInTheDocument()
    const label = screen.getByRole('article', { name: 'Upload of R0002-DONA_01 to TRAPPER' })
    expect(label).toHaveTextContent('Done')
    expect(label).toHaveTextContent('R0002 · DONA_01')
    expect(within(label).getByRole('button', { name: 'View the upload of R0002-DONA_01 to TRAPPER' })).toBeInTheDocument()
    await userEvent.click(within(label).getByRole('button', { name: 'View the upload of R0002-DONA_01 to TRAPPER' }))
    expect(within(label).getByRole('list', { name: 'Uploads of R0002-DONA_01' })).toBeInTheDocument()     // what was sent, in the label
  })

  it('opens the legend in a panel from its button in the header, folds away the revisions and the cards, and clears the search with its cross', async () => {
    render(<UploadStatusPage onBack={() => {}} />)
    await showAll()
    await screen.findByRole('table', { name: 'Uploads' })

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    const panel = await screen.findByRole('dialog', { name: 'Dashboard legend and help' })
    expect(within(panel).getByText('Progress')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Got it, close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fold away the revision selection' }))
    expect(screen.queryByRole('group', { name: 'Revision' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fold away the status metrics' }))
    expect(within(screen.getByRole('region', { name: 'Uploads by status' })).queryAllByRole('button', { name: 'Planned' })).toHaveLength(0)
    expect(screen.getByRole('table', { name: 'Uploads' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Filter the uploads'), 'R0001')
    expect(screen.getByLabelText('Active filters')).toHaveTextContent('2 of 4 uploads match')
    await userEvent.click(screen.getByRole('button', { name: 'Reset the filters' }))
    expect(screen.getByLabelText('Filter the uploads')).toHaveValue('')
  })

  it('says so when there is no upload', async () => {
    vi.mocked(api.fieldDeployments).mockResolvedValue({ results: [] })
    render(<UploadStatusPage onBack={() => {}} />)

    expect(await screen.findByText('There is no upload yet: no deployment is planned, or no uploader is in use.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Uploads by status' })).toHaveTextContent('0/ 0')
  })

  it('comes back from the breadcrumb', async () => {
    const onBack = vi.fn()
    renderWithHeader(<UploadStatusPage onBack={onBack} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }))   // it hangs from the menu
    expect(onBack).toHaveBeenCalled()
  })
})
