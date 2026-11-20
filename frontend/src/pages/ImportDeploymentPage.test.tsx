import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ImportDeploymentPage from './ImportDeploymentPage'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { DeploymentCheckResult, LocalLocation, LocalResearchProject, Report } from '../types'
import { APP_SETTINGS, DETAILED_SESSION, SESSION } from '../test/fixtures'

vi.mock('../api', () => ({
  api: {
    nextRevision: vi.fn(),
    trapperGetConfig: vi.fn(),
    getSettings: vi.fn(),
    exiftoolStatus: vi.fn(),
    writeTimestampLog: vi.fn(),
    logEntry: vi.fn(),
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperLocations: vi.fn(),
    trapperDeployments: vi.fn(),
    browseFolder: vi.fn(), copyCard: vi.fn(), ejectCard: vi.fn(), discardCardCopy: vi.fn(),
    scanFolder: vi.fn(), guessDetails: vi.fn(),
    importDeployment: vi.fn(),
    importLocal: vi.fn(), preprocess: vi.fn(), consolidate: vi.fn(),
    openFolder: vi.fn(),
    existingDeployments: vi.fn(),
    previousDeployments: vi.fn(),
    epicollectEntries: vi.fn(),
    checkCollection: vi.fn(),
    collectionPath: vi.fn(),
    listResearchProjects: vi.fn(),
    saveResearchProject: vi.fn(),
    listLocalLocations: vi.fn(),
    saveLocalLocation: vi.fn(),
    listLocalDeployments: vi.fn(),
    saveSelection: vi.fn(),
    saveScan: vi.fn(),
    saveDetails: vi.fn(),
    discardSession: vi.fn(),
    validateImages: vi.fn(),
    getReport: vi.fn(), reportUrl: (id: string, format: string) => `/api/reports/${id}/download?format=${format}`,
    validateDeployment: vi.fn(),
    closedVisits: vi.fn(), linkVisit: vi.fn(), timefixTimeline: vi.fn(), timefixShift: vi.fn(), timefixRemove: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const RESEARCH_PROJECTS = [{ pk: 2, name: 'Doñana', acronym: 'DONA' }]
const CLASSIFICATION_PROJECTS = [{ pk: 10, name: 'Main CP', is_active: true }]
const LOCATIONS = [{ pk: 5, location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid', latitude: 37.0, longitude: -6.5 }]
const EXISTING_DEPLOYMENTS = [{
  pk: 7, deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1',
  start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', camera_model: 'Reconyx HC600', tags: [] as string[],
}]
const LOCAL_DEPLOYMENTS = [{
  deployment_id: 'DONA-DONA_01', location_id: 'DONA_01', latitude: 37.0, longitude: -6.5,
  start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00', camera_model: 'Reconyx HC600', tags: [] as string[],
}]
// Where the app's collections folder keeps DONA's R0001 by default.
const COLLECTIONS_DIR = '/home/me/Documents/wildintel-uploader/collections/DONA/R0001'
// The scan only counts; the images' dates and camera are read when the details are asked for.
const SCAN_RESULT = { file_count: 12, image_count: 12, warnings: [] as string[] }
const GUESS = {
  start_date: '2024-09-04T13:10:00', end_date: '2024-11-04T14:28:00',
  camera_model: 'Reconyx HC600' as string | null, camera_id: null as string | null, warnings: [] as string[],
}

// What the collections folder holds — empty at first, like a first run — kept by the fakes below.
let storedProjects: LocalResearchProject[] = []
let storedLocations: Record<string, LocalLocation[]> = {}

const DONA_PROJECT: LocalResearchProject = { ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }
const DONA_01: LocalLocation = {
  location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid', latitude: 37.0, longitude: -6.5, coordinate_uncertainty: null, trapper_pk: 5,
}

/** A visit of the field work that was saved, as the book of visits keeps it. */
const storedVisit = (over: Record<string, unknown>) => ({
  location_id: 'DONA_01', session: 'R0001', date: '2026-06-10', time: '09:00:00', actions: ['Installation'], trappers: null, status: null, battery_status: null, card_status: null,
  num_photos: null, sd: null, date_time_ok: null, latitude: null, longitude: null, ...over,
}) as never
/** The revision of the visit that left the camera: the deployment is of it (R0001-DONA_01). A test that wants another sets it before the origin. */
let visitRevision = 1
/** The visit that left a camera at a location and the one that collected its card: the closed visit a deployment is of. Its dates are the ones the photos say (GUESS), and the
 * photos counted are the 12 of the folder. */
const closedVisitOf = (locationId: string) => ({
  visit: storedVisit({ location_id: locationId, session: `R${String(visitRevision).padStart(4, '0')}`, date: '2024-09-04', time: '13:10:00', actions: ['Installation'], sd: 'A13' }),
  end: storedVisit({ location_id: locationId, session: `R${String(visitRevision + 1).padStart(4, '0')}`, date: '2024-11-04', time: '14:28:00', actions: ['Revision'], num_photos: 12 }),
})

/** The card of the visit is the one the images say — what the check of the card answers, which is required by default. */
const SD_OK = { sd_card: { ok: true, message: 'The card is the one the visit left.' } }

beforeEach(() => {
  vi.clearAllMocks()
  visitRevision = 1
  mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [] })
  storedProjects = []
  storedLocations = {}
  pageProps = {}
  mockedApi.listResearchProjects.mockImplementation(async () => ({ results: [...storedProjects] }))
  mockedApi.saveResearchProject.mockImplementation(async (project) => { storedProjects.push(project); return project })
  mockedApi.listLocalLocations.mockImplementation(async (id) => ({ results: [...(storedLocations[id] ?? [])] }))
  mockedApi.saveLocalLocation.mockImplementation(async (id, location) => { (storedLocations[id] ??= []).push(location); return location })
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  // a deployment is always linked to a visit: every location the collections folder keeps has one closed visit without a deployment (R0001, closed by R0002), unless a test says otherwise
  mockedApi.closedVisits.mockImplementation(async (id) => ({ results: (storedLocations[id] ?? []).map((l) => closedVisitOf(l.location_id)) }))
  mockedApi.linkVisit.mockResolvedValue({} as never)
  mockedApi.existingDeployments.mockResolvedValue({ results: {} })
  mockedApi.nextRevision.mockRejectedValue(new Error('no suggestion'))  // the revision stays to be typed, unless a test says otherwise
  mockedApi.previousDeployments.mockResolvedValue({ results: {} })
  mockedApi.exiftoolStatus.mockResolvedValue({ available: true, path: '/usr/bin/exiftool' })
  mockedApi.logEntry.mockResolvedValue({ collection: 'R0001', timestamps: null, fieldwork: null })
  mockedApi.writeTimestampLog.mockResolvedValue({ path: `${COLLECTIONS_DIR}/R0001_FileTimestampLog.csv`, action: 'added', rows: 1, collection: 'R0001' })
  mockedApi.trapperGetConfig.mockResolvedValue({ base_url: 'https://trapper.example.org', user_name: 'alice', has_password: true })
  mockedApi.trapperTestConnection.mockResolvedValue({ ok: true, research_projects_count: 1 })
  mockedApi.trapperResearchProjects.mockResolvedValue({ results: RESEARCH_PROJECTS })
  mockedApi.trapperClassificationProjects.mockResolvedValue({ results: CLASSIFICATION_PROJECTS })
  mockedApi.trapperLocations.mockResolvedValue({ results: LOCATIONS })
  mockedApi.trapperDeployments.mockResolvedValue({ results: EXISTING_DEPLOYMENTS })
  mockedApi.scanFolder.mockResolvedValue(SCAN_RESULT)
  mockedApi.guessDetails.mockResolvedValue(GUESS)
  mockedApi.checkCollection.mockResolvedValue({ exists: true, name: 'Doñana 2024' })
  mockedApi.collectionPath.mockResolvedValue({ path: COLLECTIONS_DIR, collection: 'R0001', exists: false, name: null })
  mockedApi.listLocalDeployments.mockResolvedValue({ results: LOCAL_DEPLOYMENTS })
  mockedApi.saveSelection.mockResolvedValue({ task_id: 'task-1' } as never)
  mockedApi.saveScan.mockResolvedValue({ task_id: 'task-1' } as never)
  mockedApi.saveDetails.mockResolvedValue({ task_id: 'task-1' } as never)
  mockedApi.discardSession.mockResolvedValue({ status: 'discarded' })
  mockedApi.preprocess.mockImplementation(async (_src, _dir, _name, _dep, _pre, onEvent) => {
    onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0, sealed: null, report_id: null })
  })
  mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
    onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0, sealed: true })
  })
})

// ── Step-by-step helpers ─────────────────────────────────────────────────────

// Props the page is rendered with — reset for every test.
let pageProps: ComponentProps<typeof ImportDeploymentPage> = {}

/** The images are in a folder, not on a memory card — what is asked first. */
async function chooseFolder() {
  const folder = await screen.findByRole('radio', { name: /^No, they are in a folder/ })
  if (folder.getAttribute('aria-checked') !== 'true') await userEvent.click(folder)
}

/** The folder of the images, typed and scanned — the second step, after the origin. */
async function scanTheFolder() {
  await chooseFolder()
  await userEvent.type(screen.getByLabelText('Folder'), '/home/me/deployments/DONA_01')
  await userEvent.click(screen.getByRole('button', { name: 'Scan' }))
  await screen.findByText(/12 images found/)
}

const REPORT: Report = {
  id: 'r1', kind: 'validation', title: 'Validation of DONA_01', created_at: '2026-10-16T15:33:00+00:00', source_dir: '/home/me/deployments/DONA_01', deployment_id: null, checked: 12, parameters: {},
  checks: { corrupted: { label: 'Corrupted images', scope: 'images', ok: 10, failed: 2 } },
  totals: { entries: 12, ok: 10, failed: 2, images_with_issues: 2 },
  entries: [],
}

const IMAGE_CHECK_LABELS = ['Corrupted images', 'Shooting order vs. filename sequence', 'Folder structure (subfolders)', 'Same camera on every image', 'Required image data', 'Duplicate images (same content)']

/** How strict the check is — one of the radio buttons of its row: Skip, Warn or Must pass. */
const strictness = (check: string, choice: 'Skip' | 'Warn' | 'Must pass') =>
  within(screen.getByRole('radiogroup', { name: `How strict: ${check}` })).getByRole('radio', { name: choice })
const chooseStrictness = (check: string | number, choice: 'Skip' | 'Warn' | 'Must pass') =>
  userEvent.click(strictness(typeof check === 'number' ? IMAGE_CHECK_LABELS[check] : check, choice))

/** Goes on to the "More details" step — the camera, the site and the notes are there. */
const openMoreDetails = () => userEvent.click(screen.getByRole('button', { name: /Continue to more details/ }))
/** Opens a section of the more details — each is shut until it is opened. */
const openSection = async (name: RegExp) => {
  const header = screen.getByRole('button', { name })
  if (header.getAttribute('aria-expanded') === 'false') await userEvent.click(header)
}

const DEPLOYMENT_CHECK_LABELS = [
  'Deployment id format', 'Deployment id starts with its collection', 'Collection name', "Deployment id's location is the one you chose",
  'Image dates fit the deployment', 'Camera consistency',
  'Number of images is like the previous revisions', 'Number of sequences is like the previous revisions', 'Length of the sequences is like the previous revisions',
]
const chooseDeploymentStrictness = (index: number, choice: 'Skip' | 'Warn' | 'Must pass') => chooseStrictness(DEPLOYMENT_CHECK_LABELS[index], choice)

/** → the first step, the origin. */
async function goToOriginStep() {
  render(<ImportDeploymentPage {...pageProps} />)
  await screen.findByText('Where was it taken?')
}

/** The origin filled in by hand (DONA and DONA_01), then on to the images → the folder, scanned. */
async function goToImagesStep() {
  await goToOriginStep()
  await addProjectByHand()
  await addLocationByHand()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
  await chooseFolder()
  await screen.findByLabelText('Folder')
}

/** → the images' checks (their folder is scanned, and the checks are to choose). */
async function goToValidateStep() {
  await goToImagesStep()
  await scanTheFolder()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
  await screen.findByText('Choose the checks')
}

/** From the origin, filled in: the images (scanned, with their checks left as they are) and on to the dates and details. */
async function continueToDates() {
  await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
  await scanTheFolder()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
  await screen.findByText('Choose the checks')
  await runTheImageChecks()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

/** Runs the checks of the images, and waits for the results: the Continue of the page is there once they are. */
async function runTheImageChecks() {
  await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
}

/** Adds DONA and its location DONA_01 by hand to the empty collections
 * folder and picks them (→ step "deployment", the details). */
async function goToNewDetailsStep() {
  await goToOriginStep()
  await addProjectByHand()
  await addLocationByHand()
  await continueToDates()
  await screen.findByText('Dates of the deployment')
  // The images' dates and camera are read as the details open.
  await waitFor(() => expect(screen.queryByText(/Reading the dates and the camera/)).not.toBeInTheDocument())
}

/** The dates are the visits' and locked: Edit dates unlocks them, keeping the ones there are, and shows the fields. */
async function manualEntry() {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit dates' }))
}

async function addProjectByHand(name = 'Doñana', acronym = 'DONA', location: Partial<LocalLocation> = {}) {
  await userEvent.click(await screen.findByRole('button', { name: /add a new research project/i }))
  await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
  await userEvent.type(screen.getByLabelText('Name'), name)
  await userEvent.type(screen.getByLabelText('Acronym'), acronym)
  // its location is kept in its folder, with its visits (see the default of closedVisits): the visit is what is picked next
  storedLocations[acronym] = [{ ...DONA_01, trapper_pk: null, ignore_dst: false, ...location }]   // a location starts following summer time
  await userEvent.click(screen.getByRole('button', { name: 'Save research project' }))
  await screen.findByRole('table', { name: 'Collected visits' })
}

/** The closed visit of the location is picked: the deployment is of it, and its location, its dates and its card are the visit's. */
async function pickTheVisit() {
  const table = await screen.findByRole('table', { name: 'Collected visits' })
  await userEvent.click(within(table).getAllByRole('row')[1])
  await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
}
const addLocationByHand = pickTheVisit

/** What the details step requires: nothing is asked — the revision, and so the id of the deployment "R0001-DONA_01", are the visit's, and the location was
 * picked with it in the origin step. */
async function fillRequiredDetails() {
  await screen.findByText('Dates of the deployment')
}

/** From the dates to More details — the step the Continue of the page belongs to: before it, the step open has its own. */
async function toMoreDetails() {
  const more = screen.queryByRole('button', { name: 'Continue to more details' })
  if (more) await userEvent.click(more)
}

/** Origin and details filled in, then Next (→ step "postvalidation"). `fillDetails` can fill in more first. */
async function goToPostvalidation(revision = '1', fillDetails?: () => Promise<void>) {
  visitRevision = Number(revision)   // the revision is the one of the visit
  await goToNewDetailsStep()
  await fillRequiredDetails()
  await fillDetails?.()
  await toMoreDetails()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Check the details', { selector: 'h4' })
}

/** From the postvalidation → step "preprocessing" (the list of what is done to the images). */
async function advanceToPreprocessing() {
  const run = screen.queryByRole('button', { name: 'Run checks' })   // the Continue of the page is there once the checks are run
  if (run) await userEvent.click(run)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Processing steps', { selector: 'h4' })
}

/** Runs the preprocessing, and goes on when it is done. */
async function runPreprocessingAndContinue() {
  await userEvent.click(screen.getByRole('button', { name: 'Start preparing' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save to my collection' })).toBeEnabled())
}

/** From the postvalidation → step "import", through the preprocessing. */
async function advanceToImportStep() {
  await advanceToPreprocessing()
  await runPreprocessingAndContinue()
  await screen.findByText('Review and save', { selector: 'h4' })
}

/** Everything up to the import step. */
async function walkToImportStep(revision = '1', fillDetails?: () => Promise<void>) {
  await goToPostvalidation(revision, fillDetails)
  await advanceToImportStep()
}

describe('ImportDeploymentPage', () => {
  it('asks where it was taken before anything else: the folder of the images comes next', () => {
    render(<ImportDeploymentPage />)
    expect(screen.getByText('Where was it taken?')).toBeInTheDocument()
    expect(screen.getByLabelText('Research project')).toBeInTheDocument()
    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('walks through validate, origin, details, postvalidation, preprocessing and import as separate screens', async () => {
    await goToOriginStep()
    await addProjectByHand()
    await addLocationByHand()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    await chooseFolder()
    expect(await screen.findByLabelText('Folder')).toBeInTheDocument() // the folder and the checks are one screen
    await scanTheFolder()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
    expect(await screen.findByText('Choose the checks')).toBeInTheDocument()

    await runTheImageChecks()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Dates of the deployment')).toBeInTheDocument()

    await fillRequiredDetails()
    await toMoreDetails()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Check the details', { selector: 'h4' })).toBeInTheDocument() // straight from the details

    await userEvent.click(screen.getByRole('button', { name: 'Run checks' })) // the dates must fit: Must pass by default
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Processing steps', { selector: 'h4' })).toBeInTheDocument() // the list of what is done to the images

    await runPreprocessingAndContinue()
    expect(await screen.findByText('Review and save', { selector: 'h4' })).toBeInTheDocument()
  })

  it('has no new-or-existing question and no destination to choose: the deployment is always a new one, kept locally', async () => {
    await goToPostvalidation()

    for (const gone of ['New or existing deployment?', 'Where to import', 'Collection folder', 'Connect to Trapper']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    for (const label of ['Origin', 'Images', 'Dates and details', 'Check details', 'Prepare and save']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Destination')).not.toBeInTheDocument()
  })

  describe('where the images were taken', () => {
    it('comes right after the folder is validated, before the deployment details', async () => {
      await goToOriginStep()

      expect(screen.getByLabelText('Research project')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
    })

    it('first run: the collections folder has no research projects, so the first one is added', async () => {
      await goToOriginStep()

      expect(await screen.findByText(/no research projects yet/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add a new research project/i })).toBeInTheDocument()
      expect(screen.queryByText('Location', { selector: 'h5' })).not.toBeInTheDocument() // no project, no locations to ask for
    })

    describe('the closed visit the deployment is of', () => {
      const stored = (over: Record<string, unknown>) => ({
        location_id: 'DONA_01', session: 'R0001', date: '2026-06-10', time: '09:00:00', actions: ['Installation'], trappers: null, status: null, battery_status: null, card_status: null,
        num_photos: null, sd: null, date_time_ok: null, latitude: null, longitude: null, ...over,
      }) as never
      const CLOSED = [
        { visit: stored({ session: 'R0002', date: '2026-08-05', time: '08:14:05', actions: ['Revision'], sd: 'B2' }), end: stored({ session: 'R0003', date: '2026-10-02', actions: ['Revision'], num_photos: 1620 }) },
        { visit: stored({ session: 'R0001', date: '2026-06-10', actions: ['Installation'], sd: 'A13' }), end: stored({ session: 'R0002', date: '2026-08-05', actions: ['Revision'], num_photos: 300 }) },
      ]

      async function pickProject() {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
      }

      it('asks for the closed visit instead of the location, and lists those that have no deployment yet', async () => {
        await pickProject()

        const table = await screen.findByRole('table', { name: 'Collected visits' })
        const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(1).map((c) => c.textContent))
        expect(rows).toEqual([
          ['R0002', 'DONA_01', 'Collected', 'B2', '5 Aug 2026, 08:14', '2 Oct 2026, 09:00', '1620', ''],
          ['R0001', 'DONA_01', 'Collected', 'A13', '10 Jun 2026, 09:00', '5 Aug 2026, 09:00', '300', ''],
        ])
        expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
        expect(mockedApi.closedVisits).toHaveBeenCalledWith('DONA')
      })

      it('names the research project in the question about the visit — in bold, as a link to its details in the settings — when it is the default one', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
        mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, default_research_project: 'DONA' } })
        const onOpenSettings = vi.fn()
        render(<ImportDeploymentPage {...pageProps} onOpenSettings={onOpenSettings} />)

        expect(await screen.findByText(/Tell us in which of the visits of the project/)).toBeInTheDocument()
        expect(screen.getByText(/the SD card that holds the images you want to link to the new deployment was installed/)).toBeInTheDocument()
        expect(screen.queryByText(/This deployment is of the default research project/)).not.toBeInTheDocument()   // said once, in the question
        const link = screen.getByRole('button', { name: 'DONA' })
        expect(link).toHaveClass('font-bold')
        await userEvent.click(link)
        expect(onOpenSettings).toHaveBeenCalledWith('projects', undefined, 'DONA')
      })

      it('opens the data of the site of a row in a panel at the right — with a way on to the settings — without picking the visit', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
        const onOpenSettings = vi.fn()
        render(<ImportDeploymentPage {...pageProps} onOpenSettings={onOpenSettings} />)
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        const table = await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(within(within(table).getByRole('row', { name: /R0002/ })).getByRole('button', { name: 'DONA_01' }))
        const panel = within(screen.getByRole('dialog', { name: 'Details of the location DONA_01' }))
        expect(panel.getByRole('heading', { name: 'DONA_01' })).toBeInTheDocument()
        expect(panel.getByText('Doñana site 1')).toBeInTheDocument()          // its name is under the id, in the header — not again in the list
        expect(panel.getAllByText('Doñana site 1')).toHaveLength(1)
        expect(panel.getByRole('application', { name: 'Map of the location' })).toBeInTheDocument()   // where it is, on a map
        expect(onOpenSettings).not.toHaveBeenCalled()
        expect(within(table).queryByRole('button', { pressed: true })).not.toBeInTheDocument()     // the press went to the link, not to the row

        await userEvent.click(panel.getByRole('button', { name: 'Open it in the settings' }))
        expect(onOpenSettings).toHaveBeenCalledWith('locations', 'DONA', 'DONA_01')
        expect(screen.queryByRole('dialog', { name: /Details of the location/ })).not.toBeInTheDocument()
      })

      it('picks a visit by pressing its row, and lets it go by pressing the row again', async () => {
        await pickProject()
        const table = await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(within(table).getByRole('row', { name: /R0002/ }))
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
        expect(within(table).getByRole('button', { name: /R0002/, pressed: true })).toBeInTheDocument()
        expect(within(table).getByRole('button', { name: /R0001/, pressed: false })).toBeInTheDocument()
        await userEvent.click(within(table).getByRole('row', { name: /R0002/ }))
        expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
        // the search narrows the rows
        await userEvent.type(screen.getByLabelText('Filter the collected visits'), 'a13')
        expect(within(table).queryByRole('row', { name: /R0002/ })).not.toBeInTheDocument()
        expect(within(table).getByRole('row', { name: /R0001/ })).toBeInTheDocument()
      })

      it('tells the filters that are on — the revision picked and what is searched — and how many visits match', async () => {
        await pickProject()
        const filters = await screen.findByLabelText('Active filters')
        expect(filters).toHaveTextContent('Revision: All')
        expect(filters).toHaveTextContent('Search: None')
        expect(filters).toHaveTextContent('2 of 2 visits match')

        await userEvent.click(screen.getByRole('button', { name: /^R0001/ }))
        expect(screen.getByLabelText('Active filters')).toHaveTextContent('Revision: R0001')
        expect(screen.getByLabelText('Active filters')).toHaveTextContent('1 of 2 visits match')
        await userEvent.type(screen.getByLabelText('Filter the collected visits'), 'nothing like this')
        expect(screen.getByLabelText('Active filters')).toHaveTextContent('Search: “nothing like this”')
        expect(screen.getByLabelText('Active filters')).toHaveTextContent('0 of 2 visits match')
      })

      it('shows the details of a visit in a panel at the right from the eye of its row, without picking it', async () => {
        await pickProject()
        const table = await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(within(table).getByRole('button', { name: 'Show the details of the visit R0002 to DONA_01' }))
        const panel = within(screen.getByRole('dialog', { name: 'Details of the visit R0002 to DONA_01' }))
        expect(panel.getByRole('heading', { name: 'DONA_01' })).toBeInTheDocument()
        expect(panel.getByText('R0002 · 5 Aug 2026, 08:14 → 2 Oct 2026, 09:00')).toBeInTheDocument()         // the revision and the days it went from and to, under the site
        const left = within(panel.getByRole('region', { name: 'The visit that left the card' }))
        expect(left.getByText('5 Aug 2026, 08:14')).toBeInTheDocument()
        expect(left.getByText('B2')).toBeInTheDocument()                                   // the card it left
        expect(panel.getByText('58 days in the field')).toBeInTheDocument()
        const collected = within(panel.getByRole('region', { name: 'The visit that collected it' }))
        expect(collected.getByText('R0003')).toBeInTheDocument()
        expect(collected.getByText('1,620 images')).toBeInTheDocument()                     // what it counted
        expect(within(table).queryByRole('button', { pressed: true })).not.toBeInTheDocument()   // the press went to the eye, not to the row

        await userEvent.click(panel.getByRole('button', { name: 'Close' }))
        expect(screen.queryByRole('dialog', { name: /Details of the visit/ })).not.toBeInTheDocument()
      })

      it('opens the data of the SD card of a row in a panel at the right — with a way on to the settings — without picking the visit', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
        mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, sd_cards: [
          { label: 'B2', brand: 'SanDisk', capacity: '64 GB', in_service: '2026-01-10', research_project: 'DONA', status: 'active' },
        ] } })
        const onOpenSettings = vi.fn()
        render(<ImportDeploymentPage {...pageProps} onOpenSettings={onOpenSettings} />)
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        const table = await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(within(within(table).getByRole('row', { name: /R0002/ })).getByRole('button', { name: 'B2' }))
        const panel = within(screen.getByRole('dialog', { name: 'Details of the SD card B2' }))
        expect(panel.getByRole('heading', { name: 'B2' })).toBeInTheDocument()
        expect(panel.getByText('SanDisk', { selector: 'dd' })).toBeInTheDocument()
        expect(panel.getByText('64 GB', { selector: 'dd' })).toBeInTheDocument()
        expect(within(table).queryByRole('button', { pressed: true })).not.toBeInTheDocument()     // the press went to the link, not to the row
        await userEvent.click(panel.getByRole('button', { name: 'Open it in the settings' }))
        expect(onOpenSettings).toHaveBeenCalledWith('sdcards', 'DONA', 'B2')

        // a card that is not one of the project's says so
        await userEvent.click(within(within(table).getByRole('row', { name: /R0001/ })).getByRole('button', { name: 'A13' }))
        expect(screen.getByText(/The SD card A13 is not one of the SD cards of this research project yet/)).toBeInTheDocument()
      })

      it('shows only the search field when asked, and picks a visit from the list under it', async () => {
        await pickProject()
        await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(screen.getByRole('button', { name: 'Show only the search field' }))
        expect(screen.queryByRole('table', { name: 'Collected visits' })).not.toBeInTheDocument()
        const field = screen.getByLabelText('Filter the collected visits')
        expect(field).toHaveAttribute('placeholder', 'Select a visit…')
        await userEvent.click(field)
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()          // nothing typed, nothing offered
        await userEvent.type(field, 'R0001')
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        await userEvent.clear(field)
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()          // and when it is emptied again, nothing again
        await userEvent.type(field, 'R0001')
        const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
        expect(options).toEqual(['10 Jun 2026, 09:00 · DONA_01 · R0001 · Collected · card A13 · collected on 5 Aug 2026, 09:00 (300 images)'])

        await userEvent.click(screen.getByRole('option', { name: /R0001/ }))
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
        expect(field).toHaveValue('10 Jun 2026, 09:00 · DONA_01 · R0001 · Collected · card A13 · collected on 5 Aug 2026, 09:00 (300 images)')
      })

      it('shows the closed visits as labels when asked, and a label picks its visit as a row does', async () => {
        await pickProject()
        await screen.findByRole('table', { name: 'Collected visits' })

        await userEvent.click(screen.getByRole('button', { name: 'Show the visits as labels' }))
        expect(screen.queryByRole('table', { name: 'Collected visits' })).not.toBeInTheDocument()
        const labels = screen.getByRole('group', { name: 'Collected visits' })
        expect(within(labels).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Pick the visit R0002 to DONA_01', 'Pick the visit R0001 to DONA_01'])
        const label = within(labels).getByRole('button', { name: /R0002/ })
        expect(label).toHaveTextContent('DONA_01')
        expect(label).toHaveTextContent('Collected')
        expect(label).toHaveTextContent('R0002 · card B2')
        expect(label).toHaveTextContent('58 days in the field')                    // from the day it left to the day it was collected
        expect(label).toHaveTextContent('Left on5 Aug 2026, 08:14')
        expect(label).toHaveTextContent('Collected on2 Oct 2026, 09:00')
        expect(within(labels).getByRole('button', { name: /R0002/ })).toHaveTextContent('1620 images')

        await userEvent.click(within(labels).getByRole('button', { name: /R0002/ }))
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
        expect(within(labels).getByRole('button', { name: /R0002/, pressed: true })).toBeInTheDocument()
        // and back to the table: the row of the visit is still the one picked
        await userEvent.click(screen.getByRole('button', { name: 'Show the visits as a table' }))
        expect(within(screen.getByRole('table', { name: 'Collected visits' })).getByRole('button', { name: /R0002/, pressed: true })).toBeInTheDocument()
      })

      it('takes the location of the visit as the deployment\'s, and its session as the revision', async () => {
        await pickProject()
        await userEvent.click(within(await screen.findByRole('table', { name: 'Collected visits' })).getByRole('row', { name: /R0002/ }))

        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled())
        await continueToDates()
        await screen.findByText('Dates of the deployment')
        expect(screen.getByText((_, el) => el?.textContent === 'Visit DONA_01 · 5 Aug 2026, 08:14 → 2 Oct 2026, 09:00')).toBeInTheDocument() // the research project and the visit, with its range
        expect(screen.queryByLabelText('Revision')).not.toBeInTheDocument() // the visit gives it: it is not asked
      })

      it('records on the visit the deployment it closed, once the deployment is saved', async () => {
        await pickProject()
        await userEvent.click(within(await screen.findByRole('table', { name: 'Collected visits' })).getByRole('row', { name: /R0002/ }))
        await continueToDates()
        await screen.findByText('Dates of the deployment')
        await waitFor(() => expect(screen.queryByText(/Reading the dates and the camera/)).not.toBeInTheDocument())
        await toMoreDetails()
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        await screen.findByText('Check the details', { selector: 'h4' })
        await advanceToImportStep()
        await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

        await screen.findByText(/Deployment saved/)
        expect(mockedApi.linkVisit).toHaveBeenCalledWith('DONA', CLOSED[0].visit, 'R0002-DONA_01')
      })

      it('starts from a visit that was just closed: the research project and the visit are given, so it goes straight to the images', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        mockedApi.closedVisits.mockResolvedValue({ results: CLOSED })
        pageProps = { closedVisit: { researchProjectId: 'DONA', visit: CLOSED[1].visit } }
        render(<ImportDeploymentPage {...pageProps} />)

        expect(await screen.findByText('Select the folder')).toBeInTheDocument()                         // the origin is done: nothing to pick
        expect(screen.queryByRole('button', { name: /Continue to the images/ })).not.toBeInTheDocument()
        await scanTheFolder()
        await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
        await screen.findByText('Choose the checks')
        await runTheImageChecks()
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        await screen.findByText('Dates of the deployment')
        expect(screen.queryByLabelText('Revision')).not.toBeInTheDocument() // the visit gives it: it is not asked
        expect(mockedApi.guessDetails).toHaveBeenCalled()
      })

      it('fills in the revision, the period and the details from the two visits, and says where they come from', async () => {
        const start = stored({ session: 'R0001', date: '2026-06-10', time: '09:30:00', actions: ['Installation'], sd: 'A13', camera_id: 'P800', camera_model: 'Reconyx-PC800', setup_by: null, trappers: 'Ana Pérez', camera_height: 1.2, bait_use: true, comments: 'New camera' })
        const end = stored({ session: 'R0002', date: '2026-08-05', time: '08:10:00', actions: ['Revision'], num_photos: 12, comments: 'Batteries changed' })
        // what the server says of the deployment from its two visits, mixed as the FieldworkLog mixes them
        const details = { camera_id: 'P800', camera_model: 'Reconyx-PC800', setup_by: 'Setup: Ana Pérez | Retrieval: Luis', camera_height: 1.2, bait_use: true, comments: 'Setup: New camera | Retrieval: Batteries changed' }
        mockedApi.closedVisits.mockResolvedValue({ results: [{ visit: start, end, details }] })
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        await userEvent.click(within(await screen.findByRole('table', { name: 'Collected visits' })).getByRole('row', { name: /R0001/ }))
        await continueToDates()
        await screen.findByText('Dates of the deployment')

        expect(screen.queryByLabelText('Revision')).not.toBeInTheDocument() // the visit gives it: it is not asked
        expect(screen.getByText(/Locked · Field work \(R0001 → R0002\)/)).toBeInTheDocument()          // the dates are the visits', and locked
        expect(screen.getByText(/Dates come from field work visits/)).toHaveTextContent('Visits themselves are never modified.')
        await userEvent.click(screen.getByRole('button', { name: 'Continue to more details' }))
        const card = await screen.findByRole('region', { name: 'Pre-filled details' })
        expect(card).toHaveTextContent('Locked · Visit R0001')                                         // the visit is the only source: there is no previous deployment
        expect(card).toHaveTextContent('Data comes from field work visit R0001')
        expect(card).toHaveTextContent('Original records are never modified.')
        expect(within(card).getByText(/Field work visit: R0001 \(6 fields\)/)).toBeInTheDocument()   // camera id and model, set up by, height, bait and the notes
        expect(within(card).queryByText(/Previous deployment:/)).not.toBeInTheDocument()
        await openSection(/^Camera/); await openSection(/^Site/); await openSection(/^Grouping and notes/)
        expect(screen.getByLabelText('Camera id')).toHaveValue('P800')
        expect(screen.getByLabelText('Set up by')).toHaveValue('Setup: Ana Pérez | Retrieval: Luis')
        expect(screen.getByLabelText('Comments')).toHaveValue('Setup: New camera | Retrieval: Batteries changed') // both visits' notes, as the log has them
        // what the visit says is shown, not edited — until Edit details unlocks it, which keeps the values
        expect(screen.getByLabelText('Set up by')).toBeDisabled()
        await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))
        expect(screen.getByText(/Unlocked · Edited by hand/)).toBeInTheDocument()
        expect(screen.getByLabelText('Set up by')).toBeEnabled()
        expect(screen.getByLabelText('Set up by')).toHaveValue('Setup: Ana Pérez | Retrieval: Luis')
        await userEvent.clear(screen.getByLabelText('Set up by'))
        await userEvent.type(screen.getByLabelText('Set up by'), 'Luis')
        await userEvent.click(screen.getByRole('button', { name: 'Restore the pre-filled details' }))
        expect(screen.getByLabelText('Set up by')).toHaveValue('Setup: Ana Pérez | Retrieval: Luis') // back to what the visits say
        expect(screen.getByLabelText('Set up by')).toBeDisabled()
      })

      describe('the SD card and the number of photos, against what the visits say', () => {
        const SD_SETTINGS = () => mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: {
          ...APP_SETTINGS.FIELDWORK, sd_cards: [
            { label: 'A13', brand: 'SanDisk', capacity: '64 GB', in_service: null, research_project: 'DONA' }, { label: 'B2', brand: null, capacity: null, in_service: null, research_project: 'DONA' },
            { label: 'Z9', brand: null, capacity: null, in_service: null, research_project: 'OTHER' },
          ],
        } })

        async function toTheChecks(card: string | null, counted: number | null) {
          SD_SETTINGS()
          const start = stored({ session: 'R0001', date: '2026-06-10', actions: ['Installation'], sd: 'A13' })
          mockedApi.closedVisits.mockResolvedValue({ results: [{ visit: start, end: stored({ session: 'R0002', date: '2026-08-05', actions: ['Revision'], num_photos: counted }) }] })
          storedProjects = [DONA_PROJECT]
          storedLocations = { DONA: [DONA_01] }
          await goToOriginStep()
          await userEvent.click(await screen.findByLabelText('Research project'))
          await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
          await userEvent.click(within(await screen.findByRole('table', { name: 'Collected visits' })).getByRole('row', { name: /R0001/ }))
          await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
          await scanTheFolder()
          if (card) {
            // asked once the folder is chosen
            await userEvent.click(within(await screen.findByRole('table', { name: 'SD cards' })).getByRole('row', { name: new RegExp(`\\b${card}\\b`) }))
          }
          await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
          await screen.findByText('Choose the checks')
          await runTheImageChecks()
          await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
          await screen.findByText('Dates of the deployment')
          await waitFor(() => expect(screen.queryByText(/Reading the dates and the camera/)).not.toBeInTheDocument())
          await toMoreDetails()
          await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
          await screen.findByText('Check the details', { selector: 'h4' })
        }

        it('offers, with the research project, the cards of that project', async () => {
          SD_SETTINGS()
          storedProjects = [DONA_PROJECT]
          storedLocations = { DONA: [DONA_01] }
          await goToOriginStep()
          await userEvent.click(await screen.findByLabelText('Research project'))
          await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
          expect(screen.queryByRole('table', { name: 'SD cards' })).not.toBeInTheDocument() // not in the origin: it is asked after the folder
          await pickTheVisit()
          await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
          expect(screen.queryByRole('table', { name: 'SD cards' })).not.toBeInTheDocument() // nor before the folder is chosen
          await scanTheFolder()

          expect(screen.getByText(/It is checked against the card the visit says was left in the camera/)).toBeInTheDocument()           // what it is for is in a box above the table
          const cards = within(await screen.findByRole('table', { name: 'SD cards' }))
          expect(cards.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(1).map((c) => c.textContent))).toEqual([['A13', 'SanDisk', '64 GB', 'Active'], ['B2', '—', '—', 'Active']])
          // a row picks its card, and a second press lets it go
          await userEvent.click(cards.getByRole('row', { name: /A13/ }))
          expect(cards.getByRole('button', { name: /A13/, pressed: true })).toBeInTheDocument()
          await userEvent.click(cards.getByRole('row', { name: /A13/ }))
          expect(cards.getByRole('button', { name: /A13/, pressed: false })).toBeInTheDocument()
          // and the labels view offers the same cards
          await userEvent.click(screen.getByRole('button', { name: 'Show the SD cards as labels' }))
          expect(within(screen.getByRole('group', { name: 'SD cards' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Pick the SD card A13', 'Pick the SD card B2'])
        })

        const STRICT_CARD = 'How strict: The SD card is the one the visit left'
        const STRICT_PHOTOS = 'How strict: The images are those the visit counted'

        it('adds two checks to the details of a deployment of a visit: the card and the number of photos, as strict as the others', async () => {
          await toTheChecks('A13', 12)

          // the collection's FieldworkLog gets what the visits say of the deployment
          expect(mockedApi.writeTimestampLog).toHaveBeenCalledWith('DONA', expect.anything(), expect.objectContaining({
            left_session: 'R0001', left_action: 'Installation', left_sd: 'A13', collected_session: 'R0002', collected_action: 'Revision', counted_photos: 12, sd_card: 'A13',
          }))
          expect(screen.getByRole('radiogroup', { name: STRICT_CARD })).toBeInTheDocument()
          expect(screen.getByRole('radiogroup', { name: STRICT_PHOTOS })).toBeInTheDocument()
          await chooseStrictness('The SD card is the one the visit left', 'Must pass')
          expect(strictness('The SD card is the one the visit left', 'Must pass')).toBeChecked()
        })

        it('runs them with what the visit says and the card that was said for the images', async () => {
          mockedApi.validateDeployment.mockResolvedValue({ checked_count: 12, sd_card: { ok: true, message: 'x' }, photo_count: { ok: false, message: 'y' } })
          await toTheChecks('B2', 300)

          await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

          await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.arrayContaining(['sd_card', 'photo_count']),
            expect.objectContaining({ visit: { left_session: 'R0001', left_sd: 'A13', collected_session: 'R0002', counted_photos: 300, sd_card: 'B2' } }),
          ))
        })

        it('sends what was not said as nothing, for the checks to say they cannot check it', async () => {
          mockedApi.validateDeployment.mockResolvedValue({ checked_count: 12, ...SD_OK })
          await toTheChecks(null, null)

          await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

          await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.anything(),
            expect.objectContaining({ visit: { left_session: 'R0001', left_sd: 'A13', collected_session: 'R0002', counted_photos: null, sd_card: null } }),
          ))
        })
      })

    })

    describe('adding a research project by hand', () => {
      async function openTheForm() {
        await goToOriginStep()
        await userEvent.click(await screen.findByRole('button', { name: /add a new research project/i }))
        await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
      }

      it('asks for the fields of Trapper\'s "Add research project" form', async () => {
        await openTheForm()

        for (const label of ['Name', 'Acronym', 'Sampling design', 'Sensor method', 'Animal types', 'Bait use', 'Event interval', 'Keywords', 'Abstract', 'Methods', 'Description']) {
          expect(screen.getByLabelText(label)).toBeInTheDocument()
        }
        // Trapper's own choices and defaults.
        expect(screen.getByLabelText('Sampling design')).toHaveValue('1')
        expect(screen.getByRole('option', { name: 'simpleRandom' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'opportunistic' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'activityDetection' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'unmarked' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'acoustic' })).toBeInTheDocument()
        expect(screen.getByLabelText('Event interval')).toHaveValue(0)
        expect(screen.getByLabelText('Acronym')).toHaveAttribute('maxlength', '10')
        expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '255')
        expect(screen.getByLabelText('Abstract')).toHaveAttribute('maxlength', '2000')
        expect(screen.getByText('Comma or space delimited tags.')).toBeInTheDocument()
      })

      it('only saves once the name and the acronym are valid — the acronym needs 3 to 10 folder-safe characters', async () => {
        await openTheForm()
        const save = () => screen.getByRole('button', { name: 'Save research project' })
        expect(save()).toBeDisabled()

        await userEvent.type(screen.getByLabelText('Name'), 'Doñana')
        await userEvent.type(screen.getByLabelText('Acronym'), 'DO')
        expect(screen.getByText('Must have between 3 and 10 characters.')).toBeInTheDocument()
        expect(save()).toBeDisabled()

        await userEvent.type(screen.getByLabelText('Acronym'), ' N')
        expect(screen.getByText(/Only letters, digits/)).toBeInTheDocument() // it names a folder
        expect(save()).toBeDisabled()

        await userEvent.clear(screen.getByLabelText('Acronym'))
        await userEvent.type(screen.getByLabelText('Acronym'), 'DONA')
        expect(save()).toBeEnabled()
      })

      it('the event interval cannot be negative or left empty', async () => {
        await openTheForm()
        await userEvent.type(screen.getByLabelText('Name'), 'Doñana')
        await userEvent.type(screen.getByLabelText('Acronym'), 'DONA')
        expect(screen.getByRole('button', { name: 'Save research project' })).toBeEnabled()

        await userEvent.clear(screen.getByLabelText('Event interval'))
        expect(screen.getByRole('button', { name: 'Save research project' })).toBeDisabled()
        await userEvent.type(screen.getByLabelText('Event interval'), '-5')
        expect(screen.getByText('Must be a whole number, 0 or more.')).toBeInTheDocument()
      })

      it('keeps it in the collections folder and picks it', async () => {
        await openTheForm()
        await userEvent.type(screen.getByLabelText('Name'), 'Doñana')
        await userEvent.type(screen.getByLabelText('Acronym'), 'DONA')
        await userEvent.selectOptions(screen.getByLabelText('Bait use'), 'food')
        await userEvent.click(screen.getByRole('button', { name: 'Save research project' }))

        expect(await screen.findByText(/There is no collected visit without a deployment in DONA/)).toBeInTheDocument() // it has no visit yet: they are registered first
        expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Doñana', acronym: 'DONA', bait_use: 3, sampling_design: 1, event_interval: 0, trapper_pk: null,
        }))
        expect(storedProjects.map((p) => p.acronym)).toEqual(['DONA'])
        expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
      })

      it('says so when the research project is already there', async () => {
        mockedApi.saveResearchProject.mockRejectedValue(new Error("The research project 'DONA' already exists."))
        await openTheForm()
        await userEvent.type(screen.getByLabelText('Name'), 'Doñana')
        await userEvent.type(screen.getByLabelText('Acronym'), 'DONA')
        await userEvent.click(screen.getByRole('button', { name: 'Save research project' }))

        expect(await screen.findByText("The research project 'DONA' already exists.")).toBeInTheDocument()
        expect(screen.getByLabelText('Name')).toHaveValue('Doñana') // the form is still there
      })

      it('can be cancelled', async () => {
        await openTheForm()
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        expect(screen.queryByLabelText('Acronym')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /add a new research project/i })).toBeInTheDocument()
        expect(mockedApi.saveResearchProject).not.toHaveBeenCalled()
      })

      it('cannot move on while the form is open', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [DONA_01] }
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        await pickTheVisit()
        expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeEnabled()

        await userEvent.click(screen.getByRole('button', { name: /add a new research project/i }))
        expect(screen.getByRole('button', { name: /Continue to the images/ })).toBeDisabled()
      })
    })

    describe('adding a research project from Trapper', () => {
      async function openTrapperAndConnect() {
        await goToOriginStep()
        await userEvent.click(await screen.findByRole('button', { name: /add a new research project/i }))
        await userEvent.click(screen.getByRole('button', { name: /from trapper/i }))
      }

      const MORE_PROJECTS = [
        { pk: 2, name: 'Doñana', acronym: 'DONA' }, { pk: 9, name: 'Sierra Nevada', acronym: 'SINE' }, { pk: 11, name: 'Cazorla', acronym: 'CAZO' },
      ]

      it('connects, and ticking a Trapper research project simply adds it — there is no form', async () => {
        await openTrapperAndConnect()
        expect(screen.queryByLabelText('Acronym')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /add 0 research projects/i })).toBeDisabled()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 research project$/i }))

        expect(await screen.findByText(/There is no collected visit without a deployment in DONA/)).toBeInTheDocument() // added and picked: with no visit yet
        expect(screen.queryByLabelText('Acronym')).not.toBeInTheDocument()
        expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Doñana', acronym: 'DONA', trapper_pk: 2, // remembers which Trapper project it came from
          sampling_design: 1, event_interval: 0, // Trapper's own defaults for what the list doesn't carry
        }))
        expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
      })

      it('connects by itself with the account of the settings — it asks for no credentials', async () => {
        await openTrapperAndConnect()
        expect(screen.queryByLabelText('TRAPPER URL')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
        await screen.findByRole('checkbox', { name: 'DONA — Doñana' })
        // Blank credentials: the backend fills them in from settings.toml.
        expect(mockedApi.trapperTestConnection).toHaveBeenCalledWith({})
        expect(mockedApi.trapperResearchProjects).toHaveBeenCalledWith({})
      })

      it('says so, instead of asking, when the settings have no Trapper account', async () => {
        mockedApi.trapperGetConfig.mockResolvedValue({ base_url: null, user_name: null, has_password: false })
        await openTrapperAndConnect()
        expect(await screen.findByRole('alert')).toHaveTextContent(/save its URL, username and password in the settings/)
        expect(mockedApi.trapperTestConnection).not.toHaveBeenCalled()
      })

      it('more than one can be ticked: all are added, and the first is the one picked', async () => {
        mockedApi.trapperResearchProjects.mockResolvedValue({ results: MORE_PROJECTS })
        await openTrapperAndConnect()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'SINE — Sierra Nevada' }))
        await userEvent.click(screen.getByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 2 research projects/i }))

        await screen.findByText(/There is no collected visit without a deployment in SINE/)
        expect(mockedApi.saveResearchProject).toHaveBeenCalledTimes(2)
        expect(storedProjects.map((p) => p.acronym)).toEqual(['SINE', 'DONA'])
        expect(screen.getByLabelText('Research project')).toHaveValue('SINE — Sierra Nevada') // the first ticked, marked by default

        await userEvent.click(screen.getByLabelText('Research project')) // both are there to pick from
        expect(await screen.findByRole('option', { name: 'DONA — Doñana' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'SINE — Sierra Nevada' })).toBeInTheDocument()
        expect(screen.queryByRole('option', { name: 'CAZO — Cazorla' })).not.toBeInTheDocument() // not ticked
      })

      it('the Trapper research projects can be filtered as you type', async () => {
        mockedApi.trapperResearchProjects.mockResolvedValue({ results: MORE_PROJECTS })
        await openTrapperAndConnect()
        await userEvent.type(await screen.findByLabelText('Filter TRAPPER research projects'), 'caz')

        expect(screen.getByRole('checkbox', { name: 'CAZO — Cazorla' })).toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: 'DONA — Doñana' })).not.toBeInTheDocument()
      })

      it('one already in the collections folder is just picked, not added again', async () => {
        storedProjects = [DONA_PROJECT]
        await openTrapperAndConnect()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 research project$/i }))

        expect(await screen.findByText(/There is no collected visit without a deployment in DONA/)).toBeInTheDocument()
        expect(mockedApi.saveResearchProject).not.toHaveBeenCalled()
      })

      it('one whose acronym cannot be a folder name is not added — the others still are — and it says why', async () => {
        mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 9, name: 'Sierra Nevada', acronym: 'SN' }, ...MORE_PROJECTS.slice(0, 1)] })
        await openTrapperAndConnect()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'SN — Sierra Nevada' }))
        await userEvent.click(screen.getByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 2 research projects/i }))

        expect(await screen.findByText(/can't be added from TRAPPER as it is: Must have between 3 and 10 characters\. Add it by hand instead/)).toBeInTheDocument()
        expect(mockedApi.saveResearchProject).toHaveBeenCalledTimes(1)
        expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
      })
    })

  })

  it('the scan only counts the images: their dates and camera are read when the details are asked for', async () => {
    await goToImagesStep()
    await scanTheFolder()
    expect(mockedApi.scanFolder).toHaveBeenCalledTimes(1)
    expect(mockedApi.guessDetails).not.toHaveBeenCalled() // not through the origin, the scan or the validation
    await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
    await screen.findByText('Choose the checks')
    await runTheImageChecks()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Dates of the deployment')
    expect(await screen.findByText(/Locked · Field work/)).toBeInTheDocument()   // the visit says the dates, locked

    expect(mockedApi.guessDetails).toHaveBeenCalledTimes(1)
    expect(mockedApi.guessDetails).toHaveBeenCalledWith(expect.stringContaining('/'))
    expect(screen.getByText('4 Sep 2024, 13:10 (Europe/Madrid)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument() // locked: they are edited with Edit dates
    await manualEntry()
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
  })

  it('fills in the camera model and id from the images when every image has the same', async () => {
    mockedApi.guessDetails.mockResolvedValue({ ...GUESS, camera_model: 'Reconyx HC600', camera_id: 'P800HG08' })
    await goToNewDetailsStep()
    await openMoreDetails()
    await openSection(/^Camera/)

    expect(screen.getByLabelText('Camera model')).toHaveValue('Reconyx HC600')
    expect(screen.getByLabelText('Camera id')).toHaveValue('P800HG08')
  })

  it('leaves the camera model and id blank when the images do not agree on them', async () => {
    mockedApi.guessDetails.mockResolvedValue({ ...GUESS, camera_model: null, camera_id: null })
    await goToNewDetailsStep()
    await openMoreDetails()
    await openSection(/^Camera/)

    expect(screen.getByLabelText('Camera model')).toHaveValue('')
    expect(screen.getByLabelText('Camera id')).toHaveValue('')
  })

  it('keeps the camera the images gave when going on to the postvalidation and back', async () => {
    mockedApi.guessDetails.mockResolvedValue({ ...GUESS, camera_id: 'P800HG08' })
    await goToPostvalidation()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await openMoreDetails()
    await openSection(/^Camera/)

    expect(screen.getByLabelText('Camera id')).toHaveValue('P800HG08')
  })

  it('has a Back on the first step that goes back to the menu', async () => {
    const onBack = vi.fn()
    render(<ImportDeploymentPage onBack={onBack} />)

    await userEvent.click(screen.getByRole('button', { name: /Back/ }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('has no Back on the first step when there is no menu to go back to', () => {
    render(<ImportDeploymentPage />)

    expect(screen.queryByRole('button', { name: /^← Back$|^Back$/ })).not.toBeInTheDocument()
  })

  it('has only the Continue of the step that is open: while the dates are, the one of the page — that goes on to the checks — is not there until More details is', async () => {
    await goToNewDetailsStep()
    await fillRequiredDetails()

    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()      // step 3 is locked: it has no Continue yet
    await userEvent.click(screen.getByRole('button', { name: 'Continue to more details' }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()                   // now it is the one of More details
    expect(screen.getByRole('button', { name: 'Continue to more details' }).closest('.hidden')).not.toBeNull()   // the dates are shut: theirs is not shown
  })

  it('asks for the deployment details right after the origin', async () => {
    await goToNewDetailsStep()
    await manualEntry()

    // Date fields are calendar pickers ("datetime-local"), which drop zero seconds.
    expect(screen.getByLabelText('Start')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
    expect(screen.getByLabelText('End')).toHaveValue('2024-11-04T14:28')
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()   // the visit gave the revision, the dates and the location

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-09-05T08:00' } })
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-05T08:00')

    await fillRequiredDetails()
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()
  })

  describe('the revision and the deployment id', () => {

    it('has the location\'s coordinates from the previous step: the details never ask for them', async () => {
      await goToNewDetailsStep()

      expect(screen.queryByText('Coordinates', { selector: 'h5' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Longitude')).not.toBeInTheDocument()
    })
  })

  it('checks in the form itself that the deployment starts before it ends', async () => {
    await goToNewDetailsStep()
    await manualEntry()
    await fillRequiredDetails()
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-09-01T08:00' } }) // before the start, 2024-09-04
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-09-04T13:10' } }) // the same moment
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-12-01T08:00' } })
    expect(screen.queryByText('Must be later than the start date.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()
  })

  it('checks the start date against the end date too, once the timezone is known', async () => {
    await goToNewDetailsStep()
    await manualEntry()
    await fillRequiredDetails()

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-12-31T00:00' } }) // after the end, 2024-11-04
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeDisabled()
  })

  it('gives both dates the timezone designator of the location', async () => {
    await goToNewDetailsStep()
    await manualEntry()
    expect(screen.getAllByText(/Saved as 2024-(09-04T13:10:00\+02:00|11-04T14:28:00\+01:00)/)).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-12-01T08:00' } })
    expect(screen.getByText('Saved as 2024-12-01T08:00:00+01:00')).toBeInTheDocument() // winter offset
  })

  it('shows the standard\'s description under each field', async () => {
    await goToNewDetailsStep()
    await manualEntry()

    expect(screen.queryByText(/Formatted as an ISO 8601 string with timezone designator/)).not.toBeInTheDocument() // the dates say no more than their labels
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(2) // start, end (the revision and the location came with the visit)
  })

  it('keeps the deployment details when going back to them from the postvalidation', async () => {
    await goToPostvalidation('1')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

  })

  it('saves the deployment\'s details into the session when leaving them, and nothing about a mode or a destination', async () => {
    await goToPostvalidation('3')

    expect(mockedApi.saveDetails).toHaveBeenCalledWith(
      'task-1', expect.objectContaining({ deployment_id: 'R0003-DONA_01', location_id: 'DONA_01', latitude: 37, longitude: -6.5 }),
    )
    expect(mockedApi.saveSelection).not.toHaveBeenCalled()
  })

  it('can go back to an earlier step and its data is still there', async () => {
    await goToValidateStep()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/deployments/DONA_01')
    expect(screen.getByText(/12 images found/)).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Back' }).at(-1)!) // the one of the step: the other belongs to the checks, shut
    expect(await screen.findByText('When was it collected?')).toBeInTheDocument()   // the question about the visit
    expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
  })

  it('asks whether the images are on a memory card, and shows the folder or the card according to the answer', async () => {
    await goToImagesStep()   // goes through the answer: a folder
    expect(screen.getByRole('radio', { name: /^No, they are in a folder/ })).toBeChecked()
    expect(screen.queryByLabelText('Where is the SD card?')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /^Yes, they are on the SD card/ }))
    expect(screen.getByLabelText('Where is the SD card?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
  })

  it('copies the memory card to a temporary folder and goes on with the copy as with a local folder', async () => {
    mockedApi.copyCard.mockImplementation(async (_path, onEvent) => {
      onEvent({ type: 'start', files: 12, bytes: 1200 })
      onEvent({ type: 'progress', copied: 12, files: 12, bytes_copied: 1200, bytes: 1200 })
      onEvent({ type: 'done', path: '/tmp/wildintel-sd/card-x/CARD_A', files: 12, bytes: 1200 })
    })
    mockedApi.discardCardCopy.mockResolvedValue({ removed: true })
    mockedApi.ejectCard.mockResolvedValue({ ejected: true, message: 'CARD_A ejected: you can take the card out.' })
    await goToImagesStep()
    await userEvent.click(screen.getByRole('radio', { name: /^Yes, they are on the SD card/ }))

    expect(screen.getByRole('button', { name: 'Copy the card' })).toBeDisabled()          // where the card is is asked first
    await userEvent.type(screen.getByLabelText('Where is the SD card?'), '/run/media/me/CARD_A')
    await userEvent.click(screen.getByRole('button', { name: 'Copy the card' }))

    expect(mockedApi.copyCard).toHaveBeenCalledWith('/run/media/me/CARD_A', expect.any(Function))
    await waitFor(() => expect(mockedApi.scanFolder).toHaveBeenCalledWith('/tmp/wildintel-sd/card-x/CARD_A'))   // the copy is what is scanned
    expect(await screen.findByText(/12 images found/)).toBeInTheDocument()
    expect(screen.getByText(/Copied to a temporary folder/)).toBeInTheDocument()
    expect(mockedApi.ejectCard).toHaveBeenCalledWith('/run/media/me/CARD_A')        // the card is ejected once copied
    expect(screen.getByText(/CARD_A ejected: you can take the card out/)).toBeInTheDocument()

    // another answer discards the copy
    await userEvent.click(screen.getByRole('radio', { name: /^No, they are in a folder/ }))
    expect(mockedApi.discardCardCopy).toHaveBeenCalledWith('/tmp/wildintel-sd/card-x/CARD_A')
  })

  it('starts the copy as soon as the card is picked with the native browser, and says what went wrong when it cannot be copied', async () => {
    mockedApi.browseFolder.mockResolvedValue({ path: '/run/media/me/CARD_B' })
    mockedApi.copyCard.mockRejectedValue(new Error("There is nothing on the memory card '/run/media/me/CARD_B'."))
    await goToImagesStep()
    await userEvent.click(screen.getByRole('radio', { name: /^Yes, they are on the SD card/ }))
    await userEvent.click(screen.getByRole('button', { name: /^browse/i }))

    expect(mockedApi.browseFolder).toHaveBeenCalledWith('Select the SD card')
    expect(await screen.findByRole('alert')).toHaveTextContent('There is nothing on the memory card')
    expect(mockedApi.scanFolder).not.toHaveBeenCalled()
  })

  it('fills the folder path from the native browser', async () => {
    mockedApi.browseFolder.mockResolvedValue({ path: '/home/me/deployments/DONA_01' })
    await goToImagesStep()

    await userEvent.click(screen.getByRole('button', { name: /^browse/i }))

    expect(mockedApi.browseFolder).toHaveBeenCalled()
    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/deployments/DONA_01')
  })

  it('shows an error when no native folder dialog is available', async () => {
    mockedApi.browseFolder.mockRejectedValue(new Error('No folder dialog tool found — install zenity (GNOME) or kdialog (KDE).'))
    await goToImagesStep()

    await userEvent.click(screen.getByRole('button', { name: /^browse/i }))

    expect(await screen.findByText(/install zenity/i)).toBeInTheDocument()
  })

  it('shows a scan error without crashing', async () => {
    mockedApi.scanFolder.mockRejectedValue(new Error('Not a folder: /nope'))
    await goToImagesStep()
    await userEvent.type(screen.getByLabelText('Folder'), '/nope')
    await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

    expect(await screen.findByText('Not a folder: /nope')).toBeInTheDocument()
  })

  describe('checking the images', () => {
    it('reports issues and lets the user continue when nothing is required', async () => {
      mockedApi.validateImages.mockResolvedValue({
        checked_count: 2, corrupted: [{ path: 'IMG_0002.jpg', error: 'cannot identify image file' }],
      })
      await goToValidateStep()

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['corrupted', 'sequence', 'structure', 'camera', 'exif', 'duplicates'], 'DONA', 'R0001-DONA_01', expect.any(Function))
      expect(await screen.findByText(/1 corrupted image\(s\): IMG_0002\.jpg/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('only runs the checks that are not skipped', async () => {
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, subdirectories: [] })
      await goToValidateStep()

      for (const check of [0, 1, 3, 4, 5]) await chooseStrictness(check, 'Skip')
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['structure'], 'DONA', 'R0001-DONA_01', expect.any(Function))
    })

    describe('the EXIF fields the wizard needs', () => {
      const COMPLETE = { date: { count: 0, examples: [] }, camera_model: { count: 0, examples: [] }, camera_id: { count: 0, examples: [] } }

      it('is one of the checks, on by default (it warns)', async () => {
        await goToValidateStep()

        expect(strictness('Required image data', 'Warn')).toBeChecked()
      })

      it('passes when every image has its capture date, camera model and camera id', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 3, exif_missing: COMPLETE })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText('Every image has its capture date, camera model and camera id.')).toBeInTheDocument()
      })

      it('says how many images lack each field, with examples, and leaves out the fields nobody lacks', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 10,
          exif_missing: {
            date: { count: 0, examples: [] },
            camera_model: { count: 2, examples: ['a.jpg', 'b.jpg'] },
            camera_id: { count: 10, examples: ['a.jpg', 'b.jpg', 'c.jpg'] },
          },
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/2 image\(s\) without a camera model, e\.g\. a\.jpg, b\.jpg/)).toBeInTheDocument()
        expect(screen.getByText(/10 image\(s\) without a camera id, e\.g\. a\.jpg, b\.jpg, c\.jpg/)).toBeInTheDocument()
        expect(screen.queryByText(/without a capture date/)).not.toBeInTheDocument()
      })

      it('blocks continuing when it is required and a field is missing, and lets go once it is not', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 2, exif_missing: { ...COMPLETE, date: { count: 1, examples: ['a.jpg'] } } })
        await goToValidateStep()
        await chooseStrictness(4, 'Must pass') // the fifth check
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        await screen.findByText(/1 image\(s\) without a capture date/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

        mockedApi.validateImages.mockResolvedValue({ checked_count: 2, exif_missing: COMPLETE })
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        await screen.findByText(/Every image has its capture date/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      })
    })

    describe('duplicate images', () => {
      it('is one of the checks, on by default', async () => {
        await goToValidateStep()

        expect(strictness('Duplicate images (same content)', 'Warn')).toBeChecked()
      })

      it('passes when no two images have the same content', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 3, duplicates: [] })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText('No duplicate images.')).toBeInTheDocument()
      })

      it('lists each group of identical files and how many extra copies there are', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 6,
          duplicates: [
            { size: 1000, files: ['IMG_0001.jpg', 'IMG_0001 (copy).jpg', 'sub/IMG_0001.jpg'] },
            { size: 2000, files: ['IMG_0005.jpg', 'IMG_0006.jpg'] },
          ],
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/2 group\(s\) of duplicate images \(3 extra copies\)/)).toBeInTheDocument()
        expect(screen.getByText('IMG_0001.jpg = IMG_0001 (copy).jpg = sub/IMG_0001.jpg')).toBeInTheDocument()
        expect(screen.getByText('IMG_0005.jpg = IMG_0006.jpg')).toBeInTheDocument()
      })

      it('lists the images that were imported before into the research project, and where', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 3, duplicates: [],
          duplicates_in_project: [{ file: 'IMG_0002.jpg', deployment_id: 'R0001-DONA_01', collection: 'R0001', original: 'IMG_0007.JPG' }],
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/1 image\(s\) already imported into the research project/)).toBeInTheDocument()
        expect(screen.getByText('IMG_0002.jpg — in R0001-DONA_01 (R0001) as IMG_0007.JPG')).toBeInTheDocument()
        expect(screen.getByText('No duplicate images.')).toBeInTheDocument()   // the folder itself has none
      })

      it('says no image was imported before when none was, and blocks when it is required and one was', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 2, duplicates: [], duplicates_in_project: [] })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        expect(await screen.findByText('No image was imported before into the research project.')).toBeInTheDocument()

        mockedApi.validateImages.mockResolvedValue({ checked_count: 2, duplicates: [], duplicates_in_project: [{ file: 'a.jpg', deployment_id: 'R0001-DONA_01', collection: 'R0001', original: null }] })
        await chooseStrictness(5, 'Must pass')
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        await screen.findByText(/1 image\(s\) already imported into the research project/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      })

      it('blocks continuing when it is required and there are duplicates', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 2, duplicates: [{ size: 10, files: ['a.jpg', 'b.jpg'] }] })
        await goToValidateStep()
        await chooseStrictness(5, 'Must pass') // the sixth check
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        await screen.findByText(/1 group\(s\) of duplicate images/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      })
    })

    describe('the same camera on every image', () => {
      it('is one of the checks, and can be made to pass', async () => {
        await goToValidateStep()

        expect(strictness('Same camera on every image', 'Warn')).toBeChecked()
        expect(screen.getAllByRole('radiogroup')).toHaveLength(7) // and the question of where the images are
      })

      it('passes when every image was taken by one camera, and says which', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 3, exiftool: true, cameras_without_info: 0,
          cameras: [{ model: 'Reconyx HC600', camera_id: 'P800HG08', count: 3, examples: ['a.jpg', 'b.jpg', 'c.jpg'] }],
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/Every image was taken by the same camera/)).toBeInTheDocument()
        expect(screen.getByText('Reconyx HC600 · id P800HG08')).toBeInTheDocument()
        expect(screen.queryByText(/ExifTool isn't installed/)).not.toBeInTheDocument()
      })

      it('lists each camera and how many images it took when there is more than one', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 5, exiftool: true, cameras_without_info: 0,
          cameras: [
            { model: 'Reconyx HC600', camera_id: 'A1', count: 4, examples: ['a.jpg', 'b.jpg', 'c.jpg'] },
            { model: 'Reconyx HC600', camera_id: 'B2', count: 1, examples: ['z.jpg'] },
          ],
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/The images come from 2 different cameras/)).toBeInTheDocument()
        expect(screen.getByText(/4 image\(s\), e\.g\. a\.jpg, b\.jpg, c\.jpg/)).toBeInTheDocument()
        expect(screen.getByText(/1 image\(s\), e\.g\. z\.jpg/)).toBeInTheDocument()
        expect(screen.getByText('Reconyx HC600 · id B2')).toBeInTheDocument()
      })

      it('does not pass while some images have no camera information', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 3, exiftool: true, cameras_without_info: 2,
          cameras: [{ model: 'Reconyx HC600', camera_id: 'A1', count: 1, examples: ['a.jpg'] }],
        })
        await goToValidateStep()
        await chooseStrictness(3, 'Must pass') // the camera check is the fourth
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/2 image\(s\) have no camera information/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // required, and not passed
      })

      it('blocks continuing when it is required and the images come from different cameras, and lets go once they do not', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 2, exiftool: true, cameras_without_info: 0,
          cameras: [
            { model: 'Reconyx HC600', camera_id: 'A1', count: 1, examples: ['a.jpg'] }, { model: 'Reconyx HC600', camera_id: 'B2', count: 1, examples: ['b.jpg'] },
          ],
        })
        await goToValidateStep()
        await chooseStrictness(3, 'Must pass')
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        await screen.findByText(/2 different cameras/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

        mockedApi.validateImages.mockResolvedValue({
          checked_count: 2, exiftool: true, cameras_without_info: 0,
          cameras: [{ model: 'Reconyx HC600', camera_id: 'A1', count: 2, examples: ['a.jpg', 'b.jpg'] }],
        })
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
        await screen.findByText(/Every image was taken by the same camera/)
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      })

      it('says when ExifTool is not installed, since the camera id may then be missing', async () => {
        mockedApi.validateImages.mockResolvedValue({
          checked_count: 1, exiftool: false, cameras_without_info: 0,
          cameras: [{ model: 'Reconyx HC600', camera_id: null, count: 1, examples: ['a.jpg'] }],
        })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText(/ExifTool isn't installed/)).toBeInTheDocument()
        expect(screen.getByText('Reconyx HC600 · no id')).toBeInTheDocument()
      })
    })

    it('has no Continue while the checks of the images run: it is the one of the results, and not active until they are done', async () => {
      let finish: (value: unknown) => void = () => {}
      mockedApi.validateImages.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
      await goToValidateStep()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()      // the step open is the one that chooses the checks: it has its Run checks

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()          // checking: not active
      finish({ checked_count: 2, corrupted: [] })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('has no Continue in the checks of the deployment until they have been run, and not active while they run', async () => {
      let finish: (value: unknown) => void = () => {}
      mockedApi.validateDeployment.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
      await goToPostvalidation()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()      // Choose the checks is the step open: the results are locked

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()          // checking: not active
      finish({ checked_count: 2, out_of_range: [], ...SD_OK })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('blocks continuing until a required check has been run and passes', async () => {
      mockedApi.validateImages.mockResolvedValue({
        checked_count: 2, corrupted: [{ path: 'IMG_0002.jpg', error: 'cannot identify image file' }],
      })
      await goToValidateStep()

      await chooseStrictness(0, 'Must pass')
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()   // not run yet

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(/1 corrupted image\(s\)/)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [] })
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText('No corrupted images.')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('a check that must pass stops blocking once it is skipped or only warns', async () => {
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [{ path: 'IMG_0002.jpg', error: 'cannot identify image file' }] })
      await goToValidateStep()
      await chooseStrictness(0, 'Skip') // the check no longer runs, and no longer has to pass
      expect(strictness('Corrupted images', 'Skip')).toBeChecked()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('tells, once the checks ran, whether the problems found stop you from continuing', async () => {
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [{ path: 'IMG_0002.jpg', error: 'cannot identify image file' }], report_id: 'r1' })
      mockedApi.getReport.mockResolvedValue(REPORT)
      await goToValidateStep()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/None is set to Must pass, so you can continue/)).toBeInTheDocument()
      await chooseStrictness(0, 'Must pass')
      expect(await screen.findByText(/set to Must pass — resolve it to continue/)).toBeInTheDocument()
    })
  })


  it('keeps the period always in view, and shows the camera, the site and the notes as sections to open', async () => {
    await goToNewDetailsStep()
    expect(screen.getByText('Recording period')).toBeInTheDocument()
    await manualEntry()
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    await openMoreDetails()
    await openSection(/^Camera/)
    expect(screen.getByLabelText('Camera model')).toBeInTheDocument()
    expect(screen.queryByLabelText('Habitat')).not.toBeInTheDocument()
    await openSection(/^Site/)
    expect(screen.getByLabelText('Habitat')).toBeInTheDocument()
  })

  it('exposes the Camtrap DP camera and grouping fields', async () => {
    await goToNewDetailsStep()
    await openMoreDetails()
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))   // the details are the visit's, locked, until they are unlocked
    await openSection(/^Camera/)
    await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
    await userEvent.type(await screen.findByLabelText('Depth below the surface (m)'), '4.8')
    await openSection(/^Site/)
    await userEvent.click(screen.getByRole('button', { name: 'Road underpass' }))
    await userEvent.click(screen.getByLabelText('Bait was used'))
    await userEvent.click(screen.getByLabelText('Image dates may be wrong'))
    await openSection(/^Grouping and notes/)
    await userEvent.type(screen.getByLabelText('Groups'), 'season:winter 2020{Enter}')
    await userEvent.type(screen.getByLabelText('Groups'), 'grid:A1{Enter}')
    await userEvent.type(screen.getByLabelText('Tags'), 'forest{Enter}')
    await userEvent.type(screen.getByLabelText('Tags'), 'north{Enter}')

    expect(screen.getByText('season:winter 2020')).toBeInTheDocument()
    await openSection(/^Site/)
    expect(screen.getByRole('button', { name: 'Road underpass' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Bait was used')).toBeChecked()
    expect(screen.getByLabelText('Image dates may be wrong')).toBeChecked()
    await openSection(/^Camera/)
    expect(screen.getByLabelText('Depth below the surface (m)')).toHaveValue(4.8)
  })

  describe('the postvalidation', () => {
    const NAMES_OK = {
      deployment_id: { ok: true, message: "'R0001-DONA_01' is a valid deployment id." },
      collection_name: { ok: true, message: "'R0001' is a valid collection name." },
      collection_prefix: { ok: true, message: 'The deployment id starts with its collection, R0001.' },
      location: { ok: true, message: "The deployment id's location is DONA_01, the one chosen." },
    }

    it('comes straight after the details and offers the naming, dates and camera checks', async () => {
      await goToPostvalidation()

      for (const label of DEPLOYMENT_CHECK_LABELS) expect(strictness(label, label === 'Image dates fit the deployment' ? 'Must pass' : 'Warn')).toBeChecked()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(11)   // with a visit: the SD card and the number of photos too
      expect(screen.queryByLabelText(/Start date before end date/)).not.toBeInTheDocument() // that one is checked in the details form itself
    })

    it('has a section to choose the checks and another for how they went, under the summary of the details and the title', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, ...NAMES_OK })
      await goToPostvalidation('1')

      expect(screen.getByText('Check the details', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getByText('Choose the checks', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getByText('Check results', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument() // nothing has run yet

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      expect(await screen.findByRole('button', { name: 'Run again' })).toBeInTheDocument()
      expect(screen.getByText('1. Choose the checks', { selector: 'h4' })).toBeInTheDocument() // done, shut, with its pencil
    })

    it('runs the checks with what the wizard knows of the deployment: its collection, its location and the tolerance', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, ...NAMES_OK })
      await goToPostvalidation('1')

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01',
        expect.objectContaining({ deployment_id: 'R0001-DONA_01', location_id: 'DONA_01' }),
        ['deployment_id', 'collection_prefix', 'collection_name', 'location', 'time_range', 'camera', 'image_count', 'sequence_count', 'sequence_length', 'sd_card', 'photo_count'],
        {
          collectionName: null, expectedLocationId: 'DONA_01', toleranceHours: 1, // the collection is the one the id names
          researchProjectId: 'DONA', // whose collections hold the previous revisions
          visit: { left_session: 'R0001', left_sd: 'A13', collected_session: 'R0002', counted_photos: 12, sd_card: null }, // the visit it is of
          statistics: {
            sequence_gap_seconds: 60, min_revisions: 2, method: 'median',
            image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
          },
        },
      ))
    })

    it('shows what each naming check found, and why one failed', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        ...SD_OK,
        checked_count: 2, ...NAMES_OK,
        location: { ok: false, message: "The deployment id's location is 'DONA_02', but the location chosen is DONA_01." },
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText("'R0001-DONA_01' is a valid deployment id.")).toBeInTheDocument()
      expect(screen.getByText('The deployment id starts with its collection, R0001.')).toBeInTheDocument()
      expect(screen.getByText("The deployment id's location is 'DONA_02', but the location chosen is DONA_01.")).toBeInTheDocument()
    })

    it('is customized in the settings: the wizard has no tolerance field and runs with the one of the settings, one hour by default', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK })
      await goToPostvalidation()
      expect(screen.queryByLabelText('Tolerance (hours)')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ toleranceHours: 1 }),
      ))
    })

    it('says which images fell outside the dates, by which rule, and what was expected', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        ...SD_OK,
        checked_count: 20, tolerance_hours: 1,
        out_of_range: [
          { path: 'IMG_0001.jpg', date: '2024-09-04T12:00:00', rule: 'first', expected: '2024-09-04T10:00:00 ± 1h' },
          { path: 'IMG_0020.jpg', date: '2024-09-09T10:00:00', rule: 'last', expected: '2024-09-10T10:00:00 ± 1h' },
          { path: 'IMG_0007.jpg', date: '2024-08-01T10:00:00', rule: 'between', expected: '2024-09-04T10:00:00 – 2024-09-10T10:00:00 ± 1h' },
        ],
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/3 image\(s\) outside the deployment's dates \(± 1 h\)/)).toBeInTheDocument()
      expect(screen.getByText(/the first image should be at the start/)).toBeInTheDocument()
      expect(screen.getByText(/the last image should be at the end/)).toBeInTheDocument()
      expect(screen.getByText(/it should be within the deployment/)).toBeInTheDocument()
      expect(screen.getByText(/4 Sep 2024, 12:00, the first image should be at the start \(4 Sep 2024, 10:00 ± 1h\)/)).toBeInTheDocument()
    })

    it('offers to fix the dates and times when images fell outside them, and comes back to the checks', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 3, ...SD_OK, tolerance_hours: 1, out_of_range: [{ path: 'IMG_0001.jpg', date: '2020-01-01T00:00:00', rule: 'first', expected: 'x' }] })
      mockedApi.timefixTimeline.mockResolvedValue({ folder: '/photos/card', period: null, tolerance_hours: 1, images: [], segments: [], undated: [], outside: 0, problems: [], ok: true, corrections: [] })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await userEvent.click(await screen.findByRole('button', { name: 'Fix the dates and times' }))
      expect(await screen.findByRole('heading', { name: 'Check and fix dates and times' })).toBeInTheDocument()
      await waitFor(() => expect(mockedApi.timefixTimeline).toHaveBeenCalledWith(expect.objectContaining({ folder: expect.any(String) })))

      await userEvent.click(screen.getAllByRole('button', { name: 'Back' })[0])
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Check and fix dates and times' })).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Run again' })).toBeInTheDocument()
    })

    it('says so when the first image is at the start, the last at the end and the rest in between', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 3, ...SD_OK, tolerance_hours: 2, out_of_range: [] })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/The first image is at the start, the last at the end and the rest in between \(± 2 h\)/)).toBeInTheDocument()
    })

    it('still reports the camera checks', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        ...SD_OK,
        checked_count: 2, camera_mismatches: [{ path: 'b.jpg', detected: 'Bushnell Trophy Cam' }], camera_models_found: ['Bushnell Trophy Cam', 'Reconyx HC600'],
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/1 image\(s\) with a different camera model than declared: b\.jpg/)).toBeInTheDocument()
      expect(screen.getByText(/2 distinct camera models found/)).toBeInTheDocument()
    })

    it('has the check of the image dates and the one of the SD card as Must pass by default: it cannot go on until the dates fit and the card is the visit\'s, or they are set to Warn', async () => {
      await goToPostvalidation()
      expect(strictness('Image dates fit the deployment', 'Must pass')).toBeChecked()
      expect(strictness('The SD card is the one the visit left', 'Must pass')).toBeChecked()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument() // not run yet: the Continue of the page is there once the checks have run

      await chooseDeploymentStrictness(4, 'Warn')
      await chooseStrictness('The SD card is the one the visit left', 'Warn')
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument() // even then it is not there until the checks have run
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()) // nothing is required then
    })

    it.each<[string, number, Partial<DeploymentCheckResult>, Partial<DeploymentCheckResult>, RegExp]>([
      ['a naming check', 0, { ...NAMES_OK, deployment_id: { ok: false, message: 'bad id' } }, NAMES_OK, /bad id/],
      ['the image dates', 4, { out_of_range: [{ path: 'a.jpg', date: '2024-08-01T00:00:00', rule: 'first', expected: 'x' }] }, { out_of_range: [] }, /1 image\(s\) outside/],
    ])('blocks continuing until %s, when required, has been run and passes', async (_name, index, failing, passing, message) => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [], ...failing })
      await goToPostvalidation()
      await chooseDeploymentStrictness(index, 'Must pass')
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument() // not run yet: the Continue of the page is there once the checks have run

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(message)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // run, but it failed

      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [], ...passing })
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('shows an error when the checks cannot run', async () => {
      mockedApi.validateDeployment.mockRejectedValue(new Error('Not a folder: /nope'))
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText('Not a folder: /nope')).toBeInTheDocument()
    })
  })

  describe('the statistical checks', () => {
    const stat = (over: Partial<import('../types').StatisticResult> = {}): import('../types').StatisticResult => ({
      ok: true, skipped: false, message: 'The number of images (310) is similar to the median of the 3 previous revision(s) of DONA_01 (allowed 150–450, ±50%).',
      value: 310, reference: 300, lower: 150, upper: 450, previous: 3,
      history: [{ revision: 1, deployment_id: 'R0001-DONA_01', value: 300 }, { revision: 2, deployment_id: 'R0002-DONA_01', value: 330 }, { revision: 3, deployment_id: 'R0003-DONA_01', value: 270.5 }],
      ...over,
    })

    it('has no fields for the parameters — they are customized in the settings', async () => {
      await goToPostvalidation()

      expect(screen.queryByText('Previous revisions', { selector: 'h5' })).not.toBeInTheDocument()
      for (const label of ['Sequence gap (seconds)', 'Previous revisions needed', 'Compared with', 'Images — similar within (%)', 'Sequences — similar within (%)', 'Sequence length — similar within (%)']) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
      }
    })

    it('runs with the parameters of the settings', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, POSTVALIDATION: {
        ...APP_SETTINGS.POSTVALIDATION, sequence_gap_seconds: 90, min_revisions: 3, similarity_method: 'range', image_count_tolerance: 20, sequence_count_tolerance: 30, sequence_length_tolerance: 40,
      } })
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({
          statistics: {
            sequence_gap_seconds: 90, min_revisions: 3, method: 'range',
            image_count_tolerance: 20, sequence_count_tolerance: 30, sequence_length_tolerance: 40,
          },
        }),
      ))
    })

    it('shows what each check found, with the value of each previous revision', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        ...SD_OK,
        checked_count: 310,
        image_count: stat(),
        sequence_count: stat({ ok: false, message: 'The number of sequences (900) is not similar to the median of the 3 previous revision(s) of DONA_01 (allowed 50–150, ±50%).' }),
        sequence_length: stat({ skipped: true, ok: true, message: 'Not enough history to judge the length of the sequences: 1 previous revision(s) of DONA_01 found, 2 needed.', history: [] }),
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/The number of images \(310\) is similar to the median of the 3 previous/)).toBeInTheDocument()
      expect(screen.getAllByText('R0001: 300 · R0002: 330 · R0003: 270.5')).toHaveLength(2) // under the images and under the sequences checks
      expect(screen.getByText(/The number of sequences \(900\) is not similar/)).toBeInTheDocument()
      expect(screen.getByText(/Not enough history to judge the length of the sequences: 1 previous revision/)).toBeInTheDocument()
    })

    it.each([['image_count', 6], ['sequence_count', 7], ['sequence_length', 8]] as const)('blocks continuing when %s is required and not similar', async (key, index) => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [], [key]: stat({ ok: false, message: 'it is not similar' }) })
      await goToPostvalidation()
      await chooseDeploymentStrictness(index, 'Must pass')
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(/it is not similar/)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [], [key]: stat() })
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('a check skipped for lack of history does not block, even when required', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK, out_of_range: [], image_count: stat({ skipped: true, ok: true, message: 'Not enough history', history: [] }) })
      await goToPostvalidation()
      await chooseDeploymentStrictness(6, 'Must pass')
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(/Not enough history/)

      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('hides the parameters when every statistical check is turned off in the settings', async () => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, POSTVALIDATION: { ...APP_SETTINGS.POSTVALIDATION, image_count: false, sequence_count: false, sequence_length: false } })
      await goToPostvalidation()

      await waitFor(() => expect(screen.queryByText('Previous revisions', { selector: 'h5' })).not.toBeInTheDocument())
      expect(screen.queryByLabelText('Sequence gap (seconds)')).not.toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'How strict: Camera consistency' })).toBeInTheDocument()
    })
  })

  describe('the collection\'s timestamp log', () => {
    it('is written for the deployment when leaving the details, before the postvalidation', async () => {
      await goToPostvalidation('1')

      expect(mockedApi.writeTimestampLog).toHaveBeenCalledWith('DONA', expect.objectContaining({
        deployment_id: 'R0001-DONA_01', start_date: '2024-09-04T13:10:00+02:00', end_date: '2024-11-04T14:28:00+01:00',
      }), expect.objectContaining({ left_session: 'R0001', collected_session: 'R0002' }))   // and what the visits say of it
    })

    it('cannot go on when the log cannot be written, and says why', async () => {
      mockedApi.writeTimestampLog.mockRejectedValue(new Error('R0001_FileTimestampLog.csv is missing the columns: EndDate, EndTime.'))
      await goToNewDetailsStep()
      await fillRequiredDetails()
      await toMoreDetails()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('R0001_FileTimestampLog.csv is missing the columns: EndDate, EndTime.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument() // still on the details
      expect(screen.queryByText('Postvalidation', { selector: 'h4' })).not.toBeInTheDocument()

      mockedApi.writeTimestampLog.mockResolvedValue({ path: 'x/R0001_FileTimestampLog.csv', action: 'added', rows: 1, collection: 'R0001' })
      await userEvent.click(screen.getByRole('button', { name: 'Continue' })) // tried again once it is fixed
      expect(await screen.findByText('Check the details', { selector: 'h4' })).toBeInTheDocument()
    })

    it('is written again, with the new dates, when the details are changed and left again', async () => {
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await manualEntry()
      fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-12-01T08:00' } })
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Check the details', { selector: 'h4' })

      expect(mockedApi.writeTimestampLog).toHaveBeenCalledTimes(2)
      expect(mockedApi.writeTimestampLog.mock.calls[1][1].end_date).toBe('2024-12-01T08:00:00+01:00')
    })
  })

  describe('the checks the settings turn on', () => {
    const settings = (validation: Partial<typeof APP_SETTINGS.VALIDATION>, postvalidation: Partial<typeof APP_SETTINGS.POSTVALIDATION> = {}) => ({
      ...APP_SETTINGS,
      VALIDATION: { ...APP_SETTINGS.VALIDATION, ...validation },
      POSTVALIDATION: { ...APP_SETTINGS.POSTVALIDATION, ...postvalidation },
    })

    it('shows only the validation checks turned on, and runs only those', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({ duplicates: false, exif: false, structure: false }))
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [] })
      await goToValidateStep()

      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'How strict: Duplicate images (same content)' })).not.toBeInTheDocument())
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Required image data' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Folder structure (subfolders)' })).not.toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'How strict: Corrupted images' })).toBeInTheDocument()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(4) // and the question of where the images are

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['corrupted', 'sequence', 'camera'], 'DONA', 'R0001-DONA_01', expect.any(Function))
    })

    it('says there is nothing to run when every validation check is turned off, and lets the user go on', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({ corrupted: false, sequence: false, structure: false, camera: false, exif: false, duplicates: false }))
      await goToValidateStep()

      expect(await screen.findByText(/Every validation check is turned off in the settings/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Run checks' })).toBeDisabled() // nothing to run
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('a required check that is turned off no longer shows, and no longer blocks going on', async () => {
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [] })
      await goToValidateStep()
      await chooseStrictness(0, 'Must pass') // Corrupted images
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument() // not run yet: the Continue of the page is there once the checks have run
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())

      mockedApi.getSettings.mockResolvedValue(settings({ corrupted: false }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Dates of the deployment')
      await userEvent.click(screen.getByRole('button', { name: 'Back' })) // read again on entering the step

      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'How strict: Corrupted images' })).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('reads the settings again when the validate step is shown, as they can change meanwhile', async () => {
      await goToValidateStep()
      expect(screen.getByRole('radiogroup', { name: 'How strict: Duplicate images (same content)' })).toBeInTheDocument()

      mockedApi.getSettings.mockResolvedValue(settings({ duplicates: false }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))

      await waitFor(() => expect(screen.queryByLabelText('Duplicate images (same content)')).not.toBeInTheDocument())
    })

    it('shows every check when the settings cannot be read', async () => {
      mockedApi.getSettings.mockRejectedValue(new Error('Backend not reachable'))
      await goToValidateStep()

      expect(screen.getAllByRole('radiogroup')).toHaveLength(7) // and the question of where the images are
    })

    it('shows only the postvalidation checks turned on, and runs only those', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, { location: false, camera: false, collection_prefix: false }))
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK })
      await goToPostvalidation()

      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: "How strict: Deployment id's location is the one you chose" })).not.toBeInTheDocument())
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Camera consistency' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Deployment id starts with its collection' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(8) // the three naming and dates checks, the SD card and the photos, and the three statistical ones

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), ['deployment_id', 'collection_name', 'time_range', 'image_count', 'sequence_count', 'sequence_length', 'sd_card', 'photo_count'], expect.anything(),
      ))
    })

    it('says there is nothing to run when every postvalidation check is turned off, and lets the user go on', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, {
        deployment_id: false, collection_prefix: false, collection_name: false, location: false, time_range: false, camera: false,
        sd_card: false, photo_count: false, image_count: false, sequence_count: false, sequence_length: false,
      }))
      await goToPostvalidation()

      expect(await screen.findByText(/Every postvalidation check is turned off in the settings/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run checks' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Tolerance (hours)')).not.toBeInTheDocument() // only the dates check uses it
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('runs with the tolerance of the setting', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, { tolerance_hours: 2.5 }))
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...SD_OK })
      await goToPostvalidation()

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ toleranceHours: 2.5 }),
      ))
    })
  })

  describe('the preprocessing list', () => {
    const preSettings = (pre: Partial<typeof APP_SETTINGS.PREPROCESSING>) => ({ ...APP_SETTINGS, PREPROCESSING: { ...APP_SETTINGS.PREPROCESSING, ...pre } })

    it('comes after the postvalidation and before the import, and lists what will be done to the images', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()

      expect(screen.queryByText('Import', { selector: 'h4' })).not.toBeInTheDocument()
      for (const title of ['Copy into the collection', 'Read the capture dates', 'Rename the images', 'Resize the images', 'Add metadata']) {
        expect(screen.getByText(title)).toBeInTheDocument()
      }
      expect(screen.getAllByText('Always')).toHaveLength(2) // copying and reading the dates aren't optional
      expect(screen.getByText(/originals are never touched/)).toBeInTheDocument()
    })

    it('says where the deployment is saved once the preparing is gone over, not before', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      expect(screen.queryByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)).not.toBeInTheDocument()

      await runPreprocessingAndContinue()
      expect((await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`))[0]).toBeInTheDocument()
    })

    it('says how the dates are read: in the deployment\'s timezone, ignoring summer time, converted to UTC', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()

      expect(screen.getByText(/as the camera.s local time in/)).toHaveTextContent('Europe/Madrid, converted to UTC') // a new location follows summer time

    })


    /** Locations kept before the summer-time setting was asked: they do not say it, so the setting's default stands. */
    const locationsWithoutSummerTime = () => mockedApi.saveLocalLocation.mockImplementation(async (id, location) => {
      const kept = { ...location, ignore_dst: null }
      ;(storedLocations[id] ??= []).push(kept)
      return kept
    })

    it('follows the settings for the dates when the location does not say: not ignoring summer time, not converting to UTC', async () => {
      locationsWithoutSummerTime()
      mockedApi.getSettings.mockResolvedValue(preSettings({ ignore_dst: false, convert_to_utc: false }))
      await goToPostvalidation()
      await advanceToPreprocessing()

      await waitFor(() => expect(screen.getByText(/as the camera.s local time in/)).not.toHaveTextContent('ignoring summer time'))
      expect(screen.getByText(/as the camera.s local time in/)).not.toHaveTextContent('converted to UTC')
    })

    it('reads the summer-time setting from the location rather than from the settings', async () => {
      mockedApi.saveLocalLocation.mockImplementation(async (id, location) => {
        const kept = { ...location, ignore_dst: false }  // the location says its cameras do not ignore summer time
        ;(storedLocations[id] ??= []).push(kept)
        return kept
      })
      mockedApi.getSettings.mockResolvedValue(preSettings({ ignore_dst: true }))  // the default says they do
      await goToPostvalidation()
      await advanceToPreprocessing()

      await waitFor(() => expect(screen.getByText(/as the camera.s local time in/)).not.toHaveTextContent('ignoring summer time'))
    })

    it('shows the name an image will get, built from the deployment id and the first date', async () => {
      await goToPostvalidation('3')
      await advanceToPreprocessing()

      expect(screen.getByText('R0003-DONA_01__20240904_1.JPEG')).toBeInTheDocument()
    })

    it('shows the width images are resized to, from the settings', async () => {
      mockedApi.getSettings.mockResolvedValue(preSettings({ resize_width: 1600 }))
      await goToPostvalidation()
      await advanceToPreprocessing()

      expect(await screen.findByText('1600 px')).toBeInTheDocument()
    })

    it('shows the metadata that will be written, and what is not set yet in the settings', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      await userEvent.click(await screen.findByRole('button', { name: /What gets written into each image/ }))

      expect(screen.getByText('CT (<camera make and model> Doñana)')).toBeInTheDocument()
      expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(2) // owner and publisher
      expect(screen.getAllByText('not set in Settings')).toHaveLength(2)
      expect(screen.getByText('https://creativecommons.org/licenses/by-nc/4.0/')).toBeInTheDocument()
      expect(screen.getByText(/© Unknown, \d{4}\. All rights reserved\./)).toBeInTheDocument()
      expect(screen.getAllByText('Doñana site 1').length).toBeGreaterThanOrEqual(2) // the coverage: the deployment's location, as none is set
    })

    it('shows the authorship from the settings', async () => {
      mockedApi.getSettings.mockResolvedValue(preSettings({ owner: 'Universidad de Huelva', publisher: 'WildINTEL', coverage: 'Doñana National Park' }))
      await goToPostvalidation()
      await advanceToPreprocessing()
      await userEvent.click(await screen.findByRole('button', { name: /What gets written into each image/ }))

      expect(await screen.findByText(/© Universidad de Huelva, \d{4}\. All rights reserved\./)).toBeInTheDocument()
      expect(screen.getByText('WildINTEL')).toBeInTheDocument()
      expect(screen.getByText('Doñana National Park')).toBeInTheDocument()
      expect(screen.queryByText('not set in Settings')).not.toBeInTheDocument()
    })

    it('starts with the steps the settings turn on', async () => {
      mockedApi.getSettings.mockResolvedValue(preSettings({ resize: false, metadata: false }))
      await goToPostvalidation()
      await advanceToPreprocessing()

      await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Resize the images' })).not.toBeChecked())
      expect(screen.getByRole('checkbox', { name: 'Rename the images' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Add metadata' })).not.toBeChecked()
    })

    it('offers to open the created folder in the file explorer once imported', async () => {
      mockedApi.openFolder.mockResolvedValue({ opened: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0 })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await runPreprocessingAndContinue()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      expect(screen.queryByRole('button', { name: 'Open folder' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(screen.getByRole('button', { name: 'What was saved' })).toHaveAttribute('aria-expanded', 'false')   // collapsed
      await userEvent.click(screen.getByRole('button', { name: 'What was saved' }))
      await userEvent.click(screen.getByRole('button', { name: 'Open folder' }))
      expect(mockedApi.openFolder).toHaveBeenCalledWith(`${COLLECTIONS_DIR}/R0001-DONA_01`)
    })

    it('offers to go on to the upload of the collection it was imported into, once imported', async () => {
      const onUpload = vi.fn()
      pageProps = { onUpload }
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0 })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await runPreprocessingAndContinue()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      expect(screen.queryByRole('button', { name: 'Upload to TRAPPER' })).not.toBeInTheDocument() // not before it is imported
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      await userEvent.click(screen.getByRole('button', { name: 'Upload to TRAPPER' }))
      expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0001' })
    })

    it('has no upload button when the page cannot go anywhere', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0 })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await runPreprocessingAndContinue()
      await userEvent.click(await screen.findByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(screen.queryByRole('button', { name: 'Upload to TRAPPER' })).not.toBeInTheDocument()
    })

    it('imports with the steps left ticked, and the values of the settings', async () => {
      locationsWithoutSummerTime()
      mockedApi.getSettings.mockResolvedValue(preSettings({ resize_width: 1600, owner: 'Universidad de Huelva', ignore_dst: false }))
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0 })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await waitFor(() => expect(screen.getByText('1600 px')).toBeInTheDocument())
      await userEvent.click(screen.getByRole('checkbox', { name: 'Resize the images' })) // not this time
      await runPreprocessingAndContinue()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01', COLLECTIONS_DIR, 'R0001', expect.anything(),
        {
          rename: true, resize: false, resize_width: 1600, metadata: true, owner: 'Universidad de Huelva', publisher: '', coverage: '',
          license_url: 'https://creativecommons.org/licenses/by-nc/4.0/', research_project: 'Doñana', convert_to_utc: true,
        },
        expect.any(Function),
      )
    })

    it('a step switched off here stays off when going back and forth, whatever the settings say', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Rename the images' }))
      expect(screen.getByRole('checkbox', { name: 'Rename the images' })).not.toBeChecked()

      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Processing steps', { selector: 'h4' })

      expect(screen.getByRole('checkbox', { name: 'Rename the images' })).not.toBeChecked()
    })

    it('cannot add metadata without ExifTool: that step is disabled and not sent', async () => {
      mockedApi.exiftoolStatus.mockResolvedValue({ available: false, path: null })
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()

      expect(await screen.findByText(/ExifTool is not installed, and writing the metadata needs it/)).toBeInTheDocument()
      const metadata = screen.getByRole('checkbox', { name: 'Add metadata' })
      expect(metadata).toBeDisabled()
      expect(metadata).not.toBeChecked()

      await runPreprocessingAndContinue()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))
      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, resize: true, metadata: false }))
    })

    it('can run with every optional step off', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      for (const name of ['Rename the images', 'Resize the images', 'Add metadata']) await userEvent.click(screen.getByRole('checkbox', { name }))

      await runPreprocessingAndContinue()
      expect(await screen.findByText('Review and save', { selector: 'h4' })).toBeInTheDocument()
      expect(mockedApi.preprocess.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: false, resize: false, metadata: false }))
    })

    it('has, in Review and save, the style of saving the visits: the summary card, the box with the lock that asks to save, and its own Back and Save at the foot — a single Back', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      await runPreprocessingAndContinue()
      await screen.findByText('Review and save', { selector: 'h4' })

      const summary = screen.getByRole('region', { name: 'What is going to be saved' })
      expect(summary).toHaveTextContent('Deployment')
      expect(summary).toHaveTextContent('R0001-DONA_01')
      const note = screen.getByRole('note')
      expect(note).toHaveTextContent('Saving seals the deployment')
      expect(note).toHaveTextContent('Do you want to save the deployment R0001-DONA_01 in DONA?')
      expect(screen.getAllByRole('button', { name: 'Back' }).filter((b) => !b.closest('.hidden'))).toHaveLength(1)   // the one of the step, not another one of the page
      expect(screen.getByRole('button', { name: 'Save to my collection' })).toBeEnabled()
    })

    it('cannot be saved before the preprocessing has run, and has to run it again after going back', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      expect(screen.queryByRole('button', { name: 'Save to my collection' })).not.toBeInTheDocument()   // it is under the notice of the last step, which opens once the images are prepared

      await runPreprocessingAndContinue()
      await screen.findByText('Review and save', { selector: 'h4' })
      expect(screen.getByRole('button', { name: 'Save to my collection' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Processing steps', { selector: 'h4' })
      expect(screen.queryByRole('button', { name: 'Save to my collection' })).not.toBeInTheDocument() // what it did may be stale now
    })

    it('has Processing steps to choose what to do and Processing results for how it went, with Prepare again in its header', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      expect(screen.getByText('Processing steps', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getByText('Processing results', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1) // the one at the bottom, until it has run

      await userEvent.click(screen.getByRole('button', { name: 'Start preparing' }))
      await screen.findByRole('button', { name: 'Prepare again' })

      expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1) // now beside Continue, and Prepare again is in the step's header
      expect(screen.getByRole('button', { name: 'Back' }).parentElement).toContainElement(screen.getByRole('button', { name: 'Continue to save' }))
      expect(screen.getByRole('button', { name: 'Prepare again' }).closest('section')).toContainElement(screen.getByText(/Processing results/, { selector: 'h4' }))
    })

    it('does not list every image as it goes', async () => {
      mockedApi.preprocess.mockImplementation(async (_src, _dir, _name, _dep, _pre, onEvent) => {
        onEvent({ type: 'copy', index: 1, total: 2, name: 'R0001-DONA_01__20240904_1.JPEG' })
        onEvent({ type: 'skipped', name: 'IMG_0002.JPG', detail: 'cannot identify image file' })
        onEvent({ type: 'metadata', total: 1 })
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 1, sealed: null, report_id: null })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await userEvent.click(screen.getByRole('button', { name: 'Start preparing' }))

      await userEvent.click(await screen.findByRole('button', { name: 'Continue to save' }))
      await screen.findByText(/Everything is ready/)
      expect(screen.queryByText('[1/2] R0001-DONA_01__20240904_1.JPEG')).not.toBeInTheDocument()
      expect(screen.queryByText(/Skipped IMG_0002/)).not.toBeInTheDocument()
    })

    it('says in the import step that it consolidates the deployment', async () => {
      await walkToImportStep()

      expect(screen.getByText(/Saving seals the deployment/)).toBeInTheDocument()
      expect(screen.getByText(/Everything is ready/)).toBeInTheDocument()
      expect(screen.getByText(/1 prepared/)).toBeInTheDocument()
    })
  })

  describe('the import', () => {
    it('keeps the deployment locally in its collection — <collections folder>/<research project>/<R0001>/<deployment id>', async () => {
      await walkToImportStep()

      expect(mockedApi.collectionPath).toHaveBeenCalledWith('DONA', 'R0001-DONA_01')
      expect((await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`))[0]).toBeInTheDocument()
    })

    it('imports into a collection that does not exist yet, naming it after the deployment\'s prefix, and shows its progress', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'sealing' })
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)

      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      const deployment = expect.objectContaining({ deployment_id: 'R0001-DONA_01', location_id: 'DONA_01', latitude: 37, longitude: -6.5 })
      expect(mockedApi.preprocess).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01', COLLECTIONS_DIR, 'R0001', deployment, expect.objectContaining({ rename: true, resize: true, metadata: true }), expect.any(Function),
      )
      expect(mockedApi.consolidate).toHaveBeenCalledWith('/home/me/deployments/DONA_01', COLLECTIONS_DIR, deployment, expect.any(Function))
      expect(screen.getByText(/is now in your local collection/)).toBeInTheDocument()
      // the card of what was saved: where it is, with the buttons to copy its path and open it, and that it is not on Trapper yet
      expect(screen.getByText('Not uploaded yet')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'What was saved' }))
      expect(screen.getByRole('button', { name: 'Copy path' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
      expect(screen.queryByText('Saving seals the deployment')).not.toBeInTheDocument()   // said before saving, not after
      expect(mockedApi.discardSession).toHaveBeenCalledWith('task-1')
      expect(screen.getByRole('button', { name: 'Add another deployment' })).toBeInTheDocument()
    })

    it('reuses a collection that already exists, keeping the name it has', async () => {
      mockedApi.collectionPath.mockResolvedValue({ path: COLLECTIONS_DIR, collection: 'R0001', exists: true, name: 'R0001_winter' })
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess).toHaveBeenCalledWith('/home/me/deployments/DONA_01', COLLECTIONS_DIR, null, expect.anything(), expect.anything(), expect.any(Function))
    })

    it('never talks to Trapper to import: registering there is a later phase', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.importDeployment).not.toHaveBeenCalled()
    })

    it('sends the Camtrap DP fields through to the import call', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep('1', async () => {
        await openMoreDetails()
        await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))
        await openSection(/^Camera/)
        await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
        await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
    await userEvent.type(await screen.findByLabelText('Depth below the surface (m)'), '4.8')
        await openSection(/^Site/)
        await userEvent.click(screen.getByRole('button', { name: 'Road underpass' }))
        await userEvent.click(screen.getByLabelText('Bait was used'))
        await openSection(/^Grouping and notes/)
        await userEvent.type(screen.getByLabelText('Groups'), 'season:winter 2020{Enter}')
    await userEvent.type(screen.getByLabelText('Groups'), 'grid:A1{Enter}')
        await userEvent.type(screen.getByLabelText('Tags'), 'forest{Enter}')
    await userEvent.type(screen.getByLabelText('Tags'), 'north{Enter}')
      })
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01', COLLECTIONS_DIR, 'R0001',
        expect.objectContaining({
          camera_depth: 4.8, feature_type: 'roadUnderpass', deployment_groups: 'season:winter 2020 | grid:A1',
          tags: ['forest', 'north'], bait_use: true,
        }),
        expect.anything(),
        expect.any(Function),
      )
    })

    it('cannot import when its collection cannot be worked out, and says why', async () => {
      mockedApi.collectionPath.mockRejectedValue(new Error("The research project 'DONA' can only have letters, digits, '_', '-' and '.' to be a folder name."))
      await goToPostvalidation()
      await advanceToPreprocessing()

      expect(await screen.findByText(/can only have letters, digits/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start preparing' })).toBeDisabled()
    })

    it('shows the error when the import fails', async () => {
      mockedApi.consolidate.mockRejectedValue(new Error('No space left on device'))
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))

      expect(await screen.findByText('No space left on device')).toBeInTheDocument()
      expect(mockedApi.discardSession).not.toHaveBeenCalled()
    })

    it('asks once it is done what next: open the folder, upload, add another, or go back to the menu of the deployments or to the main menu', async () => {
      const onDeploymentsMenu = vi.fn()
      const onMainMenu = vi.fn()
      const onUpload = vi.fn()
      pageProps = { onUpload, onDeploymentsMenu, onMainMenu }
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))
      await screen.findByText(/Deployment saved/)

      const next = within(screen.getByRole('group', { name: 'What next' }))
      expect(next.getAllByRole('button').map((b) => b.textContent)).toEqual(['Upload to TRAPPER', 'Add another deployment', '← Deployments menu', '← Main menu'])
      expect(screen.getByText('Review and save', { selector: 'h3, h4, h5, span, p' })).toBeInTheDocument()   // the same step, that now holds what was saved and what to do next
      expect(screen.queryByText('Review and upload')).not.toBeInTheDocument()
      expect(screen.getAllByText('Locked: the deployment is saved and sealed.')).toHaveLength(2)   // the two steps before it are locked once it is saved
      await userEvent.click(next.getByRole('button', { name: 'Main menu' }))
      expect(onMainMenu).toHaveBeenCalledTimes(1)
      await userEvent.click(next.getByRole('button', { name: 'Deployments menu' }))
      expect(onDeploymentsMenu).toHaveBeenCalledTimes(1)
    })

    it('starts over from the folder once it is done', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))
      await screen.findByText(/Deployment saved/)

      await userEvent.click(screen.getByRole('button', { name: 'Add another deployment' }))

      expect(await screen.findByText('Where was it taken?')).toBeInTheDocument() // from the beginning, the origin first
      expect(screen.getByLabelText('Research project')).toHaveValue('')
    })
  })

  it('resumes a run that had got as far as the details: it picks up at the origin, with the details kept', async () => {
    storedProjects = [DONA_PROJECT]
    storedLocations = { DONA: [DONA_01] }
    render(<ImportDeploymentPage resumeSession={DETAILED_SESSION} />)

    expect(await screen.findByText('Where was it taken?')).toBeInTheDocument() // the origin isn't saved in a session
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    await pickTheVisit()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/DONA_01') // its folder was kept, and scanned
    await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
    await screen.findByText('Choose the checks')
    await runTheImageChecks()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('Dates of the deployment')
    await manualEntry()
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10') // kept: the dates were typed
    expect(screen.getByRole('button', { name: 'Continue to more details' })).toBeEnabled()
    expect(mockedApi.saveScan).not.toHaveBeenCalled()
  })

  it('resumes a scanned-only session and lets the user pick up from the origin step', async () => {
    storedProjects = [DONA_PROJECT]
    storedLocations = { DONA: [DONA_01] }
    render(<ImportDeploymentPage resumeSession={SESSION} />)
    expect(await screen.findByText('Where was it taken?')).toBeInTheDocument()

    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    await pickTheVisit()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/DONA_01')
  })

  describe('one of several deployments imported one after another', () => {
    const queueOf = (over: Partial<NonNullable<ComponentProps<typeof ImportDeploymentPage>['queue']>> = {}) => ({
      index: 1, total: 3, current: 'R0001-DONA_01', next: 'R0001-DONA_02', parentFolder: null as string | null,
      onFolder: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onStop: vi.fn(), ...over,
    })

    it('says which one it is, and has the buttons to skip it or to stop', async () => {
      const queue = queueOf()
      pageProps = { queue }
      await goToOriginStep()

      expect(screen.getByRole('status', { name: 'The deployment in the queue' })).toHaveTextContent('Deployment 2 of 3R0001-DONA_01')
      await userEvent.click(screen.getByRole('button', { name: 'Skip this one' }))
      expect(queue.onSkip).toHaveBeenCalledTimes(1)
      await userEvent.click(screen.getByRole('button', { name: 'Stop here' }))
      expect(queue.onStop).toHaveBeenCalledTimes(1)
    })

    it('says to the queue the folder it was told, and proposes the one beside it for the next', async () => {
      const queue = queueOf({ parentFolder: '/home/me/DONA/R0001' })
      pageProps = { queue }
      await goToOriginStep()
      await addProjectByHand()
      await addLocationByHand()
      await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
      await chooseFolder()
      await screen.findByLabelText('Folder')
      await scanTheFolder()
      expect(queue.onFolder).toHaveBeenCalledWith('/home/me/deployments')   // the one that holds the folder that was scanned
      cleanup()

      const next = queueOf({ parentFolder: '/home/me/DONA/R0001' })
      pageProps = { queue: next }
      await goToOriginStep()
      await addProjectByHand()
      await addLocationByHand()
      await userEvent.click(screen.getByRole('button', { name: /Continue to the images/ }))
      await chooseFolder()
      await screen.findByLabelText('Folder')
      await userEvent.click(screen.getByRole('button', { name: '/home/me/DONA/R0001/R0001-DONA_01' }))
      expect(mockedApi.scanFolder).toHaveBeenLastCalledWith('/home/me/DONA/R0001/R0001-DONA_01')
    })

    it('goes on to the next one, once it is saved, in the place of adding another', async () => {
      const queue = queueOf()
      pageProps = { queue }
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => { onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` }) })
      await walkToImportStep()
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))
      await screen.findByText(/Deployment saved/)

      expect(screen.queryByRole('button', { name: 'Add another deployment' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip this one' })).not.toBeInTheDocument()   // it is saved: nothing to skip
      await userEvent.click(screen.getByRole('button', { name: 'Next: R0001-DONA_02 (3 of 3)' }))
      expect(queue.onNext).toHaveBeenCalledTimes(1)
    })

    it('finishes, once the last one is saved', async () => {
      const queue = queueOf({ index: 2, next: null })
      pageProps = { queue }
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => { onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` }) })
      await walkToImportStep()
      await userEvent.click(screen.getByRole('button', { name: 'Save to my collection' }))
      await screen.findByText(/Deployment saved/)

      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      expect(queue.onStop).toHaveBeenCalledTimes(1)
    })
  })

  describe('a deployment that already exists', () => {
    it('says so as soon as the revision gives an id that is already kept, and where it is', async () => {
      mockedApi.existingDeployments.mockImplementation(async (_rp, ids) => ({
        results: Object.fromEntries(ids.map((id) => [id, `${COLLECTIONS_DIR}/${id}`])),
      }))
      await goToNewDetailsStep()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('This deployment already exists')
      expect(alert).toHaveTextContent(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      expect(mockedApi.existingDeployments).toHaveBeenCalledWith('DONA', ['R0001-DONA_01'])
    })

    it('says nothing when it is a new deployment', async () => {
      visitRevision = 2   // the revision is the visit's: R0002-DONA_01 is not kept
      mockedApi.existingDeployments.mockImplementation(async (_rp, ids) => ({
        results: Object.fromEntries(ids.map((id) => [id, id === 'R0001-DONA_01' ? `${COLLECTIONS_DIR}/${id}` : null])),
      }))
      await goToNewDetailsStep()

      await waitFor(() => expect(mockedApi.existingDeployments).toHaveBeenCalledWith('DONA', ['R0002-DONA_01']))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('the entry of the Epicollect5 form', () => {
    beforeEach(() => {
      mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, EPICOLLECT5: { ...APP_SETTINGS.EPICOLLECT5, enabled: true } })
    })

    const ENTRY = {
      uuid: 'u1', title: 'DONA_01', created_at: '2026-10-01T10:00:00.000Z',
      fields: { start_date: '2024-09-04', start_time: '13:10:00', end_date: '2024-10-12', end_time: '07:02:00', habitat: 'Pine forest', setup_by: 'Ana', comments: 'Near the pond', tags: ['forest'] },
    }

    it('is looked for by the location and the revision, and fills in the site and the notes, and is no source of the period', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      await userEvent.click(await screen.findByRole('button', { name: 'Import from Epicollect5' }))

      expect(await screen.findByText(/Filled in from “DONA_01 · sent 1 Oct 2026, 12:00 \(Europe\/Madrid\)”/)).toBeInTheDocument()
      expect(mockedApi.epicollectEntries).toHaveBeenCalledWith('DONA_01', 2)
      expect(screen.queryByRole('radio', { name: 'Epicollect5' })).not.toBeInTheDocument()
      await openMoreDetails()
      await openSection(/^Site/)
      expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
      expect(screen.getByLabelText('Set up by')).toHaveValue('Ana')
      await openSection(/^Grouping and notes/)
      expect(screen.getByLabelText('Comments')).toHaveValue('Near the pond')
    })

    it('says that Epicollect5 has the details, once there is an entry for the location and the revision', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      expect(await screen.findByText(/Epicollect5 has an entry for/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Import from Epicollect5' }))
      expect(await screen.findByText(/Filled in from “DONA_01 · sent 1 Oct 2026, 12:00 \(Europe\/Madrid\)”/)).toBeInTheDocument()
      expect(screen.queryByText(/Epicollect5 has an entry for/)).not.toBeInTheDocument()
    })

    it('warns when Epicollect5 has no entry for the location and the revision', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.epicollectEntries.mockResolvedValue({ results: [] })
      await goToNewDetailsStep()
      expect(await screen.findByText(/Epicollect5 has no entry for/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Import from Epicollect5' })).not.toBeInTheDocument()
    })

    it('warns with what Epicollect5 or the settings say when it can not be read, and goes to its settings', async () => {
      visitRevision = 2   // the revision is the visit's
      const onOpenSettings = vi.fn()
      pageProps = { onOpenSettings }
      mockedApi.epicollectEntries.mockRejectedValue(new Error('The location id is not mapped yet'))
      await goToNewDetailsStep()
      expect(await screen.findByText(/The location id is not mapped yet/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Open Epicollect5 settings' }))
      expect(onOpenSettings).toHaveBeenCalledWith('epicollect')
    })

    it('is neither offered nor looked at while the settings turn it off', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      await screen.findByText('Dates of the deployment')
      expect(screen.queryByRole('button', { name: /Import (info )?from Epicollect5/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/Epicollect5 has/)).not.toBeInTheDocument()
      expect(mockedApi.epicollectEntries).not.toHaveBeenCalled()
    })

    it('takes the newest when the location has several entries for the revision', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.epicollectEntries.mockResolvedValue({ results: [
        { ...ENTRY, uuid: 'new', fields: { ...ENTRY.fields, habitat: 'Marsh' } },
        { ...ENTRY, uuid: 'old', created_at: '2026-09-01T10:00:00.000Z' },
      ] })
      await goToNewDetailsStep()
      await userEvent.click(await screen.findByRole('button', { name: 'Import from Epicollect5' }))

      await openMoreDetails()
      await openSection(/^Site/)
      expect(await screen.findByLabelText('Habitat')).toHaveValue('Marsh')
      expect(screen.queryByRole('button', { name: 'Use this one' })).not.toBeInTheDocument()
    })
  })

  describe('an earlier revision of the deployment', () => {
    const PREVIOUS = {
      revision: 1, deployment_id: 'R0001-DONA_01',
      deployment: {
        deployment_id: 'R0001-DONA_01', location_id: 'DONA_01', location_name: 'Doñana site 1', latitude: 1, longitude: 2, coordinate_uncertainty: null,
        start_date: '2023-01-01T00:00:00+01:00', end_date: '2023-02-01T00:00:00+01:00', setup_by: 'Ana', camera_id: 'OLD-ID', camera_model: 'Old model',
        camera_interval: null, camera_height: 1.2, camera_depth: null, camera_tilt: null, camera_heading: null, detection_distance: null,
        timestamp_issues: true, bait_use: null, feature_type: null, habitat: 'Pine forest', deployment_groups: null, comments: 'Near the pond', tags: ['forest'],
      },
    }

    it('pre-fills the details with what the previous deployment says, overwritten with what the visit says, locked, and says where each part comes from', async () => {
      visitRevision = 2
      mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0002-DONA_01': PREVIOUS } })
      mockedApi.closedVisits.mockImplementation(async () => ({ results: [{ ...closedVisitOf('DONA_01'), details: { setup_by: 'MG', camera_model: 'Reconyx HC600' } }] }))
      await goToNewDetailsStep()
      await openMoreDetails()

      const card = await screen.findByRole('region', { name: 'Pre-filled details' })
      await waitFor(() => expect(card).toHaveTextContent('Locked · Previous deployment (R0001-DONA_01) & Visit R0002'))
      expect(card).toHaveTextContent('Data comes from previous deployment R0001-DONA_01 and field work visit R0002')
      expect(within(card).getByText(/Previous deployment: R0001-DONA_01 \(\d+ fields?\)/)).toBeInTheDocument()
      expect(within(card).getByText(/Field work visit: R0002 \(2 fields\)/)).toBeInTheDocument()
      const camera = screen.getByRole('region', { name: 'Camera' })
      expect(camera).toHaveTextContent('From Visit R0002 & R0001-DONA_01')
      expect(within(camera).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
      await openSection(/^Camera/); await openSection(/^Site/); await openSection(/^Grouping and notes/)
      expect(screen.getByLabelText('Camera model')).toHaveValue('Reconyx HC600')        // the visit overwrites what the previous deployment says (Old model)
      expect(screen.getByLabelText('Set up by')).toHaveValue('MG')                       // the visit
      expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')               // what the visit does not say stays as the previous deployment says it
      expect(screen.getByLabelText('Comments')).toHaveValue('Near the pond')
      expect(screen.getByLabelText('Habitat')).toBeDisabled()                           // locked
      await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))
      expect(screen.getByLabelText('Habitat')).toBeEnabled()
    })

    it('takes nothing from a visit that was not made: the previous deployment alone says the details', async () => {
      visitRevision = 2
      mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0002-DONA_01': PREVIOUS } })
      mockedApi.closedVisits.mockImplementation(async () => {
        const closed = closedVisitOf('DONA_01') as unknown as { visit: Record<string, unknown> }
        return { results: [{ ...closed, visit: { ...closed.visit, camera_status: 'Not revised' }, details: { setup_by: 'MG' } }] as never }
      })
      await goToNewDetailsStep()
      await openMoreDetails()

      const card = await screen.findByRole('region', { name: 'Pre-filled details' })
      await waitFor(() => expect(card).toHaveTextContent('Locked · Previous deployment (R0001-DONA_01)'))
      expect(card).not.toHaveTextContent('Field work visit')
      await openSection(/^Site/)
      expect(screen.getByLabelText('Set up by')).toHaveValue('Ana')                      // the previous deployment's: the visit says nothing
    })

    it('does not ask to copy the camera, the site and the notes from an earlier revision, with or without one: the dates step has no such notice', async () => {
      visitRevision = 2   // the revision is the visit's
      mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0002-DONA_01': PREVIOUS } })
      await goToNewDetailsStep()
      await waitFor(() => expect(mockedApi.previousDeployments).toHaveBeenCalled())

      expect(screen.queryByText(/is on file for/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument()
    })
  })

  describe('the revision and the location’s time settings', () => {

    it('does not ask the timezone nor summer time: it says them, as the location’s, before asking for the details', async () => {
      await goToNewDetailsStep()

      expect(screen.queryByLabelText('Timezone (IANA)')).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: /ignore summer time/ })).not.toBeInTheDocument()
      expect(screen.getByText(/Tell us when the images of/)).toBeInTheDocument()
      expect(screen.getByText(/which follows daylight saving time/)).toBeInTheDocument()
      for (const bold of ['DONA_01', 'Europe/Madrid']) expect(screen.getAllByText(bold).some((el) => el.tagName === 'STRONG')).toBe(true)
    })
  })
})
