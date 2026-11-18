import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ImportSessionPage, { matchLocation } from './ImportSessionPage'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { LocalLocation, LocalResearchProject, SessionScan } from '../types'
import { APP_SETTINGS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(), exiftoolStatus: vi.fn(), browseFolder: vi.fn(), scanSession: vi.fn(), scanFolder: vi.fn(), guessDetails: vi.fn(), validateImages: vi.fn(),
    listResearchProjects: vi.fn(), saveResearchProject: vi.fn(), listLocalLocations: vi.fn(), saveLocalLocation: vi.fn(),
    writeTimestampLog: vi.fn(), validateDeployment: vi.fn(), previousDeployments: vi.fn(), existingDeployments: vi.fn(), collectionPath: vi.fn(), importLocal: vi.fn(), openFolder: vi.fn(),
    trapperGetConfig: vi.fn(), trapperTestConnection: vi.fn(), trapperResearchProjects: vi.fn(), nextRevision: vi.fn(), epicollectEntriesBatch: vi.fn(),
    closedVisits: vi.fn(), linkVisit: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const COLLECTION = '/home/me/Documents/wildintel-uploader/collections/DONA/R0003'
const DONA: LocalResearchProject = { ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }
const loc = (id: string, over: Partial<LocalLocation> = {}): LocalLocation => ({
  location_id: id, name: null, timezone: 'Europe/Madrid', latitude: 37, longitude: -6.5, coordinate_uncertainty: null, trapper_pk: null, ...over,
})

// What each folder's images say of their dates and camera, by path — the scan only counts, they are read when the details are asked for.
const IMAGES_SAY = new Map<string, { start: string | null; end: string | null; camera: string | null }>()
const scanned = (name: string, images: number, start: string | null, end: string | null) => {
  IMAGES_SAY.set(`/s/${name}`, { start, end, camera: images ? 'Reconyx HC600' : null })
  return {
    name, path: `/s/${name}`, file_count: images, image_count: images, start_date: null as string | null, end_date: null as string | null,
    warnings: [] as string[], from_timestamp_log: false, log_deployment_id: null as string | null,
  }
}

const SCAN: SessionScan = {
  deployments: [
    scanned('DONA_01', 10, '2024-09-04T13:10:00', '2024-11-04T14:28:00'),
    scanned('DONA_02', 5, '2024-09-05T09:00:00', '2024-11-05T10:00:00'),
    scanned('EMPTY', 0, null, null),
  ],
  loose_files: 0, warnings: [], timestamp_log: null,
}

/** The closed visits of the project: a deployment is always of one of them, so the page has them from the start. */
const stored = (over: Record<string, unknown>) => ({
  location_id: 'DONA_01', session: 'R0002', date: '2026-08-05', time: '08:14:05', actions: ['Revision'], trappers: 'Ana', camera_status: null, battery_status: null, card_status: null,
  num_photos: null, sd: 'A13', date_time_ok: null, latitude: null, longitude: null, camera_id: 'P800', camera_model: 'Reconyx HC600', ...over,
}) as never
const CLOSED = [
  { visit: stored({}), end: stored({ session: 'R0003', date: '2026-10-02', num_photos: 10 }) },
  { visit: stored({ location_id: 'DONA_02', time: '09:30:00', sd: 'B2' }), end: stored({ location_id: 'DONA_02', session: 'R0003', date: '2026-10-02', time: '10:00:00', num_photos: 300 }) },
  { visit: stored({ session: 'R0001', date: '2026-06-10' }), end: stored({ session: 'R0002', date: '2026-08-05', num_photos: 50 }) },
]

/** The visits of the third revision that were collected in the fourth: what a deployment of R0003 is of. */
const REVISION_3 = [
  { visit: stored({ session: 'R0003', date: '2026-10-02', time: '08:00:00' }), end: stored({ session: 'R0004', date: '2026-11-02', num_photos: 10 }) },
  { visit: stored({ session: 'R0003', date: '2026-10-02', time: '09:30:00', location_id: 'DONA_02', sd: 'B2' }), end: stored({ session: 'R0004', date: '2026-11-02', time: '10:00:00', location_id: 'DONA_02', num_photos: 5 }) },
]

beforeEach(() => {
  vi.clearAllMocks()
  pageProps = {}
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.exiftoolStatus.mockResolvedValue({ available: true, path: '/usr/bin/exiftool' })
  mockedApi.browseFolder.mockResolvedValue({ path: '/s' })
  mockedApi.scanSession.mockResolvedValue(SCAN)
  mockedApi.guessDetails.mockImplementation(async (path) => {
    const says = IMAGES_SAY.get(path)
    return { start_date: says?.start ?? null, end_date: says?.end ?? null, camera_model: says?.camera ?? null, camera_id: null, warnings: [] }
  })
  mockedApi.validateImages.mockResolvedValue({ checked_count: 10, corrupted: [] })
  mockedApi.listResearchProjects.mockResolvedValue({ results: [DONA] })
  mockedApi.listLocalLocations.mockResolvedValue({ results: [loc('DONA_01'), loc('DONA_02')] })
  mockedApi.writeTimestampLog.mockResolvedValue({ path: '/c/R0003_FileTimestampLog.csv', action: 'added', rows: 1, collection: 'R0003' })
  mockedApi.validateDeployment.mockResolvedValue({ checked_count: 10, out_of_range: [], deployment_id: { ok: true, message: 'fine' } })
  mockedApi.collectionPath.mockResolvedValue({ path: COLLECTION, collection: 'R0003', exists: false, name: null })
  mockedApi.importLocal.mockImplementation(async (_s, _d, _n, deployment, _p, onEvent) => {
    onEvent({ type: 'done', dest_dir: `${COLLECTION}/${deployment.deployment_id}`, processed: 1, skipped: 0 })
  })
  mockedApi.openFolder.mockResolvedValue({ opened: COLLECTION })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice@example.org', has_password: true })
  mockedApi.existingDeployments.mockResolvedValue({ results: {} })
  mockedApi.nextRevision.mockRejectedValue(new Error('no suggestion'))  // the revision stays to be typed, unless a test says otherwise
  mockedApi.previousDeployments.mockResolvedValue({ results: {} })
  mockedApi.closedVisits.mockResolvedValue({ results: REVISION_3 })  // the project has closed visits: a deployment is always of one — here, the ones of the third revision
  mockedApi.linkVisit.mockResolvedValue({} as never)
})

// Props the page is rendered with — reset for every test.
let pageProps: ComponentProps<typeof ImportSessionPage> = {}

async function scanSession() {
  render(<ImportSessionPage {...pageProps} />)
  await pickProject() // the origin comes first
  // the latest revision is picked, with all its visits ticked, once they are read
  await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Browse…' }))
  await screen.findByDisplayValue('/s')
  await userEvent.click(screen.getByRole('button', { name: 'Scan' }))
  await screen.findByRole('checkbox', { name: 'DONA_01' })
}

/** From the checks on: the dates of the images must fit by default, so they are run before going on. */
const nextFromChecks = async () => {
  if ((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled) {
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
  }
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}
const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }))

/** How strict a check is — one of the radio buttons of its row: Skip, Warn or Must pass. */
const chooseStrictness = (check: string, choice: 'Skip' | 'Warn' | 'Must pass') =>
  userEvent.click(within(screen.getByRole('radiogroup', { name: `How strict: ${check}` })).getByRole('radio', { name: choice }))

/** From the folder's step to the choosing of the checks. */
const toChecksSubstep = async () => {
  await scanSession()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
  await screen.findByText('Choose the checks')
}
// the visits give the location: there is no step of where they were taken, and the dates are there at once
const toDetailsSubstep = async () => { const go = screen.queryByRole('button', { name: /Continue to the details/ }); if (go) await userEvent.click(go) }

async function pickProject() {
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
}

/** The visit of each folder: the one of the location its name says, which is linked by itself — there is nothing to assign. */
const assignLocations = async () => {
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Assign \d+$/ })).not.toBeInTheDocument())
}

async function toOrigin() {
  await scanSession()
  await next() // images → dates, where the locations of the folders are
  await assignLocations()
}

/** The step "More details": the camera, the site and the notes of each deployment, after their dates. */
const toMoreDetailsSubstep = () => userEvent.click(screen.getByRole('button', { name: 'Continue to more details' }))
/** Opens a deployment's details in that step — and one of their sections, when given. */
const openMore = async (name: string, section?: RegExp) => {
  const header = screen.getByRole('button', { name: new RegExp(`(Open|Close) the details of ${name}$`) })
  if (header.getAttribute('aria-expanded') === 'false') await userEvent.click(header)
  if (section) {
    const card = screen.getByRole('button', { name: section })
    if (card.getAttribute('aria-expanded') === 'false') await userEvent.click(card)
  }
}

async function toDetails() {
  await toOrigin()
  await toDetailsSubstep()
  // the revision is the visits': R0003 here — it is not asked
  await screen.findAllByText(/R0003-DONA_01/)
}

async function toMoreDetails() {
  await toDetails()
  await toMoreDetailsSubstep()
}

describe('matchLocation', () => {
  const locations = [loc('DONA_01'), loc('DONA_02')]
  it('finds the location a folder is named after', () => {
    expect(matchLocation('dona_01', locations)?.location_id).toBe('DONA_01')
    expect(matchLocation('R0003-DONA_02 (copy)', locations)?.location_id).toBe('DONA_02')
  })
  it('finds none when it is not clear', () => {
    expect(matchLocation('SITE', locations)).toBeUndefined()
    expect(matchLocation('DONA_01 and DONA_02', locations)).toBeUndefined()
  })
})

describe('ImportSessionPage', () => {
  it('lists the session’s subfolders, leaving out the ones with no images', async () => {
    await scanSession()

    expect(screen.getByRole('checkbox', { name: 'DONA_01' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'DONA_02' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'EMPTY' })).not.toBeChecked()
    expect(mockedApi.scanSession).toHaveBeenCalledWith('/s')
  })

  it('cannot go on with no subfolder ticked', async () => {
    await scanSession()
    await userEvent.click(screen.getByRole('checkbox', { name: 'DONA_01' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'DONA_02' }))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('shows why a folder cannot be scanned', async () => {
    mockedApi.scanSession.mockRejectedValue(new Error('This folder has no subfolders'))
    render(<ImportSessionPage />)
    await pickProject()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    await userEvent.type(await screen.findByLabelText('Folder path'), '/empty')
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

    expect(await screen.findByText(/no subfolders/)).toBeInTheDocument()
  })

  it('checks every deployment as a unit, and leaves out of the next steps the one that fails a check set to Must pass', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecksSubstep()
    await chooseStrictness('Corrupted images', 'Must pass')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // not checked yet: nothing is known to be free of errors
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await screen.findByText(/1 corrupted image/)
    expect(mockedApi.validateImages.mock.calls.map((c) => c[0])).toEqual(['/s/DONA_01', '/s/DONA_02'])
    expect(mockedApi.validateImages.mock.calls.map((c) => c[2])).toEqual(['DONA', 'DONA'])   // the images are also looked for in what the research project already has
    expect(screen.getByText(/1 folder fails a check set to Must pass/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DONA_02/ })).toHaveTextContent('left out')
    await userEvent.click(screen.getByRole('button', { name: 'Continue with 1 folder' }))
    await toDetailsSubstep()
    expect(await screen.findByRole('group', { name: 'Dates of DONA_01' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'DONA_02' })).not.toBeInTheDocument()
  })

  it('cannot go on when every deployment fails a required check', async () => {
    mockedApi.validateImages.mockResolvedValue({ checked_count: 5, corrupted: [{ path: 'bad.jpg', error: 'truncated' }] })
    await toChecksSubstep()
    await chooseStrictness('Corrupted images', 'Must pass')
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await screen.findByText(/No deployment is free of errors/)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('lets a check be skipped, warned about or required — and a required one holds back until it has passed', async () => {
    await toChecksSubstep()
    await chooseStrictness('Corrupted images', 'Must pass')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // not run yet
    await chooseStrictness('Corrupted images', 'Skip') // skipped, so no longer required
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await waitFor(() => expect(mockedApi.validateImages).toHaveBeenCalledTimes(2))
    expect(mockedApi.validateImages.mock.calls[0][1]).not.toContain('corrupted')
  })

  it('leaves out the folders with problems with one click, and goes on with the rest', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecksSubstep()
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Leave them out' }))

    expect(screen.getByRole('button', { name: 'Continue with 1 folder' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Continue with 1 folder' }))
    await toDetailsSubstep()
    expect(screen.queryByRole('button', { name: 'DONA_02' })).not.toBeInTheDocument()
  })

  it('counts the deployments that failed each check in the results', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecksSubstep()
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    expect(await screen.findByText(/1 check found problems in 1 of 2 folders/)).toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveTextContent('Folders passed')
    await userEvent.click(screen.getByRole('tab', { name: 'By check' }))
    expect(screen.getByText('1 folder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with 2 folders' })).toBeEnabled() // none is required
  })

  describe('the research project', () => {
    async function openOrigin() {
      render(<ImportSessionPage {...pageProps} />)
      await screen.findByLabelText('Research project')
    }

    it('is picked from a list that filters as you type, like in Import deployment, and can be cleared', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [DONA, { ...DONA, name: 'Tatra', acronym: 'TATR' }] })
      await openOrigin()
      await userEvent.type(screen.getByLabelText('Research project'), 'tat')

      expect(screen.queryByRole('option', { name: 'DONA — Doñana' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('option', { name: 'TATR — Tatra' }))
      await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())   // its visits are read, and the latest revision is ticked
      await userEvent.click(screen.getByRole('button', { name: 'Clear research project' }))
      expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
    })

    it('says there is none yet, and offers to add the first one', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [] })
      await openOrigin()

      expect(screen.getByText(/has no research projects yet — add the first one/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Add a new research project/ })).toBeInTheDocument()
    })

    it('adds one by hand with Trapper’s own fields, and picks it', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [] })
      mockedApi.saveResearchProject.mockImplementation(async (p) => p)
      await openOrigin()
      await userEvent.click(screen.getByRole('button', { name: /Add a new research project/ }))
      await userEvent.click(screen.getByRole('button', { name: /By hand/ }))
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Doñana' } })
      fireEvent.change(screen.getByLabelText('Acronym'), { target: { value: 'DONA' } })
      fireEvent.change(screen.getByLabelText('Event interval'), { target: { value: '120' } })
      expect(screen.getByLabelText('Sampling design')).toBeInTheDocument()
      expect(screen.getByLabelText('Keywords')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save research project' }))

      await waitFor(() => expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Doñana', acronym: 'DONA', event_interval: 120, trapper_pk: null })))
      expect(await screen.findByLabelText('Research project')).toHaveValue('DONA — Doñana')
      expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled()
    })

    it('adds the ones ticked in Trapper, and picks the first', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [] })
      mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 2 })
      mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 2, name: 'Doñana', acronym: 'DONA' }, { pk: 3, name: 'Tatra', acronym: 'TATR' }] })
      mockedApi.saveResearchProject.mockImplementation(async (p) => p)
      await openOrigin()
      await userEvent.click(screen.getByRole('button', { name: /Add a new research project/ }))
      await userEvent.click(screen.getByRole('button', { name: /From Trapper/ }))
      await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA — Doñana' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'TATR — Tatra' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add 2 research projects' }))

      await waitFor(() => expect(mockedApi.saveResearchProject).toHaveBeenCalledTimes(2))
      expect(await screen.findByLabelText('Research project')).toHaveValue('DONA — Doñana')
    })
  })

  it('needs a research project before the folder: the origin is the first step', async () => {
    render(<ImportSessionPage />)
    await screen.findByLabelText('Research project')

    expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
    expect(screen.queryByLabelText('Folder path')).not.toBeInTheDocument()
  })

  it('shows what the scan warns about — a missing timestamp log, folders without a row — as warnings', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN, warnings: ["No timestamp log (S_FileTimestampLog.csv) was found in the session folder, so the dates can't be recovered from it."],
    })
    await scanSession()

    expect(await screen.findByText(/No timestamp log \(S_FileTimestampLog\.csv\) was found/)).toBeInTheDocument()
  })

  it('says that the timestamp log was found and its dates are imported', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN, warnings: [],
      deployments: SCAN.deployments.map((d) => ({ ...d, start_date: '2024-09-01T08:00:00', end_date: '2024-11-01T09:00:00', from_timestamp_log: true })),
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: SCAN.deployments.length, matched: SCAN.deployments.length, revision: null },
    })
    await scanSession()

    expect(await screen.findByText(/Timestamp log found:/)).toHaveTextContent('Timestamp log found: S_FileTimestampLog.csv. Its dates are imported.')
  })

  it('says, for each folder, whether it is in the timestamp log', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN, warnings: [],
      deployments: [{ ...SCAN.deployments[0], start_date: '2024-09-01T08:00:00', end_date: '2024-11-01T09:00:00', from_timestamp_log: true }, SCAN.deployments[1], SCAN.deployments[2]],
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: 1, matched: 1, revision: null },
    })
    await scanSession()

    expect(await screen.findByText(/Timestamp log found:/)).not.toHaveTextContent(/of 3/)
    expect(screen.getByRole('columnheader', { name: 'In the timestamp log' })).toBeInTheDocument()
    expect(screen.getAllByText('In the log')).toHaveLength(1)
    expect(screen.getAllByText('Not in the log')).toHaveLength(2)
  })

  it('warns, after the table of folders, of the entries of the timestamp log that have no folder', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN, warnings: [],
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: 3, matched: 1, revision: null, unmatched: ['R0003-OTHER_01', 'R0003-OTHER_02'] },
    })
    await scanSession()

    const warning = await screen.findByText(/entries of the timestamp log have no folder/)
    expect(warning).toHaveTextContent('2 entries of the timestamp log have no folder: R0003-OTHER_01, R0003-OTHER_02.')
    expect(screen.getByRole('table').compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()  // it comes after the table
  })

  it('says nothing about entries without a folder when there are none', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN, warnings: [],
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: 1, matched: 1, revision: null, unmatched: [] },
    })
    await scanSession()

    await screen.findByText(/Timestamp log found:/)
    expect(screen.queryByText(/of the timestamp log have no folder|entry of the timestamp log has/)).not.toBeInTheDocument()
  })

  it('has no timestamp log column when none was found', async () => {
    await scanSession()

    expect(screen.queryByText(/Timestamp log found:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'In the timestamp log' })).not.toBeInTheDocument()
  })

  it('has a Back on the first step that goes back to the menu', async () => {
    const onBack = vi.fn()
    render(<ImportSessionPage onBack={onBack} />)

    await userEvent.click(screen.getByRole('button', { name: /Back/ }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('has the camera, site and notes in a step of their own, locked until the dates are gone over', async () => {
    await toDetails()
    expect(screen.queryByRole('button', { name: /the details of DONA_01/ })).not.toBeInTheDocument() // locked
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()

    await toMoreDetailsSubstep()

    expect(await screen.findByRole('button', { name: /Open the details of DONA_01/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit When was it collected?' })).toBeInTheDocument()
  })

  it('lists the camera, site and notes of the deployments in a card of its own, to filter by name or by what is missing', async () => {
    await toMoreDetails()

    expect(await screen.findByText('Camera, site and notes')).toBeInTheDocument()
    expect(screen.getByText(/\d+ of \d+ deployment\(s\) with details/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Filter the deployments'), 'DONA_02')
    expect(screen.queryByRole('button', { name: /the details of DONA_01/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /the details of DONA_02/ })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Filter the deployments'), 'x')
    expect(screen.getByText('No deployment matches.')).toBeInTheDocument()
  })

  it('says nothing about a log when the session has none', async () => {
    await toDetails()
    await screen.findByText(/deployment\(s\) complete/)
    expect(screen.queryByText(/FileTimestampLog/)).not.toBeInTheDocument()
  })

  it('warns at the revision itself of how many of the deployments already exist', async () => {
    mockedApi.existingDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': `${COLLECTION}/R0003-DONA_01`, 'R0003-DONA_02': `${COLLECTION}/R0003-DONA_02` } })
    await toDetails()

    expect(await screen.findByText(/Revision 3 already has 2 of these 2 deployment\(s\) in the collections folder/)).toBeInTheDocument()
    expect(screen.getByText('R0003-DONA_01, R0003-DONA_02', { selector: 'span' })).toBeInTheDocument()
  })

  describe('Epicollect5', () => {
    const ENTRY = { uuid: 'u1', title: 'DONA_01', created_at: '2026-10-01T10:00:00.000Z', fields: { habitat: 'Pine forest', setup_by: 'Ana' } }
    const on = () => mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, EPICOLLECT5: { ...APP_SETTINGS.EPICOLLECT5, enabled: true } })

    it('offers to import the deployments it has an entry for, and fills them in when asked', async () => {
      on()
      mockedApi.epicollectEntriesBatch.mockResolvedValue({ results: { DONA_01: ENTRY, DONA_02: null } })
      await toDetails()

      expect(await screen.findByText(/Epicollect5 has an entry for revision 3 of 1 of these 2 deployments/)).toBeInTheDocument()
      expect(mockedApi.epicollectEntriesBatch).toHaveBeenCalledWith(['DONA_01', 'DONA_02'], 3)
      await userEvent.click(screen.getByRole('button', { name: 'Import from Epicollect5' }))
      expect(await screen.findByText(/Filled in 1 of 2 from Epicollect5/)).toBeInTheDocument()
      await toMoreDetailsSubstep()
      await openMore('DONA_01', /^Site/)
      expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
    })

    it('warns, with a button to its settings, when it has no entry — or can not be read', async () => {
      on()
      const onOpenSettings = vi.fn()
      pageProps = { onOpenSettings }
      mockedApi.epicollectEntriesBatch.mockResolvedValue({ results: { DONA_01: null, DONA_02: null } })
      await toDetails()

      expect(await screen.findByText(/Epicollect5 has no entry for revision 3 of these deployments/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Open Epicollect5 settings' }))
      expect(onOpenSettings).toHaveBeenCalledWith('epicollect')
    })

    it('keeps the dates of the visits locked until Edit dates, and gives them back with Restore', async () => {
      await toDetails()
      expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
      expect(screen.getByText(/Locked · Field work \(R0003 → R0004\)/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Edit dates' }))

      expect(screen.getByLabelText('Start')).toBeInTheDocument()
      expect(screen.getByText(/Unlocked · Custom override/)).toBeInTheDocument()
      expect(screen.queryByText(/Quick fill from detected sources/)).not.toBeInTheDocument()   // the dates are the visits' or what is typed
      fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-05T10:00' } })
      expect(screen.getByLabelText('Start')).toHaveValue('2026-10-05T10:00')
      await userEvent.click(screen.getByRole('button', { name: 'Restore from Visits of the field work' }))
      expect(screen.getByLabelText('Start')).toHaveValue('2026-10-02T08:00')
      await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
      expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
    })

  })

  it('says in the postvalidation that some checks are customized in the settings, and has no fields for them', async () => {
    await toDetails()
    await next()

    expect(await screen.findByText(/Some of these checks can be customized in the settings \(Settings › Postvalidation\)/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Tolerance (hours)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sequence gap (seconds)')).not.toBeInTheDocument()
  })

  it('has a section to choose the checks and another for how they went', async () => {
    await toDetails()
    await next()

    expect(await screen.findByText('Choose the checks', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.getByText('Check results', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument() // nothing has run yet

    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    expect(await screen.findByRole('button', { name: 'Run again' })).toBeInTheDocument()
    expect(screen.getByText('1. Choose the checks', { selector: 'h4' })).toBeInTheDocument() // done, shut, with its pencil
  })

  it('writes each deployment’s timestamp log and checks each one after the details', async () => {
    await toDetails()
    await next()
    await userEvent.click(await screen.findByRole('button', { name: 'Run checks' }))

    await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledTimes(2))
    expect(mockedApi.writeTimestampLog.mock.calls.map((c) => c[1].deployment_id)).toEqual(['R0003-DONA_01', 'R0003-DONA_02'])
    expect(mockedApi.validateDeployment.mock.calls.map((c) => c[1].deployment_id)).toEqual(['R0003-DONA_01', 'R0003-DONA_02'])
    expect(mockedApi.validateDeployment.mock.calls[0][1].start_date).toBe('2026-10-02T08:00:00+02:00')   // the visit's, in the timezone of the location
  })

  it('imports every deployment into the revision’s collection and offers to open it', async () => {
    await toDetails()
    await next() // details → checks
    await nextFromChecks() // checks → prepare
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/Imported — 2 deployment/)
    expect(mockedApi.importLocal.mock.calls.map((c) => [c[0], c[1], c[3].deployment_id])).toEqual([
      ['/s/DONA_01', COLLECTION, 'R0003-DONA_01'], ['/s/DONA_02', COLLECTION, 'R0003-DONA_02'],
    ])
    expect(mockedApi.importLocal.mock.calls[0][2]).toBe('R0003')
    expect(mockedApi.importLocal.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, research_project: 'Doñana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(mockedApi.openFolder).toHaveBeenCalledWith(COLLECTION)
  })

  it('has Processing steps to choose what to do, Processing results for how it went, and Save to your collection', async () => {
    await toDetails()
    await next(); await nextFromChecks()

    expect(await screen.findByText('Processing steps', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.getByText('Processing results', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.getByText('Save to your collection', { selector: 'h4' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/Imported — 2 deployment/)
    expect(screen.getByRole('progressbar', { name: 'Deployments imported' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('2 of 2 deployments imported')).toBeInTheDocument()
  })

  it('lets the optional preparation steps be switched off before importing', async () => {
    await toDetails()
    await next(); await nextFromChecks()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Resize the images' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/Imported — /)
    expect(mockedApi.importLocal.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, resize: false }))
  })

  it('offers to go on to the upload of the revision’s collection once the session is imported', async () => {
    const onUpload = vi.fn()
    pageProps = { onUpload }
    await toDetails()
    await next() // details → checks
    await nextFromChecks() // checks → prepare
    expect(screen.queryByRole('button', { name: 'Upload to Trapper' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/Imported — 2 deployment/)
    await userEvent.click(screen.getByRole('button', { name: 'Upload to Trapper' }))
    expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0003' })
  })

  it('goes on past a failed deployment and retries only what is left', async () => {
    let failing = true
    mockedApi.importLocal.mockImplementation(async (_s, _d, _n, deployment, _p, onEvent) => {
      if (failing && deployment.deployment_id.endsWith('01')) throw new Error('disk full')
      onEvent({ type: 'done', dest_dir: `${COLLECTION}/${deployment.deployment_id}`, processed: 1, skipped: 0 })
    })
    await toDetails()
    await next(); await nextFromChecks()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/disk full/)
    expect(mockedApi.importLocal).toHaveBeenCalledTimes(2)
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Import the 1 left' }))

    await screen.findByText(/Imported — /)
    expect(mockedApi.importLocal).toHaveBeenCalledTimes(3)
    expect(mockedApi.importLocal.mock.calls[2][3].deployment_id).toBe('R0003-DONA_01')
  })

  it('asks the same fields as a single deployment — and sends them with the deployment', async () => {
    await toMoreDetails()
    await openMore('DONA_01', /^Site/)
    fireEvent.change(screen.getByLabelText('Set up by'), { target: { value: 'Ana' } })
    await openMore('DONA_01', /^Grouping and notes/)
    fireEvent.change(screen.getByLabelText('Comments'), { target: { value: 'Near the pond' } })
    await openMore('DONA_01', /^Camera/)
    fireEvent.change(screen.getByLabelText('Height above the ground (m)'), { target: { value: '1.2' } })
    await next(); await nextFromChecks()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 deployments' }))

    await screen.findByText(/Imported — /)
    expect(mockedApi.importLocal.mock.calls[0][3]).toEqual(expect.objectContaining({ setup_by: 'Ana', comments: 'Near the pond', camera_height: 1.2 }))
    expect(mockedApi.importLocal.mock.calls[1][3].setup_by).toBe('Ana') // each deployment has its own: the one the visit says
  })

  it('does not offer to fill in from a previous revision once it is known there is none', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': null, 'R0003-DONA_02': null } })
    await toDetails()
    await waitFor(() => expect(mockedApi.previousDeployments).toHaveBeenCalled())

    await waitFor(() => expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Fill from the previous revision' })).not.toBeInTheDocument()
  })

})


describe('an import session of visits', () => {
  const visit = (n: number) => screen.getAllByRole('checkbox', { name: /^the visit / })[n]

  beforeEach(() => {
    mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards: [
      { label: 'A13', brand: 'SanDisk', capacity: '64 GB', in_service: null, research_project: 'DONA' }, { label: 'B2', brand: null, capacity: null, in_service: null, research_project: 'DONA' },
      { label: 'Z9', brand: null, capacity: null, in_service: null, research_project: 'OTHER' },
    ] } })
  })

  /** The origin: the project and the two visits of the session R0002 ticked, then the folder of the session. */
  async function toTheFolders() {
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()
    expect(await screen.findByRole('checkbox', { name: /the visit R0002 to DONA_01/ })).toBeChecked()   // the visits of the latest revision are ticked from the start
    expect(screen.getByRole('checkbox', { name: /the visit R0002 to DONA_02/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Browse…' }))
    await screen.findByDisplayValue('/s')
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }))
    await screen.findByRole('checkbox', { name: 'DONA_01' })
  }

  it('offers the visits of the project to tick, and needs one to go on', async () => {
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()

    // the latest revision is picked, with all its visits ticked
    await screen.findAllByRole('checkbox', { name: /^the visit / })
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^the visit / })).toHaveLength(2))
    expect(visit(0)).toBeChecked()
    expect(visit(1)).toBeChecked()
    expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled()
    await userEvent.click(visit(0))
    await userEvent.click(visit(1))
    expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()                   // needs one
  })

  it('has a square for each revision with visits to import, and shows only the visits of the one picked', async () => {
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()
    await screen.findAllByRole('checkbox', { name: /^the visit / })
    const squares = screen.getByRole('group', { name: 'Revision' })

    expect(within(squares).getAllByRole('button').map((b) => b.textContent)).toEqual(['All revisions3 visits to import', 'R00022 visits to import', 'R00011 visit to import'])
    expect(within(squares).getByRole('button', { name: /^R0002/ })).toHaveAttribute('aria-pressed', 'true')   // the latest is picked from the start
    expect(screen.getAllByRole('checkbox', { name: /^the visit / })).toHaveLength(2) // only the visits of R0002, all ticked
    expect(visit(0)).toBeChecked()
    await userEvent.click(within(squares).getByRole('button', { name: /^R0001/ })) // another revision: its visits are ticked, not the ones of the other
    expect(screen.getAllByRole('checkbox', { name: /^the visit / })).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: /^the visit / })).toBeChecked()
    await userEvent.click(within(squares).getByRole('button', { name: /^All revisions/ }))
    expect(screen.getAllByRole('checkbox', { name: /^the visit / })).toHaveLength(3)    // all of them offered, none ticked
    expect(visit(0)).not.toBeChecked()
  })

  it('with one visit works as Import deployment: the folder is the deployment\'s, with the images in it', async () => {
    mockedApi.scanFolder.mockResolvedValue({ file_count: 24, image_count: 24, warnings: [] })
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()
    await userEvent.click(await screen.findByRole('checkbox', { name: /the visit R0002 to DONA_02/ }))   // the two visits of the revision are ticked: one is taken off
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))

    expect(await screen.findByText('Folder with the images')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Browse…' }))
    await screen.findByDisplayValue('/s')
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

    // the images of the folder are counted, as Import deployment does — not a folder with subfolders
    expect(await screen.findByText(/24 images/)).toBeInTheDocument()
    expect(mockedApi.scanFolder).toHaveBeenCalledWith('/s')
    expect(mockedApi.scanSession).not.toHaveBeenCalled()
    expect(screen.queryByText(/subfolder\(s\)/)).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('SD card of s'), 'B2')
    expect(screen.getByRole('button', { name: 'Continue to the checks' })).toBeEnabled() // the folder is linked to the one visit
  })

  it('hands a single visit over, when the page is Import deployments: it is one deployment, and Import deployment takes it', async () => {
    const onSingleVisit = vi.fn()
    render(<ImportSessionPage {...pageProps} title="Import deployments" onSingleVisit={onSingleVisit} />)
    await pickProject()
    expect(screen.getByRole('heading', { name: 'Import deployments' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('checkbox', { name: /the visit R0002 to DONA_02/ }))   // the two visits of the revision are ticked: one is taken off
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))

    expect(onSingleVisit).toHaveBeenCalledWith(expect.objectContaining({ researchProjectId: 'DONA', visit: expect.objectContaining({ location_id: 'DONA_01', session: 'R0002' }) }))
    expect(screen.queryByText('Folder with the images')).not.toBeInTheDocument()
  })

  it('says there is nothing to import, and offers to register the visits, when the project has no visit whose card was collected', async () => {
    mockedApi.closedVisits.mockResolvedValue({ results: [] })
    const onRegisterVisits = vi.fn()
    render(<ImportSessionPage {...pageProps} onRegisterVisits={onRegisterVisits} />)
    await pickProject()

    expect(await screen.findByText(/There is no visit of DONA whose card was collected and has no deployment/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()          // there is nothing to import: a deployment is always of a visit
    await userEvent.click(screen.getByRole('button', { name: 'Register the visits' }))
    expect(onRegisterVisits).toHaveBeenCalledWith('DONA')
  })

  it('shows the visits in the table of the dashboards, filtered by collected, with a box in each row', async () => {
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()

    expect(await screen.findByRole('table', { name: 'Closed visits' })).toBeInTheDocument()
    expect(await screen.findByText(/Status: Collected/)).toBeInTheDocument()
  })

  it('asks how to import several visits, when it can: all at once, or one after another — which hands them over in order', async () => {
    const onQueue = vi.fn()
    render(<ImportSessionPage {...pageProps} title="Import deployments" onSingleVisit={vi.fn()} onQueue={onQueue} />)
    await pickProject()
    expect(await screen.findByRole('radiogroup', { name: 'How to import them' })).toBeInTheDocument()   // the two visits are ticked from the start
    await userEvent.click(screen.getByRole('checkbox', { name: /the visit R0002 to DONA_02/ }))
    expect(screen.queryByRole('radiogroup', { name: 'How to import them' })).not.toBeInTheDocument()   // with one it is Import deployment: nothing to ask
    await userEvent.click(screen.getByRole('checkbox', { name: /the visit R0002 to DONA_02/ }))

    const how = screen.getByRole('radiogroup', { name: 'How to import them' })
    expect(within(how).getByRole('radio', { name: /All at once/ })).toBeChecked()                       // as it was
    expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeInTheDocument()
    await userEvent.click(within(how).getByRole('radio', { name: /One after another/ }))
    await userEvent.click(screen.getByRole('button', { name: /Start with the first/ }))

    expect(onQueue).toHaveBeenCalledTimes(1)
    expect(onQueue.mock.calls[0][0].map((t: { visit: { location_id: string } }) => t.visit.location_id)).toEqual(['DONA_01', 'DONA_02'])   // in order of the sites
    expect(screen.queryByText('Folder with the images')).not.toBeInTheDocument()
  })

  it('goes on to the folder of all of them when all at once is the way, as it always did', async () => {
    const onQueue = vi.fn()
    render(<ImportSessionPage {...pageProps} title="Import deployments" onSingleVisit={vi.fn()} onQueue={onQueue} />)
    await pickProject()
    expect(await screen.findByRole('checkbox', { name: /the visit R0002 to DONA_01/ })).toBeChecked()   // the visits of the latest revision are ticked from the start
    expect(screen.getByRole('checkbox', { name: /the visit R0002 to DONA_02/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))

    expect(onQueue).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Browse…' })).toBeInTheDocument()
  })

  it('has the default research project fixed, as Import deployment does, when the page is Import deployments', async () => {
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'DONA' } } as never)
    const onSingleVisit = vi.fn()
    render(<ImportSessionPage {...pageProps} title="Import deployments" onSingleVisit={onSingleVisit} />)

    // the research project is the default one: it is not asked, nor said — the step asks for the revision and the visits
    expect(await screen.findByText('Which visits are they of?')).toBeInTheDocument()
    expect(screen.queryByText('Which research project?')).not.toBeInTheDocument()
    expect(screen.queryByText(/The import is of the default research project/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Research project')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('checkbox', { name: /the visit R0002 to DONA_02/ })) // its visits are there already, ticked: one is taken off
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    expect(onSingleVisit).toHaveBeenCalledWith(expect.objectContaining({ researchProjectId: 'DONA' }))
  })

  it('offers only the visits of one session once one is ticked: the session is the revision', async () => {
    render(<ImportSessionPage {...pageProps} />)
    await pickProject()
    await screen.findAllByRole('checkbox', { name: /^the visit / })

    await userEvent.click(within(screen.getByRole('group', { name: 'Revision' })).getByRole('button', { name: /^All revisions/ }))   // all the visits offered, none ticked
    await userEvent.click(visit(0)) // R0002
    expect(visit(2)).toBeDisabled() // R0001
    expect(visit(1)).toBeEnabled()
    await userEvent.click(visit(0))
    expect(visit(2)).toBeEnabled()
  })

  it('links each folder to the visit of the location its name says, and asks its SD card', async () => {
    await toTheFolders()

    expect(screen.getByLabelText('Visit of DONA_01')).toHaveDisplayValue('DONA_01 · R0002 · 5 Aug 2026, 08:14')
    expect(screen.getByLabelText('Visit of DONA_02')).toHaveDisplayValue('DONA_02 · R0002 · 5 Aug 2026, 09:30')
    expect(screen.getByText(/Every folder has its visit/)).toBeInTheDocument()
    const cards = within(screen.getByLabelText('SD card of DONA_01')).getAllByRole('option').map((o) => o.textContent)
    expect(cards).toEqual(['None said', 'A13 — SanDisk 64 GB', 'B2'])
  })

  it('heads the list of folders with how many have a visit, and tells them apart and filters them by name', async () => {
    await toTheFolders()
    // the two folders that matched a visit by name have one; there is no more
    expect(screen.getByText(/2 of 2 folders have a visit/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Folders with a visit' })).toHaveAttribute('aria-valuenow', '100')

    await userEvent.click(screen.getByRole('tab', { name: 'Missing 0' }))
    expect(screen.queryByRole('checkbox', { name: 'DONA_01' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'All 2' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter the folders by name' }), 'DONA_02')
    expect(screen.queryByRole('checkbox', { name: 'DONA_01' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'DONA_02' })).toBeInTheDocument()
  })

  it('cannot go on while a folder has no visit, and a visit is of one folder only', async () => {
    await toTheFolders()

    await userEvent.selectOptions(screen.getByLabelText('Visit of DONA_01'), '')
    expect(screen.getByText(/A folder has no visit yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue to the checks/ })).toBeDisabled()
    // the visit left is offered to the folder without one, and not to the other that has its own
    const options = within(screen.getByLabelText('Visit of DONA_01')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Choose a visit', 'DONA_01 · R0002 · 5 Aug 2026, 08:14'])
  })

  it('takes the location, the revision, the dates and the camera from the visits', async () => {
    await toTheFolders()
    await next() // images → dates

    // the locations are the visits': nothing is asked of where they were taken, and the step starts at the dates
    expect(await screen.findByText(/The revision is the one of the visits you chose/)).toBeInTheDocument()
    expect(screen.queryByLabelText('What revision number are you importing?')).not.toBeInTheDocument() // the visits give it: it is not asked
    expect(screen.getAllByText('R0002-DONA_01').length).toBeGreaterThan(0) // the id the revision gives the deployment
    expect(screen.queryByText('Where were they taken?')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Location of DONA_01')).not.toBeInTheDocument()
    expect(await screen.findByText(/Locked · Field work \(R0002 → R0003\)/)).toBeInTheDocument()   // the dates are the visits', locked
    expect(screen.getAllByText(/From the visits/).length).toBeGreaterThan(0) // what each row says its dates come from
    await toMoreDetailsSubstep()
    await openMore('DONA_01', /^Camera/)
    expect(screen.getByLabelText('Camera model')).toHaveValue('Reconyx HC600')
    // what the field sheet says is shown, not edited, until it is filled in by hand — which keeps the values
    expect(screen.getByRole('radio', { name: 'What the field sheet says (DONA_01)' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'What the previous deployment says (DONA_01)' })).toBeDisabled()
    expect(screen.getByLabelText('Camera model')).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Fill in by hand (DONA_01)' }))
    expect(screen.getByLabelText('Camera model')).toBeEnabled()
    expect(screen.getByLabelText('Camera model')).toHaveValue('Reconyx HC600')
  })

  it('adds the checks against the visit, runs them with what each visit says, and links the visits once they are imported', async () => {
    await toTheFolders()
    await userEvent.selectOptions(screen.getByLabelText('SD card of DONA_01'), 'B2')
    await next()
    await screen.findByText(/The revision is the one of the visits you chose/)
    await toMoreDetailsSubstep()
    await next() // dates → checks
    expect(await screen.findByRole('radiogroup', { name: 'How strict: The SD card is the one the visit left' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'How strict: The photos are those the visit counted' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledTimes(2))
    const calls = mockedApi.validateDeployment.mock.calls
    expect(calls[0][3]).toEqual(expect.objectContaining({ visit: { left_session: 'R0002', left_sd: 'A13', collected_session: 'R0003', counted_photos: 10, sd_card: 'B2' } }))
    expect(calls[1][3]).toEqual(expect.objectContaining({ visit: { left_session: 'R0002', left_sd: 'B2', collected_session: 'R0003', counted_photos: 300, sd_card: null } }))

    await nextFromChecks() // checks → prepare
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 deployments' }))
    await waitFor(() => expect(mockedApi.linkVisit).toHaveBeenCalledTimes(2))
    expect(mockedApi.linkVisit).toHaveBeenCalledWith('DONA', CLOSED[0].visit, 'R0002-DONA_01')
    expect(mockedApi.linkVisit).toHaveBeenCalledWith('DONA', CLOSED[1].visit, 'R0002-DONA_02')
  })

  it('writes each deployment of the session into the collection\'s logs with what its visit says of it', async () => {
    await toTheFolders()
    await userEvent.selectOptions(screen.getByLabelText('SD card of DONA_01'), 'B2')
    await next()
    await screen.findByText(/The revision is the one of the visits you chose/)
    await toMoreDetailsSubstep()
    await next() // dates → checks

    await waitFor(() => expect(mockedApi.writeTimestampLog).toHaveBeenCalledTimes(2))
    expect(mockedApi.writeTimestampLog.mock.calls[0][2]).toEqual({
      left_session: 'R0002', left_action: 'Revision', left_sd: 'A13', collected_session: 'R0003', collected_action: 'Revision', counted_photos: 10, sd_card: 'B2',
    })
  })

})
