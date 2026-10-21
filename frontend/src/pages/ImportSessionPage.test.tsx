import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ImportSessionPage, { matchLocation, withFieldDetails } from './ImportSessionPage'
import { EMPTY_DEPLOYMENT_FIELDS, EMPTY_RESEARCH_PROJECT } from '../types'
import type { LocalLocation, LocalResearchProject, SessionScan } from '../types'
import { APP_SETTINGS } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(), exiftoolStatus: vi.fn(), browseFolder: vi.fn(), scanSession: vi.fn(), guessDetails: vi.fn(), validateImages: vi.fn(),
    listResearchProjects: vi.fn(), saveResearchProject: vi.fn(), listLocalLocations: vi.fn(), saveLocalLocation: vi.fn(),
    writeTimestampLog: vi.fn(), validateDeployment: vi.fn(), previousDeployments: vi.fn(), existingDeployments: vi.fn(), collectionPath: vi.fn(), importLocal: vi.fn(), openFolder: vi.fn(),
    trapperGetConfig: vi.fn(), trapperTestConnection: vi.fn(), trapperResearchProjects: vi.fn(), nextRevision: vi.fn(), epicollectEntriesBatch: vi.fn(),
    ingestCardCollections: vi.fn(), ingestFieldDetails: vi.fn(),
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
  mockedApi.validateDeployment.mockResolvedValue({ checked_count: 10, deployment_id: { ok: true, message: 'fine' } })
  mockedApi.collectionPath.mockResolvedValue({ path: COLLECTION, collection: 'R0003', exists: false, name: null })
  mockedApi.importLocal.mockImplementation(async (_s, _d, _n, deployment, _p, onEvent) => {
    onEvent({ type: 'done', dest_dir: `${COLLECTION}/${deployment.deployment_id}`, processed: 1, skipped: 0 })
  })
  mockedApi.openFolder.mockResolvedValue({ opened: COLLECTION })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice@example.org', has_password: true })
  mockedApi.existingDeployments.mockResolvedValue({ results: {} })
  mockedApi.nextRevision.mockRejectedValue(new Error('no suggestion'))  // the revision stays to be typed, unless a test says otherwise
  mockedApi.previousDeployments.mockResolvedValue({ results: {} })
  mockedApi.ingestCardCollections.mockResolvedValue({ results: [] })
  mockedApi.ingestFieldDetails.mockResolvedValue({ results: {} })
})

// Props the page is rendered with — reset for every test.
let pageProps: ComponentProps<typeof ImportSessionPage> = {}

async function scanSession() {
  render(<ImportSessionPage {...pageProps} />)
  await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
  await screen.findByDisplayValue('/s')
  await userEvent.click(screen.getByRole('button', { name: 'Scan' }))
  await screen.findByRole('checkbox', { name: 'DONA_01' })
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }))

/** How strict a check is — one of the radio buttons of its row: Skip, Warn or Must pass. */
const chooseStrictness = (check: string, choice: 'Skip' | 'Warn' | 'Must pass') =>
  userEvent.click(within(screen.getByRole('radiogroup', { name: `How strict: ${check}` })).getByRole('radio', { name: choice }))

/** The id the deployment being edited gets, which its heading tells. */
const activeHeading = () => within(screen.getByRole('group', { name: /^(Dates|Details) of/ })).getAllByRole('heading', { level: 5 })[0]
const expectId = (id: string) => expect(activeHeading()).toHaveTextContent(id)
const expectIdLater = (id: string) => waitFor(() => expectId(id))
/** Picks a location in the select of a deployment — whose options are only there once it is used. */
const chooseLocation = async (select: HTMLElement, id: string) => {
  await userEvent.click(select)
  await userEvent.selectOptions(select, id)
}
const toDetailsSubstep = () => userEvent.click(screen.getByRole('button', { name: /Continue to the details/ }))

async function pickProject() {
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
}

/** The locations the folders are named after are assigned on their own: wait until they are. */
const assignLocations = () => waitFor(() => expect(Number(screen.getByRole('progressbar', { name: 'Folders with a location' }).getAttribute('aria-valuenow'))).toBeGreaterThan(0))

async function toOrigin() {
  await scanSession()
  await next() // images → origin
  await pickProject()
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
  fireEvent.change(await screen.findByLabelText('What collection number are you processing?'), { target: { value: '3' } })
}

async function toChecks() {
  await toDetails()
  await next() // details → checks
  await screen.findByRole('button', { name: 'Run checks' })
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
    await userEvent.type(screen.getByLabelText('Folder path'), '/empty')
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

    expect(await screen.findByText(/no subfolders/)).toBeInTheDocument()
  })

  it('checks the images and the details at once, and leaves out the deployment that fails an image check set to Must pass', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecks()
    await chooseStrictness('Corrupted images', 'Must pass')
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await screen.findByText(/1 corrupted image/)
    await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledTimes(1))
    expect(mockedApi.validateImages.mock.calls.map((c) => c[0])).toEqual(['/s/DONA_01', '/s/DONA_02'])
    expect(mockedApi.validateDeployment.mock.calls[0][1].deployment_id).toBe('R0003-DONA_01')
    expect(screen.getByText(/1 folder fails a check set to Must pass/)).toBeInTheDocument()
    await next()
    expect(await screen.findByRole('button', { name: 'Process 1 deployment' })).toBeInTheDocument()
  })

  it('cannot go on when every deployment fails a required check', async () => {
    mockedApi.validateImages.mockResolvedValue({ checked_count: 5, corrupted: [{ path: 'bad.jpg', error: 'truncated' }] })
    await toChecks()
    await chooseStrictness('Corrupted images', 'Must pass')
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await screen.findByText(/2 folders fail a check set to Must pass/)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(mockedApi.validateDeployment).not.toHaveBeenCalled()
  })

  it('lets a check be skipped, warned about or required', async () => {
    await toChecks()
    await chooseStrictness('Corrupted images', 'Skip')
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await waitFor(() => expect(mockedApi.validateImages).toHaveBeenCalledTimes(2))
    expect(mockedApi.validateImages.mock.calls[0][1]).not.toContain('corrupted')
  })

  it('leaves out the folders with problems with one click, and goes on with the rest', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecks()
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Leave them out' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    await next()

    expect(await screen.findByRole('button', { name: 'Process 1 deployment' })).toBeInTheDocument()
  })

  it('counts the deployments that failed each check in the results', async () => {
    mockedApi.validateImages.mockImplementation(async (path) => ({ checked_count: 5, corrupted: path === '/s/DONA_02' ? [{ path: 'bad.jpg', error: 'truncated' }] : [] }))
    await toChecks()
    await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    expect(await screen.findByText(/1 check found problems in 1 of 2 folders/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Summary')[0]).toHaveTextContent('Folders passed')
  })

  describe('the research project', () => {
    async function openOrigin() {
      await scanSession()
      await next()
      await screen.findByLabelText('Research project')
    }

    it('is picked from a list that filters as you type, like in Import deployment, and can be cleared', async () => {
      mockedApi.listResearchProjects.mockResolvedValue({ results: [DONA, { ...DONA, name: 'Tatra', acronym: 'TATR' }] })
      await openOrigin()
      await userEvent.type(screen.getByLabelText('Research project'), 'tat')

      expect(screen.queryByRole('option', { name: 'DONA — Doñana' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('option', { name: 'TATR — Tatra' }))
      expect(screen.getByRole('button', { name: /Continue to the details/ })).toBeEnabled()
      await userEvent.click(screen.getByRole('button', { name: 'Clear research project' }))
      expect(screen.getByRole('button', { name: /Continue to the details/ })).toBeDisabled()
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
      expect(screen.getByRole('button', { name: /Continue to the details/ })).toBeEnabled()
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

  it('needs a research project before the details', async () => {
    await scanSession()
    await next()
    await screen.findByLabelText('Research project')

    expect(screen.getByRole('button', { name: /Continue to the details/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
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

  it('fills each deployment’s location from its folder name, and its dates from the scan', async () => {
    await toDetails()

    await expectIdLater('R0003-DONA_01')
    expect(screen.getByLabelText('Location of DONA_01')).toHaveValue('DONA_01')
    expect(screen.getByText('4 Sep 2024, 13:10')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Camera metadata (EXIF)' })).toBeChecked() // nothing better is there
    await userEvent.click(screen.getByRole('button', { name: 'Open DONA_02' }))
    expect(screen.getByLabelText('Location of DONA_02')).toHaveValue('DONA_02')
    expectId('R0003-DONA_02')
    expect(screen.getByText('5 Sep 2024, 09:00')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument() // only a manual entry can be edited
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('lists the period of each deployment, with its state and where its dates come from', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN,
      deployments: [{ ...SCAN.deployments[0], start_date: '2024-09-01T08:00:00', end_date: '2024-11-01T09:00:00', from_timestamp_log: true }, SCAN.deployments[1], SCAN.deployments[2]],
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: 1, matched: 1, revision: null },
    })
    await toDetails()

    const list = within((await screen.findByText('When was each one collected?')).closest('section')!)
    const first = within(list.getByText('DONA_01').closest('li')!)
    expect(first.getByText('Ready')).toBeInTheDocument()
    expect(first.getByText(/From the field records/)).toBeInTheDocument() // the FileTimestampLog that comes with the collection
    expect(first.getAllByText(/1 Sep 2024, 08:00 → 1 Nov 2024, 09:00/).length).toBeGreaterThan(0)
    const second = within(list.getByText('DONA_02').closest('li')!)
    await waitFor(() => expect(second.getByText(/From the images/)).toBeInTheDocument())
    expect(second.getByText(/5 Sep 2024, 09:00/)).toBeInTheDocument()

    // The field records give DONA_01's period: no other source is offered for it.
    expect(within(screen.getByRole('group', { name: 'Dates of DONA_01' })).getByText(/from the field records \(S_FileTimestampLog\.csv\)/)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Manual entry' })).not.toBeInTheDocument()
    expect(screen.queryByText('Epicollect5 project')).not.toBeInTheDocument()
  })

  it('has the camera, site and notes in a step of their own, locked until the dates are gone over', async () => {
    await toDetails()
    expect(screen.queryByRole('button', { name: /the details of DONA_01/ })).not.toBeInTheDocument() // locked
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()

    await toMoreDetailsSubstep()

    expect(await screen.findByRole('button', { name: /Open the details of DONA_01/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Collection and dates' })).toBeInTheDocument()
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

  it('says in the details when the dates come from the collection’s FileTimestampLog', async () => {
    mockedApi.scanSession.mockResolvedValue({
      ...SCAN,
      deployments: [{ ...SCAN.deployments[0], start_date: '2024-09-01T08:00:00', end_date: '2024-11-01T09:00:00', from_timestamp_log: true }, SCAN.deployments[1], SCAN.deployments[2]],
      timestamp_log: { name: 'S_FileTimestampLog.csv', path: '/s/S_FileTimestampLog.csv', rows: 1, matched: 1, revision: null },
    })
    await toDetails()
    expect((await screen.findAllByText(/come from the field records/))[0]).toHaveTextContent('1 of these 2 deployment(s) come from the field records, S_FileTimestampLog.csv')
    expect(screen.getByText(/Starts .* the first photo and ends .* the last/)).toBeInTheDocument() // against what the images say
  })

  describe('the next revision', () => {
    const toSuggested = async () => { await toOrigin(); await toDetailsSubstep() }

    it('suggests the highest next revision of the deployments’ locations, says so, and keeps what is typed', async () => {
      mockedApi.nextRevision.mockImplementation(async (_project, location) => (location === 'DONA_01' ? { last: 2, next: 3 } : { last: 4, next: 5 }))
      await toSuggested()

      await waitFor(() => expect(screen.getByLabelText('What collection number are you processing?')).toHaveValue(5))
      expect(screen.getByText(/Filled in as the next one expected for these locations/)).toBeInTheDocument()
      expectId('R0005-DONA_01')

      fireEvent.change(screen.getByLabelText('What collection number are you processing?'), { target: { value: '7' } })
      expect(screen.queryByText(/Filled in as the next one expected/)).not.toBeInTheDocument()
      expectId('R0007-DONA_01')
    })

    it('never shifts the images’ times: the location’s timezone is not applied, and it says so when it is not UTC', async () => {
      await toOrigin()

      expect(screen.queryByLabelText('Timezone (IANA)')).not.toBeInTheDocument()
      expect((await screen.findAllByText(/The location’s timezone is Europe\/Madrid, not UTC/)).length).toBe(2)
    })
  })

  describe('deducing the revision and the locations', () => {
    // The folders are named nothing like a location: only the log's ids say which one each is.
    const logged = (name: string, id: string) => ({ ...scanned(name, 5, '2024-09-01T08:00:00', '2024-11-01T09:00:00'), from_timestamp_log: true, log_deployment_id: id })
    beforeEach(() => {
      mockedApi.scanSession.mockResolvedValue({
        deployments: [logged('SITE_A', 'R0033-DONA_01'), logged('SITE_B', 'R0033-DONA_02')], loose_files: 0, warnings: [],
        timestamp_log: { name: 'R0033_FileTimestampLog.csv', path: '/s/R0033_FileTimestampLog.csv', rows: 2, matched: 2, revision: 33 },
      })
    })
    const toDeducedDetails = async () => {
      render(<ImportSessionPage {...pageProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
      await screen.findByDisplayValue('/s')
      await userEvent.click(screen.getByRole('button', { name: 'Scan' }))
      await screen.findByRole('checkbox', { name: 'SITE_A' })
      await next() // images → origin
      await pickProject()
      await assignLocations()
      await toDetailsSubstep()
    }

    it('fills in the revision from the ids in the log, says so, and lets it be changed', async () => {
      await toDeducedDetails()
      expect(await screen.findByText(/, from the field records \(R0033_FileTimestampLog\.csv\)/)).toBeInTheDocument()
      expectId('R0033-DONA_01')
      await userEvent.click(screen.getByRole('button', { name: 'Change' }))
      const field = screen.getByLabelText('What collection number are you processing?')
      expect(field).toHaveValue(33)
      expect(screen.getByText(/Taken from the deployment ids in R0033_FileTimestampLog.csv/)).toBeInTheDocument()

      fireEvent.change(field, { target: { value: '34' } })
      expect(screen.queryByText(/Taken from the deployment ids/)).not.toBeInTheDocument()
      expectId('R0034-DONA_01')
    })

    it('deduces the location from the log’s id when the folder’s name is no help, says so, and lets it be changed', async () => {
      await toDeducedDetails()
      expect(await screen.findByLabelText('Location of SITE_A')).toHaveValue('DONA_01')
      expect(screen.getByText(/Assigned from the deployment id in the timestamp log, R0033-DONA_01/)).toBeInTheDocument()

      await chooseLocation(screen.getByLabelText('Location of SITE_A'), 'DONA_02')
      expect(screen.queryByText(/Assigned from the deployment id in the timestamp log, R0033-DONA_01/)).not.toBeInTheDocument()
    })
  })

  describe('where were they taken', () => {
    const toLocations = async () => { await scanSession(); await next(); await pickProject() }

    it('assigns on its own the locations the folders are named after', async () => {
      await toLocations()

      await waitFor(() => expect(screen.getByLabelText('Location of DONA_01')).toHaveValue('DONA_01'))
      expect(screen.getByLabelText('Location of DONA_02')).toHaveValue('DONA_02')
      expect(screen.getByText(/Assigned from the folder's name, DONA_01/)).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('2 of 2 folders have a location')
      expect(screen.getByRole('progressbar', { name: 'Folders with a location' })).toHaveAttribute('aria-valuenow', '100')
      expect(screen.queryByRole('button', { name: /^Assign \d+$/ })).not.toBeInTheDocument()
    })

    it('says so when no folder name matches a location of the research project', async () => {
      mockedApi.listLocalLocations.mockResolvedValue({ results: [loc('OTHER_01')] })
      await toLocations()

      expect(await screen.findByRole('alert')).toHaveTextContent('No folder name matches a location in DONA')
      expect(screen.queryByRole('button', { name: /^Assign \d+$/ })).not.toBeInTheDocument()
    })

    it('says so when the research project has no locations yet', async () => {
      mockedApi.listLocalLocations.mockResolvedValue({ results: [] })
      await toLocations()

      expect(await screen.findByRole('alert')).toHaveTextContent('DONA has no locations yet')
    })

    it('shows the images of each folder, and lists only those missing a location', async () => {
      mockedApi.listLocalLocations.mockResolvedValue({ results: [loc('DONA_01')] })
      await toLocations()
      await waitFor(() => expect(screen.getByLabelText('Location of DONA_01')).toHaveValue('DONA_01'))
      expect(await screen.findByText('10 images')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('tab', { name: /Missing/ }))
      expect(screen.queryByLabelText('Location of DONA_01')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Location of DONA_02')).toBeInTheDocument()
    })
  })

  it('says nothing about a log when the session has none', async () => {
    await toDetails()
    await screen.findByText(/deployment\(s\) complete/)
    expect(screen.queryByText(/FileTimestampLog/)).not.toBeInTheDocument()
  })

  it('does not accept two deployments with the same location', async () => {
    await toDetails()
    await chooseLocation(screen.getByLabelText('Location of DONA_02'), 'DONA_01')

    expect((await screen.findAllByText(/Another deployment of the collection has this id/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('asks the revision as a question, and explains what it names', async () => {
    await toDetails()

    expect(screen.getByText('Which collection is this?')).toBeInTheDocument()
    expect(screen.getByLabelText('What collection number are you processing?')).toHaveValue(3)
    expect(screen.getByText(/1 for the first visit to these locations/)).toBeInTheDocument()
  })

  it('warns at the revision itself of how many of the deployments already exist', async () => {
    mockedApi.existingDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': `${COLLECTION}/R0003-DONA_01`, 'R0003-DONA_02': `${COLLECTION}/R0003-DONA_02` } })
    await toDetails()

    expect(await screen.findByText(/Collection R0003 already has 2 of these 2 deployment\(s\) in the collections folder/)).toBeInTheDocument()
    expect(screen.getByText('R0003-DONA_01, R0003-DONA_02', { selector: 'span' })).toBeInTheDocument()
  })

  it('offers to copy every deployment from its previous revision once the revision is known, and copies when asked', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: {
      'R0003-DONA_01': previous('R0002-DONA_01', { habitat: 'Pine forest' }), 'R0003-DONA_02': previous('R0002-DONA_02', { habitat: 'Oak forest' }),
    } })
    await toDetails() // offered with the revision itself

    expect(await screen.findByText(/Revision 1 is on file for DONA_01 and DONA_02/)).toBeInTheDocument()
    expect(screen.queryByText(/Filled in \d+ of/)).not.toBeInTheDocument() // nothing is copied unasked
    await userEvent.click(screen.getByRole('button', { name: 'Copy from revision 1' }))

    expect(await screen.findByText(/Filled in 2 of 2 from their previous revision/)).toBeInTheDocument()
    expect(mockedApi.previousDeployments).toHaveBeenCalledWith('DONA', ['R0003-DONA_01', 'R0003-DONA_02'])
    await toMoreDetailsSubstep()
    await openMore('DONA_01', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
    await openMore('DONA_02', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('Oak forest')
  })

  it('copies only what is on file, and what is typed afterwards is kept', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': previous('R0002-DONA_01', { habitat: 'Pine forest' }), 'R0003-DONA_02': null } })
    await toMoreDetails()
    await userEvent.click(await screen.findByRole('button', { name: 'Copy from revision 1' }))
    await screen.findByText('Filled in from R0002-DONA_01.')
    await openMore('DONA_01', /^Site/)
    fireEvent.change(screen.getByLabelText('Habitat'), { target: { value: 'My own habitat' } })
    await openMore('DONA_02')
    await openMore('DONA_01')

    await waitFor(() => expect(mockedApi.previousDeployments).toHaveBeenCalledTimes(1))
    await openMore('DONA_01', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('My own habitat')
  })

  it('says which deployments already exist, in the list and in the one being edited', async () => {
    mockedApi.existingDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': `${COLLECTION}/R0003-DONA_01`, 'R0003-DONA_02': null } })
    await toDetails()

    expect(await screen.findByRole('alert')).toHaveTextContent(`${COLLECTION}/R0003-DONA_01`)
    expect(screen.getByRole('alert')).toHaveTextContent('This deployment already exists')
    expect(screen.getAllByText('Already exists')).toHaveLength(1) // in the list of periods
    expect(mockedApi.existingDeployments).toHaveBeenCalledWith('DONA', ['R0003-DONA_01', 'R0003-DONA_02'])
    expect(screen.getAllByRole('alert')).toHaveLength(1) // only the deployment that exists
  })

  it('needs the revision', async () => {
    await toDetails()
    fireEvent.change(screen.getByLabelText('What collection number are you processing?'), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('adds a location by hand to a deployment', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [loc('DONA_01')] })
    mockedApi.saveLocalLocation.mockImplementation(async (_rp, location) => location)
    await toDetails()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add a new location' }))[1]) // DONA_02's
    expect(screen.getByLabelText('Location id')).toHaveValue('DONA_02')
    fireEvent.change(screen.getByLabelText('Location timezone'), { target: { value: 'Europe/Madrid' } })
    fireEvent.change(screen.getByLabelText('Location latitude'), { target: { value: '37.1' } })
    fireEvent.change(screen.getByLabelText('Location longitude'), { target: { value: '-6.4' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save location' }))

    await waitFor(() => expect(screen.getByLabelText('Location of DONA_02')).toHaveValue('DONA_02'))
    expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_02', latitude: 37.1, longitude: -6.4 }))
  })

  it('says in the postvalidation that some checks are customized in the settings, and has no fields for them', async () => {
    await toDetails()
    await next()

    expect(await screen.findByText(/are set in Settings › Postvalidation/)).toBeInTheDocument()
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
    expect(mockedApi.validateDeployment.mock.calls[0][1].start_date).toBe('2024-09-04T13:10:00Z') // the cameras' clock, UTC: never shifted
  })

  it('imports every deployment into the revision’s collection and offers to open it', async () => {
    await toDetails()
    await next() // details → checks
    await next() // checks → prepare
    await userEvent.click(await screen.findByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/Collection processed: 2 deployment/)
    expect(mockedApi.importLocal.mock.calls.map((c) => [c[0], c[1], c[3].deployment_id])).toEqual([
      ['/s/DONA_01', COLLECTION, 'R0003-DONA_01'], ['/s/DONA_02', COLLECTION, 'R0003-DONA_02'],
    ])
    expect(mockedApi.importLocal.mock.calls[0][2]).toBe('R0003')
    expect(mockedApi.importLocal.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, research_project: 'Doñana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(mockedApi.openFolder).toHaveBeenCalledWith(COLLECTION)
  })

  it('has Prepare images to choose what to do, Prepared images for how it went, and Save to your collection', async () => {
    await toDetails()
    await next(); await next()

    expect(await screen.findByText('Prepare images', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.getByText('Prepared images', { selector: 'h4' })).toBeInTheDocument()
    expect(screen.getByText('Save to your collection', { selector: 'h4' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/Collection processed: 2 deployment/)
    expect(screen.getByRole('progressbar', { name: 'Deployments processed' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('2 of 2 deployments processed')).toBeInTheDocument()
  })

  it('lets the optional preparation steps be switched off before importing', async () => {
    await toDetails()
    await next(); await next()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Resize the images' }))
    await userEvent.click(screen.getByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/Collection processed/)
    expect(mockedApi.importLocal.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, resize: false }))
  })

  it('offers to go on to the upload of the revision’s collection once the session is imported', async () => {
    const onUpload = vi.fn()
    pageProps = { onUpload }
    await toDetails()
    await next() // details → checks
    await next() // checks → prepare
    expect(screen.queryByRole('button', { name: /Upload to Trapper/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/Collection processed: 2 deployment/)
    await userEvent.click(screen.getByRole('button', { name: 'Go to Upload to Trapper →' }))
    expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0003' })
  })

  it('goes on past a failed deployment and retries only what is left', async () => {
    let failing = true
    mockedApi.importLocal.mockImplementation(async (_s, _d, _n, deployment, _p, onEvent) => {
      if (failing && deployment.deployment_id.endsWith('01')) throw new Error('disk full')
      onEvent({ type: 'done', dest_dir: `${COLLECTION}/${deployment.deployment_id}`, processed: 1, skipped: 0 })
    })
    await toDetails()
    await next(); await next()
    await userEvent.click(await screen.findByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/disk full/)
    expect(mockedApi.importLocal).toHaveBeenCalledTimes(2)
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Process the 1 left' }))

    await screen.findByText(/Collection processed/)
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
    await next(); await next()
    await userEvent.click(await screen.findByRole('button', { name: 'Process 2 deployments' }))

    await screen.findByText(/Collection processed/)
    expect(mockedApi.importLocal.mock.calls[0][3]).toEqual(expect.objectContaining({ setup_by: 'Ana', comments: 'Near the pond', camera_height: 1.2 }))
    expect(mockedApi.importLocal.mock.calls[1][3].setup_by).toBeNull() // each deployment has its own
  })

  const previous = (id: string, over: Record<string, unknown> = {}) => ({
    revision: 1, deployment_id: id,
    deployment: {
      ...EMPTY_DEPLOYMENT_FIELDS, deployment_id: id, location_id: 'X', latitude: 1, longitude: 2,
      start_date: '2024-01-01T00:00:00+01:00', end_date: '2024-02-01T00:00:00+01:00',
      habitat: 'Pine forest', setup_by: 'Ana', comments: 'Near the pond', camera_height: 1.2, tags: ['forest'], timestamp_issues: true, ...over,
    },
  })

  it('fills one deployment from its previous revision, keeping its own id, location and dates', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': previous('R0002-DONA_01') } })
    await toMoreDetails()
    await openMore('DONA_01')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill from the previous revision' }))

    expect(await screen.findByText('Filled in from R0002-DONA_01.')).toBeInTheDocument()
    expect(mockedApi.previousDeployments).toHaveBeenCalledWith('DONA', ['R0003-DONA_01', 'R0003-DONA_02'])
    await openMore('DONA_01', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
    expect(screen.getByLabelText('Set up by')).toHaveValue('Ana')
    expect(screen.getByRole('switch', { name: 'Photo dates may be wrong' })).toHaveAttribute('aria-checked', 'false') // not carried over
    await openMore('DONA_01', /^Grouping and notes/)
    expect(screen.getByLabelText('Comments')).toHaveValue('Near the pond')
    expect(screen.getByText('forest')).toBeInTheDocument()
  })

  it('does not offer to fill in from a previous revision once it is known there is none', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': null, 'R0003-DONA_02': null } })
    await toDetails()
    await waitFor(() => expect(mockedApi.previousDeployments).toHaveBeenCalled())

    await waitFor(() => expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Fill from the previous revision' })).not.toBeInTheDocument()
  })

  it('does not look for an earlier revision in the first one, which has none', async () => {
    await toDetails()
    fireEvent.change(screen.getByLabelText('What collection number are you processing?'), { target: { value: '1' } })
    await new Promise((resolve) => setTimeout(resolve, 600)) // longer than the wait before looking

    expect(mockedApi.previousDeployments).not.toHaveBeenCalledWith('DONA', expect.arrayContaining(['R0001-DONA_01']))
    expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill from the previous revision' })).not.toBeInTheDocument()
  })

  it('fills all the deployments at once, each from its own previous revision', async () => {
    mockedApi.previousDeployments.mockResolvedValue({ results: {
      'R0003-DONA_01': previous('R0002-DONA_01', { habitat: 'Pine forest' }), 'R0003-DONA_02': null,
    } })
    await toMoreDetails()
    await userEvent.click(await screen.findByRole('button', { name: /Copy from revision/ }))

    expect(await screen.findByText('Filled in from R0002-DONA_01.')).toBeInTheDocument()
    expect(mockedApi.previousDeployments).toHaveBeenCalledWith('DONA', ['R0003-DONA_01', 'R0003-DONA_02'])
    await openMore('DONA_01', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
    await openMore('DONA_02', /^Site/)
    expect(screen.getByLabelText('Habitat')).toHaveValue('') // nothing filled in
  })

  it('does not offer to fill in from a previous revision without a revision', async () => {
    await toDetails()
    fireEvent.change(screen.getByLabelText('What collection number are you processing?'), { target: { value: '' } })

    expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill from the previous revision' })).not.toBeInTheDocument()
  })

  describe('with a big session', () => {
    const names = Array.from({ length: 66 }, (_, i) => `DONA_${String(i + 1).padStart(2, '0')}`)
    beforeEach(() => {
      mockedApi.scanSession.mockResolvedValue({
        deployments: names.map((n) => scanned(n, 3, '2024-09-04T13:10:00', '2024-11-04T14:28:00')), loose_files: 0, warnings: [], timestamp_log: null,
      })
      // Only 60 of the 66 folders are named after a location of the project.
      mockedApi.listLocalLocations.mockResolvedValue({ results: names.slice(0, 60).map((n) => loc(n)) })
    })

    it('says how many are complete, and filters the list', async () => {
      await toDetails()

      expect(await screen.findByText('60 of 66 deployment(s) complete.')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Filter deployments'), { target: { value: '_6' } })
      const rows = screen.getAllByRole('button', { name: /^(Open|Close) DONA_/ })
      expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(expect.arrayContaining([expect.stringContaining('DONA_60'), expect.stringContaining('DONA_66')]))
      expect(rows).toHaveLength(7) // DONA_06 and DONA_60 to DONA_66
    })

    it('lists only the incomplete ones, and opens one of them', async () => {
      await toDetails()
      await userEvent.click(await screen.findByLabelText('Only the incomplete ones'))

      expect(screen.getAllByRole('button', { name: /^(Open|Close) DONA_/ })).toHaveLength(6)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      expect(screen.getByText('6 deployments need details.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Open DONA_61' }))
      expect(screen.getByRole('group', { name: 'Dates of DONA_61' })).toBeInTheDocument()
      await chooseLocation(screen.getByLabelText('Location of DONA_61'), 'DONA_01')
      expect((await screen.findAllByText(/Another deployment of the collection has this id/)).length).toBeGreaterThan(0)
    })
  })
})

describe('a collection of the cards folder', () => {
  const CARDS = '/data/wildintel-uploader/cards/DONA/R0003'
  const CARD_SCAN: SessionScan = {
    deployments: ['R0003-DONA_01', 'R0003-DONA_02'].map((n) => ({
      ...scanned(n, 5, null, null), start_date: '2024-09-01T08:00:00', end_date: '2024-11-01T09:00:00', from_timestamp_log: true, log_deployment_id: n,
    })),
    loose_files: 0, warnings: [], timestamp_log: { name: 'R0003_FileTimestampLog.csv', path: `${CARDS}/R0003_FileTimestampLog.csv`, rows: 2, matched: 2, revision: 3 },
  }
  beforeEach(() => {
    mockedApi.ingestCardCollections.mockResolvedValue({ results: [{ research_project_id: 'DONA', collection: 'R0003', folder: CARDS, deployments: 2, processed: 1 }] })
    mockedApi.scanSession.mockResolvedValue(CARD_SCAN)
    mockedApi.existingDeployments.mockResolvedValue({ results: { 'R0003-DONA_01': `${COLLECTION}/R0003-DONA_01`, 'R0003-DONA_02': null } })
    mockedApi.ingestFieldDetails.mockResolvedValue({ results: { 'R0003-DONA_02': {
      location_id: 'DONA_02', start: null, end: null, setup_by: 'Ana', camera_id: '47', tags: ['calibration'], comments: 'Near the pond', card: '7B',
    } } })
  })

  it('is picked from the list, and only the deployments not processed yet are ticked', async () => {
    render(<ImportSessionPage />)
    await userEvent.click(await screen.findByRole('radio', { name: 'DONA R0003' }))

    expect(await screen.findByRole('checkbox', { name: 'R0003-DONA_02' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'R0003-DONA_01' })).not.toBeChecked()
    expect(screen.getByText('Processed already')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 to process')).toBeInTheDocument()
    expect(mockedApi.scanSession).toHaveBeenCalledWith(CARDS)
    expect(mockedApi.ingestFieldDetails).toHaveBeenCalledWith('DONA', 'R0003')
    expect(screen.queryByText(/memory cards/)).not.toBeInTheDocument()
  })

  it('opens on the folder Copy SD cards gives it, with the research project and the field details', { timeout: 20000 }, async () => {
    render(<ImportSessionPage initial={{ researchProjectId: 'DONA', collection: 'R0003', folder: CARDS }} />)
    await screen.findByRole('checkbox', { name: 'R0003-DONA_02' })
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.getByLabelText('Location of R0003-DONA_02')).toHaveValue('DONA_02'), { timeout: 5000 })
    await userEvent.click(screen.getByRole('button', { name: /Continue to the details/ }))
    expect((await screen.findAllByText(/from the field records \(R0003_FileTimestampLog\.csv\)/, {}, { timeout: 5000 })).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled(), { timeout: 5000 })
    await userEvent.click(screen.getByRole('button', { name: 'Continue to more details' }))

    const row = await screen.findByRole('button', { name: /the details of R0003-DONA_02/ }, { timeout: 5000 })
    await waitFor(() => expect(row).toHaveTextContent('set up by Ana · camera 47'), { timeout: 5000 })
    expect(row).toHaveTextContent('From the field records')
  })
})

describe('withFieldDetails', () => {
  it('fills in only what is still empty', () => {
    const detail = { location_id: null, start: null, end: null, setup_by: 'Ana', camera_id: '47', tags: ['calibration'], comments: 'x', card: null }
    expect(withFieldDetails(EMPTY_DEPLOYMENT_FIELDS, detail)).toEqual(expect.objectContaining({ setup_by: 'Ana', camera_id: '47', tags: ['calibration'], comments: 'x' }))
    expect(withFieldDetails({ ...EMPTY_DEPLOYMENT_FIELDS, setup_by: 'Luis' }, detail).setup_by).toBe('Luis')
  })
})
