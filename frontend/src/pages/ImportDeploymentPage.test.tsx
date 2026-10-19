import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    trapperTestConnection: vi.fn(),
    trapperResearchProjects: vi.fn(),
    trapperClassificationProjects: vi.fn(),
    trapperLocations: vi.fn(),
    trapperDeployments: vi.fn(),
    browseFolder: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  storedProjects = []
  storedLocations = {}
  pageProps = {}
  mockedApi.listResearchProjects.mockImplementation(async () => ({ results: [...storedProjects] }))
  mockedApi.saveResearchProject.mockImplementation(async (project) => { storedProjects.push(project); return project })
  mockedApi.listLocalLocations.mockImplementation(async (id) => ({ results: [...(storedLocations[id] ?? [])] }))
  mockedApi.saveLocalLocation.mockImplementation(async (id, location) => { (storedLocations[id] ??= []).push(location); return location })
  mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
  mockedApi.existingDeployments.mockResolvedValue({ results: {} })
  mockedApi.nextRevision.mockRejectedValue(new Error('no suggestion'))  // the revision stays to be typed, unless a test says otherwise
  mockedApi.previousDeployments.mockResolvedValue({ results: {} })
  mockedApi.exiftoolStatus.mockResolvedValue({ available: true, path: '/usr/bin/exiftool' })
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

async function scanTheFolder() {
  render(<ImportDeploymentPage {...pageProps} />)
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

const IMAGE_CHECK_LABELS = ['Corrupted images', 'Shooting order vs. filename sequence', 'Folder structure (subfolders)', 'Same camera on every image', 'Required photo data', 'Duplicate images (same content)']

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

/** → step "validate". */
async function goToValidateStep() {
  await scanTheFolder()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the checks/ }))
  await screen.findByText('Choose the checks')
}

/** → step "origin". */
async function goToOriginStep() {
  await goToValidateStep()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Where was it taken?')
}

/** Adds DONA and its location DONA_01 by hand to the empty collections
 * folder and picks them (→ step "deployment", the details). */
async function goToNewDetailsStep() {
  await goToOriginStep()
  await addProjectByHand()
  await addLocationByHand()
  await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))
  await screen.findByText('When was it collected?')
  // The images' dates and camera are read as the details open.
  await waitFor(() => expect(screen.queryByText(/Reading the dates and the camera/)).not.toBeInTheDocument())
}

async function addProjectByHand(name = 'Doñana', acronym = 'DONA') {
  await userEvent.click(await screen.findByRole('button', { name: /add a new research project/i }))
  await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
  await userEvent.type(screen.getByLabelText('Name'), name)
  await userEvent.type(screen.getByLabelText('Acronym'), acronym)
  await userEvent.click(screen.getByRole('button', { name: 'Save research project' }))
  await screen.findByRole('button', { name: /add a new location/i })
}

async function addLocationByHand(locationId = 'DONA_01', name = 'Doñana site 1', timezone = 'Europe/Madrid') {
  await userEvent.click(await screen.findByRole('button', { name: /add a new location/i }))
  await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
  await userEvent.type(screen.getByLabelText('Location id'), locationId)
  await userEvent.type(screen.getByLabelText('Location name (optional)'), name)
  await userEvent.type(screen.getByLabelText('Latitude'), '37.0')
  await userEvent.type(screen.getByLabelText('Longitude'), '-6.5')
  if (timezone) await userEvent.type(screen.getByLabelText('Timezone (IANA)'), timezone)
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled())
}

/** What the details step requires: the revision (which gives the deployment
 * id "R000<revision>-DONA_01"). The location — coordinates, timezone and
 * all — was already added in the origin step. */
async function fillRequiredDetails(revision = '1') {
  await userEvent.type(screen.getByLabelText('Revision'), revision)
}

/** Origin and details filled in, then Next (→ step "postvalidation"). `fillDetails` can fill in more first. */
async function goToPostvalidation(revision = '1', fillDetails?: () => Promise<void>) {
  await goToNewDetailsStep()
  await fillRequiredDetails(revision)
  await fillDetails?.()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Check the details', { selector: 'h4' })
}

/** From the postvalidation → step "preprocessing" (the list of what is done to the images). */
async function advanceToPreprocessing() {
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Preprocessing steps', { selector: 'h4' })
}

/** Runs the preprocessing, and goes on when it is done. */
async function runPreprocessingAndContinue() {
  await userEvent.click(screen.getByRole('button', { name: 'Start preparing' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save deployment' })).toBeEnabled())
}

/** From the postvalidation → step "import", through the preprocessing. */
async function advanceToImportStep() {
  await advanceToPreprocessing()
  await runPreprocessingAndContinue()
  await screen.findByText('Save to your collection', { selector: 'h4' })
}

/** Everything up to the import step. */
async function walkToImportStep(revision = '1', fillDetails?: () => Promise<void>) {
  await goToPostvalidation(revision, fillDetails)
  await advanceToImportStep()
}

describe('ImportDeploymentPage', () => {
  it('asks for the source folder before anything else', () => {
    render(<ImportDeploymentPage />)
    expect(screen.getByText(/don't point this at the card itself/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Folder')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('walks through validate, origin, details, postvalidation, preprocessing and import as separate screens', async () => {
    await goToValidateStep()
    expect(screen.getByText('Choose the checks')).toBeInTheDocument() // the folder and the checks are one screen

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Where was it taken?')).toBeInTheDocument()

    await addProjectByHand()
    await addLocationByHand()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))
    expect(await screen.findByText('When was it collected?')).toBeInTheDocument()

    await fillRequiredDetails()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Check the details', { selector: 'h4' })).toBeInTheDocument() // straight from the details

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Preprocessing steps', { selector: 'h4' })).toBeInTheDocument() // the list of what is done to the images

    await runPreprocessingAndContinue()
    expect(await screen.findByText('Save to your collection', { selector: 'h4' })).toBeInTheDocument()
  })

  it('has no new-or-existing question and no destination to choose: the deployment is always a new one, kept locally', async () => {
    await goToPostvalidation()

    for (const gone of ['New or existing deployment?', 'Where to import', 'Collection folder', 'Connect to Trapper']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    for (const label of ['Images', 'Origin and dates', 'Check details', 'Prepare and save']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Destination')).not.toBeInTheDocument()
  })

  describe('where the images were taken', () => {
    it('comes right after the folder is validated, before the deployment details', async () => {
      await goToOriginStep()

      expect(screen.getByLabelText('Research project')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeDisabled()
    })

    it('first run: the collections folder has no research projects, so the first one is added', async () => {
      await goToOriginStep()

      expect(await screen.findByText(/no research projects yet/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add a new research project/i })).toBeInTheDocument()
      expect(screen.queryByText('Location', { selector: 'h5' })).not.toBeInTheDocument() // no project, no locations to ask for
    })

    it('finds the research projects and locations already kept in the collections folder', async () => {
      storedProjects = [DONA_PROJECT, { ...DONA_PROJECT, name: 'Sierra Nevada', acronym: 'SINE', trapper_pk: null }]
      storedLocations = { DONA: [DONA_01] }
      await goToOriginStep()

      await userEvent.type(await screen.findByLabelText('Research project'), 'Doñ')
      expect(screen.queryByRole('option', { name: 'SINE — Sierra Nevada' })).not.toBeInTheDocument() // filtered as you type
      await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
      expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeDisabled() // no location yet

      await userEvent.type(await screen.findByLabelText('Location'), 'DONA_01')
      await userEvent.click(await screen.findByRole('option', { name: 'DONA_01 — Doñana site 1' }))
      expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled()

      await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))
      await screen.findByText('When was it collected?')
      expect(screen.getByText('Europe/Madrid')).toBeInTheDocument() // from the location, in the sentence about it
      expect(screen.queryByLabelText('Timezone (IANA)')).not.toBeInTheDocument() // not asked for the deployment
      await userEvent.type(screen.getByLabelText('Revision'), '3')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0003-DONA_01') // built from its location id
    })

    it('asks for no location until a research project is picked, and then for its own locations only', async () => {
      storedProjects = [DONA_PROJECT, { ...DONA_PROJECT, name: 'Sierra Nevada', acronym: 'SINE' }]
      storedLocations = { DONA: [DONA_01], SINE: [{ ...DONA_01, location_id: 'SINE_01', name: 'Sierra site' }] }
      await goToOriginStep()

      await userEvent.click(await screen.findByLabelText('Research project'))
      await userEvent.click(await screen.findByRole('option', { name: 'SINE — Sierra Nevada' }))
      await userEvent.click(await screen.findByLabelText('Location'))

      expect(await screen.findByRole('option', { name: 'SINE_01 — Sierra site' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'DONA_01 — Doñana site 1' })).not.toBeInTheDocument()
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

        expect(await screen.findByLabelText('Location')).toBeInTheDocument() // now asks for its location
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
        await userEvent.click(await screen.findByLabelText('Location'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA_01 — Doñana site 1' }))
        expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled()

        await userEvent.click(screen.getByRole('button', { name: /add a new research project/i }))
        expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeDisabled()
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

        expect(await screen.findByLabelText('Location')).toBeInTheDocument() // added and picked: on to its location
        expect(screen.queryByLabelText('Acronym')).not.toBeInTheDocument()
        expect(mockedApi.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Doñana', acronym: 'DONA', trapper_pk: 2, // remembers which Trapper project it came from
          sampling_design: 1, event_interval: 0, // Trapper's own defaults for what the list doesn't carry
        }))
        expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
      })

      it('connects by itself with the account of the settings — it asks for no credentials', async () => {
        await openTrapperAndConnect()
        expect(screen.queryByLabelText('Trapper URL')).not.toBeInTheDocument()
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

        await screen.findByLabelText('Location')
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
        await userEvent.type(await screen.findByLabelText('Filter Trapper research projects'), 'caz')

        expect(screen.getByRole('checkbox', { name: 'CAZO — Cazorla' })).toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: 'DONA — Doñana' })).not.toBeInTheDocument()
      })

      it('one already in the collections folder is just picked, not added again', async () => {
        storedProjects = [DONA_PROJECT]
        await openTrapperAndConnect()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 research project$/i }))

        expect(await screen.findByLabelText('Location')).toBeInTheDocument()
        expect(mockedApi.saveResearchProject).not.toHaveBeenCalled()
      })

      it('one whose acronym cannot be a folder name is not added — the others still are — and it says why', async () => {
        mockedApi.trapperResearchProjects.mockResolvedValue({ results: [{ pk: 9, name: 'Sierra Nevada', acronym: 'SN' }, ...MORE_PROJECTS.slice(0, 1)] })
        await openTrapperAndConnect()

        await userEvent.click(await screen.findByRole('checkbox', { name: 'SN — Sierra Nevada' }))
        await userEvent.click(screen.getByRole('checkbox', { name: 'DONA — Doñana' }))
        await userEvent.click(screen.getByRole('button', { name: /add 2 research projects/i }))

        expect(await screen.findByText(/can't be added from Trapper as it is: Must have between 3 and 10 characters\. Add it by hand instead/)).toBeInTheDocument()
        expect(mockedApi.saveResearchProject).toHaveBeenCalledTimes(1)
        expect(screen.getByLabelText('Research project')).toHaveValue('DONA — Doñana')
      })
    })

    describe('adding a location', () => {
      async function withDonaPicked() {
        storedProjects = [DONA_PROJECT]
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        expect(await screen.findByText(/DONA has no locations yet/)).toBeInTheDocument()
      }

      async function withDonaPickedWithLocations() {
        storedProjects = [DONA_PROJECT]
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        await screen.findByLabelText('Location')
      }

      it('by hand: needs the location id and its coordinates, and is kept for that research project', async () => {
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
        expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled()

        await userEvent.type(screen.getByLabelText('Location id'), 'DONA_02')
        expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled() // no coordinates yet
        await userEvent.type(screen.getByLabelText('Latitude'), '37.1')
        await userEvent.type(screen.getByLabelText('Longitude'), '-6.4')
        await userEvent.type(screen.getByLabelText('Coordinate uncertainty (m)'), '100')
        expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled()
        await userEvent.click(screen.getByRole('button', { name: 'Save location' }))

        expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', {
          location_id: 'DONA_02', name: null, timezone: null, ignore_dst: true, latitude: 37.1, longitude: -6.4, coordinate_uncertainty: 100, trapper_pk: null,
        })
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled()) // picked
        expect(screen.getByLabelText('Location')).toHaveValue('DONA_02')
      })

      it('by hand: the coordinates must lie within the standard\'s ranges', async () => {
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
        await userEvent.type(screen.getByLabelText('Location id'), 'DONA_02')
        await userEvent.type(screen.getByLabelText('Latitude'), '95')
        await userEvent.type(screen.getByLabelText('Longitude'), '-181')
        await userEvent.type(screen.getByLabelText('Coordinate uncertainty (m)'), '0')

        expect(screen.getByText('Must be between -90 and 90.')).toBeInTheDocument()
        expect(screen.getByText('Must be between -180 and 180.')).toBeInTheDocument()
        expect(screen.getByText('Must be a whole number, 1 or more.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled()
      })

      it('by hand: a timezone, if given, has to be a known one', async () => {
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
        await userEvent.type(screen.getByLabelText('Location id'), 'DONA_02')
        await userEvent.type(screen.getByLabelText('Timezone (IANA)'), 'Mars/Olympus')

        expect(screen.getByText('Not a known IANA timezone (e.g. Europe/Madrid).')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled()
      })

      it('from Trapper: starts from the Trapper project the research project came from, and a ticked location is simply added', async () => {
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /from trapper/i }))

        await waitFor(() => expect(mockedApi.trapperLocations).toHaveBeenCalledWith(expect.anything(), 2)) // DONA's Trapper pk
        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA_01 — Doñana site 1' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 location$/i }))

        await waitFor(() => expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('DONA', {
          location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid', ignore_dst: null, trapper_pk: 5,
          latitude: 37, longitude: -6.5, coordinate_uncertainty: null, // its coordinates come from Trapper
        }))
        expect(screen.queryByRole('button', { name: 'Save location' })).not.toBeInTheDocument() // no form
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled()) // added and picked
        expect(screen.getByLabelText('Location')).toHaveValue('DONA_01 — Doñana site 1')
      })

      it('from Trapper: a location already kept is just picked, not added again', async () => {
        storedLocations = { DONA: [DONA_01] }
        await withDonaPickedWithLocations()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /from trapper/i }))
        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA_01 — Doñana site 1' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 location$/i }))

        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled())
        expect(mockedApi.saveLocalLocation).not.toHaveBeenCalled()
      })

      it('one kept without coordinates cannot be used, since a deployment needs them', async () => {
        storedProjects = [DONA_PROJECT]
        storedLocations = { DONA: [{ ...DONA_01, latitude: null, longitude: null }] }
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        await userEvent.click(await screen.findByLabelText('Location'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA_01 — Doñana site 1' }))

        expect(screen.getByText(/DONA_01 has no coordinates/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeDisabled()
      })

      it('from Trapper: one with no coordinates there is not added, and says why', async () => {
        mockedApi.trapperLocations.mockResolvedValue({ results: [{ pk: 8, location_id: 'DONA_08', name: 'No point', timezone: 'Europe/Madrid', latitude: null, longitude: null }] })
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /from trapper/i }))
        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA_08 — No point' }))
        await userEvent.click(screen.getByRole('button', { name: /add 1 location$/i }))

        expect(await screen.findByText(/has no coordinates in Trapper/)).toBeInTheDocument()
        expect(mockedApi.saveLocalLocation).not.toHaveBeenCalled()
      })

      it('from Trapper: several locations can be ticked — all are added, and the first is the one picked', async () => {
        mockedApi.trapperLocations.mockResolvedValue({ results: [
          { pk: 5, location_id: 'DONA_01', name: 'Doñana site 1', timezone: 'Europe/Madrid', latitude: 37.0, longitude: -6.5 },
          { pk: 6, location_id: 'DONA_02', name: 'Doñana site 2', timezone: 'Europe/Madrid', latitude: 37.1, longitude: -6.4 },
          { pk: 8, location_id: 'DONA_08', name: 'No point', timezone: 'Europe/Madrid', latitude: null, longitude: null },
        ] })
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /from trapper/i }))

        await userEvent.click(await screen.findByRole('checkbox', { name: 'DONA_02 — Doñana site 2' }))
        await userEvent.click(screen.getByRole('checkbox', { name: 'DONA_01 — Doñana site 1' }))
        await userEvent.click(screen.getByRole('checkbox', { name: 'DONA_08 — No point' }))
        await userEvent.click(screen.getByRole('button', { name: /add 3 locations/i }))

        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled())
        expect(storedLocations.DONA.map((l) => l.location_id)).toEqual(['DONA_02', 'DONA_01']) // the one without coordinates is left out
        expect(screen.getByLabelText('Location')).toHaveValue('DONA_02 — Doñana site 2') // the first ticked, marked by default
        expect(screen.getByText(/DONA_08.*has no coordinates in Trapper/)).toBeInTheDocument()
      })

      it('says so when the location id is already used', async () => {
        mockedApi.saveLocalLocation.mockRejectedValue(new Error('The location \'DONA_01\' already exists in DONA.'))
        await withDonaPicked()
        await userEvent.click(screen.getByRole('button', { name: /add a new location/i }))
        await userEvent.click(screen.getByRole('button', { name: /by hand/i }))
        await userEvent.type(screen.getByLabelText('Location id'), 'DONA_01')
        await userEvent.type(screen.getByLabelText('Latitude'), '37')
        await userEvent.type(screen.getByLabelText('Longitude'), '-6.5')
        await userEvent.click(screen.getByRole('button', { name: 'Save location' }))

        expect(await screen.findByText("The location 'DONA_01' already exists in DONA.")).toBeInTheDocument()
      })

      it('changing the research project drops the location that was picked', async () => {
        storedProjects = [DONA_PROJECT, { ...DONA_PROJECT, name: 'Sierra Nevada', acronym: 'SINE' }]
        storedLocations = { DONA: [DONA_01] }
        await goToOriginStep()
        await userEvent.click(await screen.findByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
        await userEvent.click(await screen.findByLabelText('Location'))
        await userEvent.click(await screen.findByRole('option', { name: 'DONA_01 — Doñana site 1' }))
        expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeEnabled()

        await userEvent.click(screen.getByLabelText('Research project'))
        await userEvent.click(await screen.findByRole('option', { name: 'SINE — Sierra Nevada' }))

        expect(screen.getByRole('button', { name: /Continue to the dates/ })).toBeDisabled()
      })
    })
  })

  it('the scan only counts the images: their dates and camera are read when the details are asked for', async () => {
    await goToOriginStep()
    expect(mockedApi.scanFolder).toHaveBeenCalledTimes(1)
    expect(mockedApi.guessDetails).not.toHaveBeenCalled() // not through the scan, the validation or the origin

    await addProjectByHand()
    await addLocationByHand()
    await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))
    await screen.findByText('When was it collected?')
    await waitFor(() => expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10'))

    expect(mockedApi.guessDetails).toHaveBeenCalledTimes(1)
    expect(mockedApi.guessDetails).toHaveBeenCalledWith(expect.stringContaining('/'))
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
    expect(screen.getByText(/Filled in from the images' photo data/)).toBeInTheDocument()
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

  it('asks for the deployment details right after the origin', async () => {
    await goToNewDetailsStep()

    expect(screen.getByLabelText('Deployment Id')).toHaveValue('')
    // Date fields are calendar pickers ("datetime-local"), which drop zero seconds.
    expect(screen.getByLabelText('Start')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
    expect(screen.getByLabelText('End')).toHaveValue('2024-11-04T14:28')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-09-05T08:00' } })
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-05T08:00')

    await fillRequiredDetails()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  describe('the revision and the deployment id', () => {
    it('asks for the revision first, and builds the id from it and the location', async () => {
      await goToNewDetailsStep()
      const fields = screen.getAllByRole('spinbutton')
      expect(fields[0]).toBe(screen.getByLabelText('Revision')) // the first thing asked

      expect(screen.getByLabelText('Deployment Id')).toHaveAttribute('readonly')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('')

      await userEvent.type(screen.getByLabelText('Revision'), '3')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0003-DONA_01')

      await userEvent.clear(screen.getByLabelText('Revision'))
      await userEvent.type(screen.getByLabelText('Revision'), '1025')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R1025-DONA_01')
    })

    it('needs a whole revision number from 1 to 9999', async () => {
      await goToNewDetailsStep()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // no revision yet

      for (const bad of ['0', '-2', '1.5', '10000']) {
        await userEvent.clear(screen.getByLabelText('Revision'))
        await userEvent.type(screen.getByLabelText('Revision'), bad)
        expect(screen.getByText('Must be a whole number between 1 and 9999.')).toBeInTheDocument()
        expect(screen.getByLabelText('Deployment Id')).toHaveValue('')
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      }

      await userEvent.clear(screen.getByLabelText('Revision'))
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('does not ask for the location again — it was chosen in the previous step', async () => {
      await goToNewDetailsStep()

      expect(screen.queryByLabelText('Location id (optional)')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Location name (optional)')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument() // it has its coordinates
      expect(screen.queryByLabelText('Coordinate uncertainty (m)')).not.toBeInTheDocument()

      await userEvent.type(screen.getByLabelText('Revision'), '3')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0003-DONA_01')
    })

    it('has the location\'s coordinates from the previous step: the details never ask for them', async () => {
      await goToNewDetailsStep()

      expect(screen.queryByText('Coordinates', { selector: 'h5' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Longitude')).not.toBeInTheDocument()
    })
  })

  it('needs the revision before leaving the details', async () => {
    await goToNewDetailsStep()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Revision'), '1')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('checks in the form itself that the deployment starts before it ends', async () => {
    await goToNewDetailsStep()
    await fillRequiredDetails()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-09-01T08:00' } }) // before the start, 2024-09-04
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-09-04T13:10' } }) // the same moment
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2024-12-01T08:00' } })
    expect(screen.queryByText('Must be later than the start date.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('checks the start date against the end date too, once the timezone is known', async () => {
    await goToNewDetailsStep()
    await fillRequiredDetails()

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-12-31T00:00' } }) // after the end, 2024-11-04
    expect(screen.getByText('Must be later than the start date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('gives both dates the timezone designator of the location', async () => {
    await goToNewDetailsStep()
    expect(screen.getAllByText(/Saved as 2024-(09-04T13:10:00\+02:00|11-04T14:28:00\+01:00)/)).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-12-01T08:00' } })
    expect(screen.getByText('Saved as 2024-12-01T08:00:00+01:00')).toBeInTheDocument() // winter offset
  })

  it('shows the standard\'s description under each field', async () => {
    await goToNewDetailsStep()

    expect(screen.queryByText(/Formatted as an ISO 8601 string with timezone designator/)).not.toBeInTheDocument() // the dates say no more than their labels
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(3) // revision, start, end (the location came with its coordinates)
  })

  it('keeps the deployment details when going back to them from the postvalidation', async () => {
    await goToPostvalidation('1')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByLabelText('Deployment Id')).toHaveValue('R0001-DONA_01')
    expect(screen.getByLabelText('Revision')).toHaveValue(1)
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
  })

  it('fills the folder path from the native browser', async () => {
    mockedApi.browseFolder.mockResolvedValue({ path: '/home/me/deployments/DONA_01' })
    render(<ImportDeploymentPage />)

    await userEvent.click(screen.getByRole('button', { name: /^browse/i }))

    expect(mockedApi.browseFolder).toHaveBeenCalled()
    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/deployments/DONA_01')
  })

  it('shows an error when no native folder dialog is available', async () => {
    mockedApi.browseFolder.mockRejectedValue(new Error('No folder dialog tool found — install zenity (GNOME) or kdialog (KDE).'))
    render(<ImportDeploymentPage />)

    await userEvent.click(screen.getByRole('button', { name: /^browse/i }))

    expect(await screen.findByText(/install zenity/i)).toBeInTheDocument()
  })

  it('shows a scan error without crashing', async () => {
    mockedApi.scanFolder.mockRejectedValue(new Error('Not a folder: /nope'))
    render(<ImportDeploymentPage />)
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

      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['corrupted', 'sequence', 'structure', 'camera', 'exif', 'duplicates'])
      expect(await screen.findByText(/1 corrupted image\(s\): IMG_0002\.jpg/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('only runs the checks that are not skipped', async () => {
      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, subdirectories: [] })
      await goToValidateStep()

      for (const check of [0, 1, 3, 4, 5]) await chooseStrictness(check, 'Skip')
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['structure'])
    })

    describe('the EXIF fields the wizard needs', () => {
      const COMPLETE = { date: { count: 0, examples: [] }, camera_model: { count: 0, examples: [] }, camera_id: { count: 0, examples: [] } }

      it('is one of the checks, on by default (it warns)', async () => {
        await goToValidateStep()

        expect(strictness('Required photo data', 'Warn')).toBeChecked()
      })

      it('passes when every image has its capture date, camera model and camera id', async () => {
        mockedApi.validateImages.mockResolvedValue({ checked_count: 3, exif_missing: COMPLETE })
        await goToValidateStep()
        await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

        expect(await screen.findByText('✔ Every image has its capture date, camera model and camera id.')).toBeInTheDocument()
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

        expect(await screen.findByText('✔ No duplicate images.')).toBeInTheDocument()
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
        expect(screen.getAllByRole('radiogroup')).toHaveLength(6)
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

    it('blocks continuing until a required check has been run and passes', async () => {
      mockedApi.validateImages.mockResolvedValue({
        checked_count: 2, corrupted: [{ path: 'IMG_0002.jpg', error: 'cannot identify image file' }],
      })
      await goToValidateStep()

      await chooseStrictness(0, 'Must pass')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(/1 corrupted image\(s\)/)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      mockedApi.validateImages.mockResolvedValue({ checked_count: 2, corrupted: [] })
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText('✔ No corrupted images.')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('a check that must pass stops blocking once it is skipped or only warns', async () => {
      await goToValidateStep()
      await chooseStrictness(0, 'Must pass')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      await chooseStrictness(0, 'Skip') // the check no longer runs, and no longer has to pass
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      expect(strictness('Corrupted images', 'Skip')).toBeChecked()

      await chooseStrictness(0, 'Must pass')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      await chooseStrictness(0, 'Warn')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
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
    await openSection(/^Camera/)
    await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
    await userEvent.type(screen.getByLabelText('Depth below the surface (m)'), '4.8')
    await openSection(/^Site/)
    await userEvent.click(screen.getByRole('button', { name: 'Road underpass' }))
    await userEvent.click(screen.getByLabelText('Bait was used'))
    await userEvent.click(screen.getByLabelText('Photo dates may be wrong'))
    await openSection(/^Grouping and notes/)
    await userEvent.type(screen.getByLabelText('Groups'), 'season:winter 2020{Enter}')
    await userEvent.type(screen.getByLabelText('Groups'), 'grid:A1{Enter}')
    await userEvent.type(screen.getByLabelText('Tags'), 'forest{Enter}')
    await userEvent.type(screen.getByLabelText('Tags'), 'north{Enter}')

    expect(screen.getByText('season:winter 2020')).toBeInTheDocument()
    await openSection(/^Site/)
    expect(screen.getByRole('button', { name: 'Road underpass' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Bait was used')).toBeChecked()
    expect(screen.getByLabelText('Photo dates may be wrong')).toBeChecked()
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

      for (const label of DEPLOYMENT_CHECK_LABELS) expect(strictness(label, 'Warn')).toBeChecked()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(9)
      expect(screen.queryByLabelText(/Start date before end date/)).not.toBeInTheDocument() // that one is checked in the details form itself
    })

    it('has a section to choose the checks and another for how they went, under the summary of the details and the title', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...NAMES_OK })
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
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...NAMES_OK })
      await goToPostvalidation('1')

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01',
        expect.objectContaining({ deployment_id: 'R0001-DONA_01', location_id: 'DONA_01' }),
        ['deployment_id', 'collection_prefix', 'collection_name', 'location', 'time_range', 'camera', 'image_count', 'sequence_count', 'sequence_length'],
        {
          collectionName: null, expectedLocationId: 'DONA_01', toleranceHours: 1, // the collection is the one the id names
          researchProjectId: 'DONA', // whose collections hold the previous revisions
          statistics: {
            sequence_gap_seconds: 60, min_revisions: 2, method: 'median',
            image_count_tolerance: 50, sequence_count_tolerance: 50, sequence_length_tolerance: 50,
          },
        },
      ))
    })

    it('shows what each naming check found, and why one failed', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        checked_count: 2, ...NAMES_OK,
        location: { ok: false, message: "The deployment id's location is 'DONA_02', but the location chosen is DONA_01." },
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText("✔ 'R0001-DONA_01' is a valid deployment id.")).toBeInTheDocument()
      expect(screen.getByText('✔ The deployment id starts with its collection, R0001.')).toBeInTheDocument()
      expect(screen.getByText("⚠ The deployment id's location is 'DONA_02', but the location chosen is DONA_01.")).toBeInTheDocument()
    })

    it('is customized in the settings: the wizard has no tolerance field and runs with the one of the settings, one hour by default', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2 })
      await goToPostvalidation()
      expect(screen.queryByLabelText('Tolerance (hours)')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ toleranceHours: 1 }),
      ))
    })

    it('says which images fell outside the dates, by which rule, and what was expected', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
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
      expect(screen.getByText(/2024-09-04 12:00:00, the first image should be at the start \(2024-09-04 10:00:00 ± 1h\)/)).toBeInTheDocument()
    })

    it('says so when the first image is at the start, the last at the end and the rest in between', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 3, tolerance_hours: 2, out_of_range: [] })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/The first image is at the start, the last at the end and the rest in between \(± 2 h\)/)).toBeInTheDocument()
    })

    it('still reports the camera checks', async () => {
      mockedApi.validateDeployment.mockResolvedValue({
        checked_count: 2, camera_mismatches: [{ path: 'b.jpg', detected: 'Bushnell Trophy Cam' }], camera_models_found: ['Bushnell Trophy Cam', 'Reconyx HC600'],
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/1 image\(s\) with a different camera model than declared: b\.jpg/)).toBeInTheDocument()
      expect(screen.getByText(/2 distinct camera models found/)).toBeInTheDocument()
    })

    it('lets the user continue when nothing is required, even before running the checks', async () => {
      await goToPostvalidation()

      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it.each<[string, number, Partial<DeploymentCheckResult>, Partial<DeploymentCheckResult>, RegExp]>([
      ['a naming check', 0, { ...NAMES_OK, deployment_id: { ok: false, message: 'bad id' } }, NAMES_OK, /bad id/],
      ['the image dates', 4, { out_of_range: [{ path: 'a.jpg', date: '2024-08-01T00:00:00', rule: 'first', expected: 'x' }] }, { out_of_range: [] }, /1 image\(s\) outside/],
    ])('blocks continuing until %s, when required, has been run and passes', async (_name, index, failing, passing, message) => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...failing })
      await goToPostvalidation()
      await chooseDeploymentStrictness(index, 'Must pass')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // not run yet

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(message)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // run, but it failed

      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, ...passing })
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
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2 })
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
        checked_count: 310,
        image_count: stat(),
        sequence_count: stat({ ok: false, message: 'The number of sequences (900) is not similar to the median of the 3 previous revision(s) of DONA_01 (allowed 50–150, ±50%).' }),
        sequence_length: stat({ skipped: true, ok: true, message: 'Not enough history to judge the length of the sequences: 1 previous revision(s) of DONA_01 found, 2 needed.', history: [] }),
      })
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))

      expect(await screen.findByText(/✔ The number of images \(310\) is similar to the median of the 3 previous/)).toBeInTheDocument()
      expect(screen.getAllByText('R0001: 300 · R0002: 330 · R0003: 270.5')).toHaveLength(2) // under the images and under the sequences checks
      expect(screen.getByText(/⚠ The number of sequences \(900\) is not similar/)).toBeInTheDocument()
      expect(screen.getByText(/ℹ Not enough history to judge the length of the sequences: 1 previous revision/)).toBeInTheDocument()
    })

    it.each([['image_count', 6], ['sequence_count', 7], ['sequence_length', 8]] as const)('blocks continuing when %s is required and not similar', async (key, index) => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, [key]: stat({ ok: false, message: 'it is not similar' }) })
      await goToPostvalidation()
      await chooseDeploymentStrictness(index, 'Must pass')
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await screen.findByText(/it is not similar/)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, [key]: stat() })
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    })

    it('a check skipped for lack of history does not block, even when required', async () => {
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2, image_count: stat({ skipped: true, ok: true, message: 'Not enough history', history: [] }) })
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
      }))
    })

    it('cannot go on when the log cannot be written, and says why', async () => {
      mockedApi.writeTimestampLog.mockRejectedValue(new Error('R0001_FileTimestampLog.csv is missing the columns: EndDate, EndTime.'))
      await goToNewDetailsStep()
      await fillRequiredDetails()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('R0001_FileTimestampLog.csv is missing the columns: EndDate, EndTime.')).toBeInTheDocument()
      expect(screen.getByText('When was it collected?')).toBeInTheDocument() // still on the details
      expect(screen.queryByText('Postvalidation', { selector: 'h4' })).not.toBeInTheDocument()

      mockedApi.writeTimestampLog.mockResolvedValue({ path: 'x/R0001_FileTimestampLog.csv', action: 'added', rows: 1, collection: 'R0001' })
      await userEvent.click(screen.getByRole('button', { name: 'Continue' })) // tried again once it is fixed
      expect(await screen.findByText('Check the details', { selector: 'h4' })).toBeInTheDocument()
    })

    it('is written again, with the new dates, when the details are changed and left again', async () => {
      await goToPostvalidation()
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
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
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Required photo data' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Folder structure (subfolders)' })).not.toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'How strict: Corrupted images' })).toBeInTheDocument()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(3)

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      expect(mockedApi.validateImages).toHaveBeenCalledWith('/home/me/deployments/DONA_01', ['corrupted', 'sequence', 'camera'])
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
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // not run yet
      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())

      mockedApi.getSettings.mockResolvedValue(settings({ corrupted: false }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Where was it taken?')
      await userEvent.click(screen.getByRole('button', { name: 'Back' })) // read again on entering the step

      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'How strict: Corrupted images' })).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('reads the settings again when the validate step is shown, as they can change meanwhile', async () => {
      await goToValidateStep()
      expect(screen.getByRole('radiogroup', { name: 'How strict: Duplicate images (same content)' })).toBeInTheDocument()

      mockedApi.getSettings.mockResolvedValue(settings({ duplicates: false }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(screen.queryByLabelText('Duplicate images (same content)')).not.toBeInTheDocument())
    })

    it('shows every check when the settings cannot be read', async () => {
      mockedApi.getSettings.mockRejectedValue(new Error('Backend not reachable'))
      await goToValidateStep()

      expect(screen.getAllByRole('radiogroup')).toHaveLength(6)
    })

    it('shows only the postvalidation checks turned on, and runs only those', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, { location: false, camera: false, collection_prefix: false }))
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2 })
      await goToPostvalidation()

      await waitFor(() => expect(screen.queryByRole('radiogroup', { name: "How strict: Deployment id's location is the one you chose" })).not.toBeInTheDocument())
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Camera consistency' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'How strict: Deployment id starts with its collection' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(6) // the three naming and dates checks, and the three statistical ones

      await userEvent.click(screen.getByRole('button', { name: 'Run checks' }))
      await waitFor(() => expect(mockedApi.validateDeployment).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), ['deployment_id', 'collection_name', 'time_range', 'image_count', 'sequence_count', 'sequence_length'], expect.anything(),
      ))
    })

    it('says there is nothing to run when every postvalidation check is turned off, and lets the user go on', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, {
        deployment_id: false, collection_prefix: false, collection_name: false, location: false, time_range: false, camera: false,
        image_count: false, sequence_count: false, sequence_length: false,
      }))
      await goToPostvalidation()

      expect(await screen.findByText(/Every postvalidation check is turned off in the settings/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run checks' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Tolerance (hours)')).not.toBeInTheDocument() // only the dates check uses it
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('runs with the tolerance of the setting', async () => {
      mockedApi.getSettings.mockResolvedValue(settings({}, { tolerance_hours: 2.5 }))
      mockedApi.validateDeployment.mockResolvedValue({ checked_count: 2 })
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

      expect(screen.getByText(/as the camera.s local time in/)).toHaveTextContent('Europe/Madrid, ignoring summer time, converted to UTC')

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
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
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
      expect(screen.queryByRole('button', { name: 'Upload to Trapper' })).not.toBeInTheDocument() // not before it is imported
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
      await userEvent.click(screen.getByRole('button', { name: 'Upload to Trapper' }))
      expect(onUpload).toHaveBeenCalledWith({ researchProjectId: 'DONA', collection: 'R0001' })
    })

    it('has no upload button when the page cannot go anywhere', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01`, processed: 1, skipped: 0 })
      })
      await goToPostvalidation()
      await advanceToPreprocessing()
      await runPreprocessingAndContinue()
      await userEvent.click(await screen.findByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
      expect(screen.queryByRole('button', { name: 'Upload to Trapper' })).not.toBeInTheDocument()
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
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

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
      await screen.findByText('Preprocessing steps', { selector: 'h4' })

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
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))
      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: true, resize: true, metadata: false }))
    })

    it('can run with every optional step off', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      for (const name of ['Rename the images', 'Resize the images', 'Add metadata']) await userEvent.click(screen.getByRole('checkbox', { name }))

      await runPreprocessingAndContinue()
      expect(await screen.findByText('Save to your collection', { selector: 'h4' })).toBeInTheDocument()
      expect(mockedApi.preprocess.mock.calls[0][4]).toEqual(expect.objectContaining({ rename: false, resize: false, metadata: false }))
    })

    it('cannot be saved before the preprocessing has run, and has to run it again after going back', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      expect(screen.getByRole('button', { name: 'Save deployment' })).toBeDisabled()
      expect(screen.getByText('Prepare the images to save.')).toBeInTheDocument()

      await runPreprocessingAndContinue()
      await screen.findByText('Save to your collection', { selector: 'h4' })

      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Preprocessing steps', { selector: 'h4' })
      expect(screen.getByRole('button', { name: 'Save deployment' })).toBeDisabled() // what it did may be stale now
    })

    it('has Preprocessing steps to choose what to do and Preprocessing results for how it went, with Prepare again in its header', async () => {
      await goToPostvalidation()
      await advanceToPreprocessing()
      expect(screen.getByText('Preprocessing steps', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getByText('Preprocessing results', { selector: 'h4' })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1) // the one at the bottom, until it has run

      await userEvent.click(screen.getByRole('button', { name: 'Start preparing' }))
      await screen.findByRole('button', { name: 'Prepare again' })

      expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1) // now beside Continue, and Prepare again is in the step's header
      expect(screen.getByRole('button', { name: 'Back' }).parentElement).toContainElement(screen.getByRole('button', { name: 'Continue to save' }))
      expect(screen.getByRole('button', { name: 'Prepare again' }).closest('section')).toContainElement(screen.getByText(/Preprocessing results/, { selector: 'h4' }))
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

      expect(screen.getByText(/Saving consolidates the deployment/)).toBeInTheDocument()
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

      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
      const deployment = expect.objectContaining({ deployment_id: 'R0001-DONA_01', location_id: 'DONA_01', latitude: 37, longitude: -6.5 })
      expect(mockedApi.preprocess).toHaveBeenCalledWith(
        '/home/me/deployments/DONA_01', COLLECTIONS_DIR, 'R0001', deployment, expect.objectContaining({ rename: true, resize: true, metadata: true }), expect.any(Function),
      )
      expect(mockedApi.consolidate).toHaveBeenCalledWith('/home/me/deployments/DONA_01', COLLECTIONS_DIR, deployment, expect.any(Function))
      expect(screen.getByText(/R0001-DONA_01 is now in your local collection/)).toBeInTheDocument()
      expect(mockedApi.discardSession).toHaveBeenCalledWith('task-1')
      expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
    })

    it('reuses a collection that already exists, keeping the name it has', async () => {
      mockedApi.collectionPath.mockResolvedValue({ path: COLLECTIONS_DIR, collection: 'R0001', exists: true, name: 'R0001_winter' })
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.preprocess).toHaveBeenCalledWith('/home/me/deployments/DONA_01', COLLECTIONS_DIR, null, expect.anything(), expect.anything(), expect.any(Function))
    })

    it('never talks to Trapper to import: registering there is a later phase', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      await screen.findByText(/Deployment saved/)
      expect(mockedApi.importDeployment).not.toHaveBeenCalled()
    })

    it('sends the Camtrap DP fields through to the import call', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep('1', async () => {
        await openMoreDetails()
        await openSection(/^Camera/)
        await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
        await userEvent.click(screen.getByRole('button', { name: 'Below the surface' }))
    await userEvent.type(screen.getByLabelText('Depth below the surface (m)'), '4.8')
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
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

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
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))

      expect(await screen.findByText('No space left on device')).toBeInTheDocument()
      expect(mockedApi.discardSession).not.toHaveBeenCalled()
    })

    it('starts over from the folder once it is done', async () => {
      mockedApi.consolidate.mockImplementation(async (_src, _dir, _dep, onEvent) => {
        onEvent({ type: 'done', dest_dir: `${COLLECTIONS_DIR}/R0001-DONA_01` })
      })
      await walkToImportStep()
      await screen.findAllByText(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      await userEvent.click(screen.getByRole('button', { name: 'Save deployment' }))
      await screen.findByText(/Deployment saved/)

      await userEvent.click(screen.getByRole('button', { name: 'Start over' }))

      expect(await screen.findByLabelText('Folder')).toHaveValue('')
    })
  })

  it('resumes a run that had got as far as the details: it picks up at the origin, with the details kept', async () => {
    storedProjects = [DONA_PROJECT]
    storedLocations = { DONA: [DONA_01] }
    render(<ImportDeploymentPage resumeSession={DETAILED_SESSION} />)

    expect(await screen.findByText('Where was it taken?')).toBeInTheDocument() // the origin isn't saved in a session
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    await userEvent.click(await screen.findByLabelText('Location'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA_01 — Doñana site 1' }))
    await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))

    await screen.findByText('When was it collected?')
    expect(screen.getByLabelText('Revision')).toHaveValue(1)
    expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0001-DONA_01')
    expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(mockedApi.saveScan).not.toHaveBeenCalled()
  })

  it('resumes a scanned-only session and lets the user pick up from the origin step', async () => {
    render(<ImportDeploymentPage resumeSession={SESSION} />)
    expect(await screen.findByText('Where was it taken?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Folder')).toHaveValue('/home/me/DONA_01')
  })

  describe('a deployment that already exists', () => {
    it('says so as soon as the revision gives an id that is already kept, and where it is', async () => {
      mockedApi.existingDeployments.mockImplementation(async (_rp, ids) => ({
        results: Object.fromEntries(ids.map((id) => [id, `${COLLECTIONS_DIR}/${id}`])),
      }))
      await goToNewDetailsStep()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument() // no revision yet, so no id to look for
      await userEvent.type(screen.getByLabelText('Revision'), '1')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('This deployment already exists')
      expect(alert).toHaveTextContent(`${COLLECTIONS_DIR}/R0001-DONA_01`)
      expect(mockedApi.existingDeployments).toHaveBeenCalledWith('DONA', ['R0001-DONA_01'])
    })

    it('says nothing when it is a new deployment, and again as the revision changes', async () => {
      mockedApi.existingDeployments.mockImplementation(async (_rp, ids) => ({
        results: Object.fromEntries(ids.map((id) => [id, id === 'R0001-DONA_01' ? `${COLLECTIONS_DIR}/${id}` : null])),
      }))
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '1')
      await screen.findByRole('alert')

      await userEvent.clear(screen.getByLabelText('Revision'))
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
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

    it('is looked for by the location and the revision, and fills in the period, the site and the notes', async () => {
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await userEvent.click(screen.getByRole('button', { name: 'Import info from Epicollect5' }))

      expect(await screen.findByText(/Filled in from “DONA_01 · sent 1 Oct 2026”/)).toBeInTheDocument()
      expect(mockedApi.epicollectEntries).toHaveBeenCalledWith('DONA_01', 2)
      expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10')
      expect(screen.getByLabelText('End')).toHaveValue('2024-10-12T07:02')
      await openMoreDetails()
      await openSection(/^Site/)
      expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
      expect(screen.getByLabelText('Set up by')).toHaveValue('Ana')
      await openSection(/^Grouping and notes/)
      expect(screen.getByLabelText('Comments')).toHaveValue('Near the pond')
    })

    it('says that Epicollect5 has the details, once there is an entry for the location and the revision', async () => {
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      expect(await screen.findByText(/Epicollect5 has an entry for/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Import from Epicollect5' }))
      expect(await screen.findByText(/Filled in from “DONA_01 · sent 1 Oct 2026”/)).toBeInTheDocument()
      expect(screen.queryByText(/Epicollect5 has an entry for/)).not.toBeInTheDocument()
    })

    it('warns when Epicollect5 has no entry for the location and the revision', async () => {
      mockedApi.epicollectEntries.mockResolvedValue({ results: [] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      expect(await screen.findByText(/Epicollect5 has no entry for/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Import from Epicollect5' })).not.toBeInTheDocument()
    })

    it('warns with what Epicollect5 or the settings say when it can not be read, and goes to its settings', async () => {
      const onOpenSettings = vi.fn()
      pageProps = { onOpenSettings }
      mockedApi.epicollectEntries.mockRejectedValue(new Error('The location id is not mapped yet'))
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      expect(await screen.findByText(/The location id is not mapped yet/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Open Epicollect5 settings' }))
      expect(onOpenSettings).toHaveBeenCalledWith('epicollect')
    })

    it('is neither offered nor looked at while the settings turn it off', async () => {
      mockedApi.getSettings.mockResolvedValue(APP_SETTINGS)
      mockedApi.epicollectEntries.mockResolvedValue({ results: [ENTRY] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await screen.findByLabelText('Deployment Id')
      expect(screen.queryByRole('button', { name: 'Import info from Epicollect5' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Epicollect5 has/)).not.toBeInTheDocument()
      expect(mockedApi.epicollectEntries).not.toHaveBeenCalled()
    })

    it('needs a valid revision', async () => {
      await goToNewDetailsStep()
      expect(screen.getByRole('button', { name: 'Import info from Epicollect5' })).toBeDisabled()
    })

    it('says when there is no entry, and what Epicollect5 or the settings say when it fails', async () => {
      mockedApi.epicollectEntries.mockResolvedValue({ results: [] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await userEvent.click(screen.getByRole('button', { name: 'Import info from Epicollect5' }))
      expect(await screen.findByText('There is no entry for DONA_01, revision 2, in the Epicollect5 project.')).toBeInTheDocument()

      mockedApi.epicollectEntries.mockRejectedValueOnce(new Error('The location id is not mapped yet'))
      await userEvent.click(screen.getByRole('button', { name: 'Import info from Epicollect5' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('The location id is not mapped yet')
    })

    it('takes the newest when the location has several entries for the revision', async () => {
      mockedApi.epicollectEntries.mockResolvedValue({ results: [
        { ...ENTRY, uuid: 'new', fields: { ...ENTRY.fields, habitat: 'Marsh' } },
        { ...ENTRY, uuid: 'old', created_at: '2026-09-01T10:00:00.000Z' },
      ] })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await userEvent.click(screen.getByRole('button', { name: 'Import info from Epicollect5' }))

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

    it('offers to fill the form in from it, once the revision gives a deployment that has one', async () => {
      mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0002-DONA_01': PREVIOUS } })
      await goToNewDetailsStep()
      expect(screen.queryByRole('button', { name: /Copy from revision/ })).not.toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('Revision'), '2')

      expect(await screen.findByText(/Revision 1 is on file for/)).toBeInTheDocument()
      expect(mockedApi.previousDeployments).toHaveBeenCalledWith('DONA', ['R0002-DONA_01'])
      expect(screen.getByRole('button', { name: 'Copy from revision 1' })).toBeInTheDocument()
    })

    it('fills in everything but the start and end dates, the id and the location', async () => {
      mockedApi.previousDeployments.mockResolvedValue({ results: { 'R0002-DONA_01': PREVIOUS } })
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2024-09-04T13:10:00' } })
      await userEvent.click(await screen.findByRole('button', { name: 'Copy from revision 1' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Filled in from R0001-DONA_01')
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0002-DONA_01')
      expect(screen.getByLabelText('Start')).toHaveValue('2024-09-04T13:10') // the new revision's own
      await openMoreDetails()
      await openSection(/^Site/)
      expect(screen.getByLabelText('Habitat')).toHaveValue('Pine forest')
      expect(screen.getByLabelText('Set up by')).toHaveValue('Ana')
      expect(screen.getByLabelText('Photo dates may be wrong')).not.toBeChecked() // belongs to that revision
      await openSection(/^Grouping and notes/)
      expect(screen.getByLabelText('Comments')).toHaveValue('Near the pond')
      expect(screen.getByText('forest')).toBeInTheDocument()
      await openSection(/^Camera/)
      expect(screen.getByLabelText('Height above the ground (m)')).toHaveValue(1.2)
    })

    it('does not offer it when there is no earlier revision', async () => {
      await goToNewDetailsStep()
      await userEvent.type(screen.getByLabelText('Revision'), '2')
      await waitFor(() => expect(mockedApi.previousDeployments).toHaveBeenCalled())

      expect(screen.queryByText(/is on file for/)).not.toBeInTheDocument()
    })
  })

  describe('the revision and the location’s time settings', () => {
    it('starts the revision as the next one expected for the location, says so, and keeps what is typed', async () => {
      mockedApi.nextRevision.mockResolvedValue({ last: 2, next: 3 })
      await goToNewDetailsStep()

      await waitFor(() => expect(screen.getByLabelText('Revision')).toHaveValue(3))
      expect(mockedApi.nextRevision).toHaveBeenCalledWith('DONA', 'DONA_01')
      expect(screen.getByText(/the next after R0002, the latest kept for this location/)).toBeInTheDocument()
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0003-DONA_01')

      fireEvent.change(screen.getByLabelText('Revision'), { target: { value: '5' } })
      expect(screen.getByLabelText('Deployment Id')).toHaveValue('R0005-DONA_01')
      expect(screen.queryByText(/the latest kept for this location/)).not.toBeInTheDocument()
    })

    it('starts at 1 when the location has no revision kept', async () => {
      mockedApi.nextRevision.mockResolvedValue({ last: null, next: 1 })
      await goToNewDetailsStep()

      await waitFor(() => expect(screen.getByLabelText('Revision')).toHaveValue(1))
      expect(screen.getByText(/the first revision of this location/)).toBeInTheDocument()
    })

    it('leaves the revision to be typed when none can be suggested', async () => {
      await goToNewDetailsStep() // nextRevision rejects
      expect(screen.getByLabelText('Revision')).toHaveValue(null)
    })

    it('does not ask the timezone nor summer time: it says them, as the location’s, before asking for the details', async () => {
      await goToNewDetailsStep()

      expect(screen.queryByLabelText('Timezone (IANA)')).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: /ignore summer time/ })).not.toBeInTheDocument()
      expect(screen.getByText(/Tell us when the images of/)).toBeInTheDocument()
      expect(screen.getByText(/which has no daylight saving time/)).toBeInTheDocument()
      for (const bold of ['DONA_01', 'Europe/Madrid']) expect(screen.getAllByText(bold).some((el) => el.tagName === 'STRONG')).toBe(true)
    })

    it('says when the location has no timezone', async () => {
      await goToOriginStep()
      await addProjectByHand()
      await addLocationByHand('DONA_01', 'Doñana site 1', '')
      await userEvent.click(screen.getByRole('button', { name: /Continue to the dates/ }))
      await screen.findByText('When was it collected?')

      expect(screen.getByText(/has no timezone, and a deployment needs it/)).toBeInTheDocument()
    })
  })
})
