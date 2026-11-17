import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VisitsPage, { detailsErrors, addName, namesOf, removeName, sessionName, sessionOf, toStored, visitErrors, batteryStatus, cardStatus, onlyNotes, withoutWhatIsNotAsked, fieldsFor, installationErrors, wallClockAgo, visitSummary } from './VisitsPage'
import { APP_SETTINGS } from '../test/fixtures'
import { api } from '../api'
import { EMPTY_DEPLOYMENT_FIELDS, EMPTY_RESEARCH_PROJECT } from '../types'
import type { ClosedVisit, StoredVisit } from '../types'

vi.mock('../api', () => ({ api: { markNotVisited: vi.fn(), listResearchProjects: vi.fn(), trapperGetConfig: vi.fn(), listLocalLocations: vi.fn(), saveLocalLocation: vi.fn(), listVisits: vi.fn(), saveVisit: vi.fn(), importVisitsCsv: vi.fn(), visitsCsvColumns: vi.fn(), epicollectVisitsDownload: vi.fn(), closedVisits: vi.fn(), getSettings: vi.fn(), updateLocalLocation: vi.fn(), setFieldItemStatus: vi.fn(), reportUrl: (id: string, format: string) => `/api/reports/${id}/download?format=${format}` } }))
const mockedApi = vi.mocked(api, true)

const location = (location_id: string, over: Record<string, unknown> = {}) => ({
  location_id, name: null, timezone: null, latitude: null, longitude: null, coordinate_uncertainty: null, trapper_pk: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Tatra', acronym: 'TATR', trapper_pk: 2 }] })
  mockedApi.trapperGetConfig.mockRejectedValue(new Error('no account in this test'))
  mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: {
      ...APP_SETTINGS.FIELDWORK, trappers: [{ username: 'ana.perez', name: 'Ana Pérez', affiliation: 'University of Huelva' }, { username: 'luis', name: 'Luis', affiliation: null }],
      sd_cards: [{ label: 'A13', brand: 'SanDisk', capacity: '64 GB', in_service: null, research_project: 'TATR' }, { label: 'B2', brand: null, capacity: null, in_service: null, research_project: 'TATR' }],
      cameras: [{ label: 'P800HG08192031', camera_id: 'P800HG08192031', camera_model: 'Reconyx-PC800', in_service: null, research_project: 'TATR' }, { label: 'X1', camera_id: 'X1', camera_model: null, in_service: null, research_project: 'TATR' }],
    } })
  mockedApi.listVisits.mockResolvedValue({ results: [] })
  mockedApi.saveVisit.mockImplementation(async (_rp, v) => v)
  mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001', { name: 'Ridge', latitude: 49.2, longitude: 20.1 })] })
})

// A visit cannot be changed once it is created: pressing Review the visit goes to the last step, which asks again — a visit that is not complete is not asked about.
async function addVisit() {
  await userEvent.click(screen.getByRole('button', { name: 'Review the visit' }))
  const yes = screen.queryByRole('button', { name: 'Yes, add the visit' })
  if (yes) await userEvent.click(yes)
}

async function chooseByHand() {
  render(<VisitsPage onBack={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
}

async function pickWhere(site = 'TATR_0001') {
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
  await userEvent.click(await screen.findByLabelText('Location'))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${site}`) }))
}

// Typing in a date-and-time input does not work in jsdom, so the value is set.
async function pickWhen(when = '2026-10-02T08:14:05') {
  fireEvent.change(await screen.findByLabelText(/date and time of the visit/i), { target: { value: when } })
  await userEvent.click(screen.getByRole('button', { name: 'Continue to the visit' }))
}

// What was done at the visit decides what the rest of the form asks. The form works the actions out from answers, so each action is the answer that gives it:
// a Revision is seeing the camera in good state, an Installation next to it is replacing it (where no camera is known, the visit is an Installation already), a
// Desinstallation is taking it away, and Stolen is the camera not being there.
async function pickAction(name: string) {
  const radio = (n: string | RegExp) => screen.queryByRole('radio', { name: n })
  switch (name) {
    case 'Revision':
      await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))
      await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
      return
    case 'Installation': {
      const replace = radio('Replace it with another')
      if (replace) await userEvent.click(replace)
      return
    }
    case 'Desinstallation': await userEvent.click(await screen.findByRole('radio', { name: 'Take it away' })); return
    case 'Stolen': await userEvent.click(await screen.findByRole('radio', { name: 'No, it was stolen' })); return
    default: throw new Error(`No answer gives the action ${name}`)
  }
}

// A trapper is searched in the compact table of the trappers of the settings and picked from its list.
async function pickTrapper(name: string) {
  const search = await screen.findByLabelText('Filter the trappers')
  await userEvent.clear(search)
  await userEvent.type(search, name)
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }))
}

// The cards of the details are closed until opened.
async function openSection(name: string) {
  const header = within(screen.getByRole('region', { name })).getAllByRole('button')[0]
  if (header.getAttribute('aria-expanded') !== 'true') await userEvent.click(header)
}

// An Installation also asks how the camera is mounted and aimed, its delay and whether there is bait.
async function fillInstallation() {
  await openSection('Camera'); await openSection('Site')
  fireEvent.change(screen.getByLabelText('Height above the ground (m)'), { target: { value: '0.5' } })
  fireEvent.change(screen.getByLabelText('Camera delay (s)'), { target: { value: '30' } })
  fireEvent.change(screen.getByLabelText('Tilt'), { target: { value: '-10' } })
  fireEvent.change(screen.getByLabelText('Heading'), { target: { value: '90' } })
}

// The camera of the visit is one of the settings, and what is collected at a revision is counted.
async function pickCamera() {
  await openSection('Camera')
  await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
  await userEvent.click(await screen.findByRole('option', { name: 'P800HG08192031 — Reconyx-PC800' }))
}
/** The SD card section of a revision: the photos collected (when a number is given) and the card that is left — a revision asks for both. */
async function typePhotos(count = '1620') {
  await openSection('SD card')
  if (count) {
    await userEvent.type(screen.getByLabelText('Photos on the card collected'), count)
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    await userEvent.click(await screen.findByRole('option', { name: 'B2' }))
  }
}

// a visit that put the camera P800HG08192031 up, with the card A13: what a later visit sees there
const withCamera = () => mockedApi.listVisits.mockResolvedValue({ results: [toStored({ ...BLANK, session: 'R0001', when: '2026-01-10T09:00:00', site: 'TATR_0001', actions: ['Installation'], sd: 'A13', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'P800HG08192031' } })] })

describe('VisitsPage', () => {
  it('has By hand, the form of the field flow', async () => {
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))

    expect(await screen.findByText('Where was the visit?')).toBeInTheDocument()
    expect(screen.getByText('Who went, and when?')).toBeInTheDocument()
    expect(screen.getAllByText('By hand').length).toBeGreaterThan(0)
  })

  it('offers only the sources the settings say are used', async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, EPICOLLECTCSV: { ...APP_SETTINGS.EPICOLLECTCSV, enabled: false } })
    render(<VisitsPage onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^by hand/i })).toBeEnabled()
    await waitFor(() => expect(screen.queryByRole('button', { name: /^wildintel epicollect csv/i })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /custom csv/i })).toBeEnabled() // always offered
  })

  it('first asks where the visits come from: by hand, Custom CSV, WildINTEL Epicollect CSV', () => {
    render(<VisitsPage onBack={vi.fn()} />)

    const titles = within(screen.getByText('Where do the visits come from?').closest('section')!).getAllByRole('button').map((b) => b.textContent ?? '')
    expect(titles.findIndex((t) => /^By hand/.test(t))).toBe(0)
    expect(titles.findIndex((t) => /^Custom CSV/.test(t))).toBe(1)
    expect(titles.findIndex((t) => /^WildINTEL Epicollect CSV/.test(t))).toBe(2)
    expect(titles.some((t) => /Legacy/.test(t))).toBe(false) // the old form is not a source any more
  })

  it('marks the step done with the source chosen, and lets it be changed', async () => {
    await chooseByHand()
    expect(screen.getByText('Completed')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /edit where do the visits come from/i }))
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
    expect(screen.queryByText('Where was the visit?')).not.toBeInTheDocument()
  })

  it('asks where the visit was before anything else, the rest locked until then', async () => {
    await chooseByHand()

    expect(screen.getByText('Where was the visit?')).toBeInTheDocument()
    expect(screen.getByLabelText('Research project')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Locked' }).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Filter the trappers')).not.toBeInTheDocument()
  })

  it('asks for the location of the research project picked, and opens the form with it as the site and its coordinates', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()

    expect(mockedApi.listLocalLocations).toHaveBeenCalledWith('TATR')
    expect(screen.getByText(/TATR · TATR_0001, Ridge/)).toBeInTheDocument()
    expect(screen.getByText('Who went, and when?')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Actions' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Filter the trappers')).toBeInTheDocument()
    await pickWhen()
    await pickAction('Revision')
    await openSection('SD card'); await openSection('Camera'); await openSection('Site'); await openSection('Grouping and notes')
    for (const label of ['SD card left in the camera', 'Photos on the card collected', 'Comments']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.queryByRole('textbox', { name: 'Site' })).not.toBeInTheDocument() // the site is the location
    expect(screen.queryByLabelText('Session')).not.toBeInTheDocument() // the session is worked out
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument()
  })

  it('says on the header of a section how many required fields are still empty, and not only how many are filled', async () => {
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')

    const sd = () => within(screen.getByRole('region', { name: 'SD card' }))
    expect(sd().getByText(/required missing/)).toHaveTextContent(/1 required missing/)   // the card left is required and not picked yet
    await openSection('SD card')
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    await userEvent.click(await screen.findByRole('option', { name: 'A13 — SanDisk 64 GB' }))
    expect(sd().queryByText(/required missing/)).not.toBeInTheDocument()
  })

  it('keeps the SD card in a section of its own, shut until it is opened, with what is filled in on its header, and the card and the batteries as the one code of the datasheet', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Revision')

    expect(screen.queryByLabelText('SD card left in the camera')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'SD card' })).getByText(/^1 of 3 filled/)).toBeInTheDocument() // the card starts OK

    await openSection('SD card')
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    expect(screen.queryByRole('option', { name: 'A13 — SanDisk 64 GB' })).not.toBeInTheDocument() // the one this revision collects cannot be left
    await userEvent.click(await screen.findByRole('option', { name: 'B2' }))
    await userEvent.type(screen.getByLabelText('Photos on the card collected'), '1620')
    await userEvent.click(screen.getByRole('switch', { name: 'Card OK' }))
    expect(screen.getByRole('switch', { name: 'Card OK' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByLabelText('Photos on the card collected')).not.toBeInTheDocument() // with the card full the photos are not counted: their number is not asked
    expect(within(screen.getByRole('region', { name: 'SD card' })).getByText(/^2 of 2 filled/)).toBeInTheDocument()
  })

  it('keeps whether the date and time of the camera were right in the Camera section, counted with the rest of it', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()
    await pickWhen()

    await pickAction('Revision')
    const camera = () => within(screen.getByRole('region', { name: 'Camera' }))
    expect(camera().getByText(/^3 of 10 filled/)).toBeInTheDocument() // the state of the camera, the batteries and the date and time of the camera start filled in: not the camera, which the visit before says
    await openSection('Camera')
    await userEvent.click(screen.getByRole('switch', { name: 'Date and time of the camera OK' }))
    expect(screen.getByRole('switch', { name: 'Date and time of the camera OK' })).toHaveAttribute('aria-checked', 'false')
  })

  it('tags the fields that are Camtrap DP\'s, and only those', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Revision')
    await openSection('Camera'); await openSection('Site'); await openSection('SD card')

    // height, tilt, heading, delay and detection distance — the camera itself is not asked at a revision: it is the one that was there
    expect(within(screen.getByRole('region', { name: 'Camera' })).getAllByText('Camtrap DP')).toHaveLength(5)
    // the aim of the camera, habitat, bait and the photo dates
    expect(within(screen.getByRole('region', { name: 'Site' })).getAllByText('Camtrap DP')).toHaveLength(4)
    expect(within(screen.getByRole('region', { name: 'SD card' })).queryByText('Camtrap DP')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Who/ })).toHaveTextContent('Camtrap DP')                  // who went is the deployment's setupBy
    expect(screen.getByText('Date and time of the visit').closest('span')).toHaveTextContent('Camtrap DP')   // when it was is where the deployment starts and ends
    expect(screen.queryByLabelText('Which camera will be installed?')).not.toBeInTheDocument()
    expect(document.body).toHaveTextContent('According to the visit R0001, the camera P800HG08192031 is installed at TATR_0001.')   // which camera it is of is not asked: the visit before says it
  })

  it('picks the SD card of the visit from those of the settings, with a way to add a new one there', async () => {
    const onOpenSettings = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await openSection('SD card')

    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['A13 — SanDisk 64 GB', 'B2'])
    await userEvent.click(screen.getByRole('option', { name: 'B2' }))
    expect(screen.getByLabelText('SD card left in the camera')).toHaveValue('B2')

    await userEvent.click(screen.getByRole('button', { name: 'go to Settings › SD cards' }))
    expect(onOpenSettings).toHaveBeenCalledWith('sdcards')
  })

  it('does not ask for the camera model and id: one of the cameras of the settings is picked, with a way to add a new one there', async () => {
    const onOpenSettings = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await openSection('Camera')

    expect(screen.queryByLabelText('Camera model')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['P800HG08192031 — Reconyx-PC800', 'X1'])
    await userEvent.click(screen.getByRole('option', { name: 'P800HG08192031 — Reconyx-PC800' }))
    expect(screen.getByLabelText('Which camera will be installed?')).toHaveValue('P800HG08192031 — Reconyx-PC800')
    expect(screen.getByText('Model: Reconyx-PC800')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'go to Settings › Cameras' }))
    expect(onOpenSettings).toHaveBeenCalledWith('cameras')
  })

  it('says to create a location in the settings, instead of offering to add one here', async () => {
    const onOpenSettings = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))

    expect(await screen.findByLabelText('Location')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a new location/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'go to Settings › Locations' }))
    expect(onOpenSettings).toHaveBeenCalledWith('locations')
  })

  it('answers what is yes or no with a switch, on when all is well, and saves what is off as the code of the datasheet', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Revision')
    await typePhotos(); await openSection('Camera')
    for (const name of ['Card OK', 'Batteries OK', 'Date and time of the camera OK']) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true')
    }

    await userEvent.click(screen.getByRole('switch', { name: 'Batteries OK' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Date and time of the camera OK' }))
    await addVisit()

    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalled())
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ battery_status: 'NoBatteries', date_time_ok: 'No' })
  })

  it('asks for what is missing and adds nothing', async () => {
    await chooseByHand()
    await pickWhere()
    await pickWhen()

    await addVisit()   // where no camera is known the visit installs one, and nothing of it is filled in
    expect(screen.getByRole('alert')).toHaveTextContent('The visit cannot be added yet')
    expect(screen.queryByText(/visits? added/)).not.toBeInTheDocument()
    expect(mockedApi.saveVisit).not.toHaveBeenCalled()
  })

  it('opens by hand on the research project and the location of a planned visit that is to be created', async () => {
    render(<VisitsPage onBack={vi.fn()} start={{ researchProjectId: 'TATR', site: 'TATR_0001' }} />)

    expect(await screen.findByText(/TATR · TATR_0001, Ridge/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Filter the trappers')).toBeInTheDocument()   // the next step is open: nothing is asked again
  })

  it('warns that a revision cannot start while the one before is not finished, and offers to mark the locations still to be visited as not visited', async () => {
    const first = toStored({ ...BLANK, session: 'R0001', when: '2026-06-10T09:00:00', site: 'TATR_0001', actions: ['Installation'] })
    mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: [first].filter((v) => !site || v.location_id === site) }))
    mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001', { name: 'Ridge' }), location('TATR_0002')] })
    mockedApi.markNotVisited.mockImplementation(async () => {
      mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: [first, { ...first, location_id: 'TATR_0002', status: 'Not revised', actions: [] as StoredVisit['actions'] }].filter((v) => !site || v.location_id === site) }))
      return { session: 'R0001', marked: ['TATR_0002'] }
    })
    await chooseByHand()
    await pickWhere()

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('R0002 cannot start: R0001 is not finished')
    expect(warning).toHaveTextContent('Do you want to mark as not visited the locations of R0001 that still are not visited: TATR_0002?')
    expect(screen.queryByLabelText('Filter the trappers')).not.toBeInTheDocument()   // the visit cannot go on: the next step stays locked
    await userEvent.click(screen.getByRole('button', { name: 'Mark them as not visited' }))

    // it is asked again, saying the revision will be consolidated: nothing is marked yet
    expect(mockedApi.markNotVisited).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('the visit book of R0001 will be consolidated and it cannot be modified')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockedApi.markNotVisited).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Mark them as not visited' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, mark them as not visited' }))

    expect(mockedApi.markNotVisited).toHaveBeenCalledWith('TATR', 'R0001')
    expect(await screen.findByLabelText('Filter the trappers')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('adds a visit with the session worked out from the visits kept, and asks for the location and the time of the next keeping the project and who went', async () => {
    withCamera()
    // the camera is at TATR_0001 (so a Revision is seen there); TATR_0002 has none known
    const earlier = (date: string, session: string, site: string) => toStored({ ...BLANK, session, when: `${date}T09:00:00`, site, actions: ['Installation'], ...(site === 'TATR_0001' ? { sd: 'A13', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'P800HG08192031' } } : {}) })
    const kept = ['TATR_0001', 'TATR_0002'].flatMap((site) => [earlier('2026-06-10', 'R0001', site), earlier('2026-08-05', 'R0002', site)])
    mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: kept.filter((v) => !site || v.location_id === site) })) // the visits of the site asked for
    mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001', { name: 'Ridge', latitude: 49.2, longitude: 20.1 }), location('TATR_0002')] })
    await chooseByHand()
    await pickWhere()

    await pickTrapper('Ana Pérez')
    await pickWhen()
    await pickAction('Revision')
    await typePhotos()
    await addVisit()

    expect(await screen.findByText('1 visit added')).toBeInTheDocument()
    expect(mockedApi.saveVisit).toHaveBeenCalledWith('TATR', expect.objectContaining({
      location_id: 'TATR_0001', session: 'R0003', date: '2026-10-02', time: '08:14:05', actions: ['Revision'], trappers: 'Ana Pérez', camera_id: null, camera_model: null, latitude: 49.2, longitude: 20.1,   // a revision does not say which camera: the visit before does
    }))
    // the steps stay as they were kept: locked, each with its summary, and with no form to change them
    expect(screen.queryByRole('button', { name: 'Edit Where was the visit?' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter the trappers')).not.toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Locked' }).length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText(/TATR · TATR_0001/)).toBeInTheDocument()
    expect(screen.getByText(/Ana Pérez · 2 Oct 2026, 08:14/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add another visit' }))
    expect(screen.queryByText('1 visit added')).not.toBeInTheDocument()   // what was added is out of the way when another visit is made
    expect(screen.getAllByRole('img', { name: 'Locked' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Research project')).toHaveValue('TATR — Tatra')

    await pickWhere('TATR_0002')
    expect(within(screen.getByRole('list', { name: 'Who went' })).getByText('Ana Pérez')).toBeInTheDocument()
    await pickWhen('2026-10-03T09:00:00')
    await openSection('Camera')
    expect(screen.getByLabelText('Which camera will be installed?')).toHaveValue('')
    expect(screen.getByLabelText('Which camera will be installed?')).toBeEnabled()   // the visit installs one where none is known: its camera is asked, as the first time
  })

  it('offers only the cameras and the SD cards of the research project: each belongs to one, and the ones of none are not offered', async () => {
    const card = (label: string, research_project: string | null) => ({ label, brand: null, capacity: null, in_service: null, research_project })
    const camera = (camera_id: string, research_project: string | null) => ({ label: camera_id, camera_id, camera_model: null, in_service: null, research_project })
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: {
      ...APP_SETTINGS.FIELDWORK, sd_cards: [card('T1', 'TATR'), card('D1', 'DONA'), card('F1', null)], cameras: [camera('CT', 'tatr'), camera('CD', 'DONA'), camera('CF', null)],
    } })
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await openSection('SD card')
    await openSection('Camera')

    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['T1'])
    await userEvent.click(screen.getByRole('option', { name: 'T1' }))
    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['CT'])
  })

  it('does not offer the cameras, the SD cards and the trappers that are no longer in use', async () => {
    const card = (label: string, status: 'active' | 'ready' | 'archived') => ({ label, brand: null, capacity: null, in_service: null, research_project: 'TATR', status })
    const camera = (camera_id: string, status: 'active' | 'ready' | 'archived') => ({ label: camera_id, camera_id, camera_model: null, in_service: null, research_project: 'TATR', status })
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: {
      trappers: [{ username: 'ana.perez', name: 'Ana Pérez', affiliation: null, status: 'active' }, { username: 'luis', name: 'Luis', affiliation: null, status: 'inactive' }],
      sd_cards: [card('T1', 'active'), card('T2', 'archived'), card('T3', 'ready')], cameras: [camera('CT', 'active'), camera('CS', 'archived'), camera('CR', 'ready')],
    } })
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await openSection('SD card')
    await openSection('Camera')

    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['T3'])  // only the ready one: the active one is in a camera, and the archived one is out of use
    await userEvent.click(screen.getByRole('option', { name: 'T3' }))
    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['CT', 'CR'])
  })

  it('will not keep a camera put up while it is installed elsewhere, nor a card left while it is in another camera, and says so as soon as they are picked', async () => {
    const elsewhere = toStored({ ...BLANK, session: 'R0001', when: '2026-06-10T09:00:00', site: 'TATR_0002', actions: ['Installation'], sd: 'A13', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'X1' } })
    mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: [elsewhere].filter((v) => !site || v.location_id === site) })) // the visits of the site asked for
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await pickCamera()
    await typePhotos('') // opens the SD card section
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    expect(screen.queryByRole('option', { name: 'A13 — SanDisk 64 GB' })).not.toBeInTheDocument() // it is in the camera at another site: not offered
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    await userEvent.click(await screen.findByRole('option', { name: 'X1' }))
    expect(screen.getByText('Camera X1 is installed at TATR_0002 (since 2026-06-10): it has to be uninstalled there before it is installed here.')).toBeInTheDocument()
    await addVisit()
    expect(mockedApi.saveVisit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    await userEvent.click(await screen.findByRole('option', { name: 'P800HG08192031 — Reconyx-PC800' }))
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    await userEvent.click(await screen.findByRole('option', { name: 'B2' }))
    await fillInstallation()
    await addVisit()
    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalled())
  })

  describe('the visit a new one closes', () => {
    const left = toStored({ ...BLANK, session: 'R0001', when: '2026-06-10T09:00:00', site: 'TATR_0001', actions: ['Installation'], sd: 'A13', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'P800HG08192031' } })
    const closing = (over: Partial<StoredVisit> = {}): ClosedVisit => ({ visit: left, end: { ...left, session: 'R0002', date: '2026-10-02', time: '08:14:05', actions: ['Revision'], ...over } })

    async function addRevision(onImportImages = vi.fn()) {
      mockedApi.listVisits.mockResolvedValue({ results: [left] })
      render(<VisitsPage onBack={vi.fn()} onImportImages={onImportImages} />)
      await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
      await pickWhere()
      await pickWhen()
      await pickAction('Revision')
      await typePhotos()
      await addVisit()
      await screen.findByText('1 visit added')
      return onImportImages
    }

    it('offers a link to import the images of the visit whose card it collected', async () => {
    withCamera()
      mockedApi.closedVisits.mockResolvedValue({ results: [closing()] })
      const onImportImages = await addRevision()

      await userEvent.click(await screen.findByRole('button', { name: 'Create the deployment of the visit R0001 to TATR_0001' }))

      expect(screen.getByText(/is closed: its card was collected on 2 Oct 2026/)).toBeInTheDocument()
      expect(screen.getByRole('status')).not.toHaveTextContent('is closed') // a card of its own, not part of the success one
      expect(onImportImages).toHaveBeenCalledWith({ researchProjectId: 'TATR', visit: left })
    })

    it('offers nothing when the visit closed none', async () => {
    withCamera()
      mockedApi.closedVisits.mockResolvedValue({ results: [closing({ time: '07:00:00' })] }) // the closed visit is one that came before
      await addRevision()

      await waitFor(() => expect(mockedApi.closedVisits).toHaveBeenCalled())
      expect(screen.queryByRole('button', { name: /Import the images/ })).not.toBeInTheDocument()
    })
  })

  it('asks for the camera details at an Installation, and for the GPS of the note to compare it with the location', async () => {
    mockedApi.listVisits.mockResolvedValue({ results: [] })
    await chooseByHand()
    await pickWhere()
    expect(await screen.findByLabelText('Latitude', { selector: '#visit-latitude' })).toHaveValue(49.2) // it starts as the location's
    expect(screen.getByLabelText('Longitude', { selector: '#visit-longitude' })).toHaveValue(20.1)
    expect(screen.getByText(/0 m from TATR_0001: the location matches/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Latitude', { selector: '#visit-latitude' }), { target: { value: '49.3' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/from TATR_0001, more than 1 km: check that the location is the right one/)

    await pickWhen()
    await pickAction('Installation')
    await openSection('Camera'); await openSection('Site')
    for (const label of ['Camera delay (s)', 'Tilt', 'Heading']) expect(screen.getByText(label).closest('div')!.parentElement!.textContent).toMatch(/Required/)
    expect(screen.getByRole('switch', { name: 'Bait was used' })).toHaveAttribute('aria-checked', 'false') // off is "no"
    expect(screen.getByText('Bait was used').closest('div')!.parentElement!.textContent).toMatch(/Required/)
    expect(Object.keys(installationErrors({ ...BLANK, actions: ['Installation'] }))).toEqual(['camera_height', 'camera_interval', 'camera_tilt', 'camera_heading'])
    expect(installationErrors({ ...BLANK, actions: ['Revision'] })).toEqual({})
  })

  it('asks, once a visit is added, whether to add another, go back to the visits menu or to the main menu', async () => {
    const onBack = vi.fn()
    const onMainMenu = vi.fn()
    mockedApi.listVisits.mockResolvedValue({ results: [] })
    render(<VisitsPage onBack={onBack} onMainMenu={onMainMenu} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await pickCamera()
    await typePhotos('')
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    await userEvent.click(await screen.findByRole('option', { name: 'B2' }))
    await fillInstallation()
    await addVisit()

    const next = within(await screen.findByRole('group', { name: 'What next' }))
    expect(next.getByText('Do you want to add another visit?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review the visit' })).not.toBeInTheDocument()
    expect(next.getByRole('button', { name: 'Add another visit' })).toBeInTheDocument()
    await userEvent.click(next.getByRole('button', { name: 'Back to the main menu' }))
    expect(onMainMenu).toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
    await userEvent.click(next.getByRole('button', { name: 'Back to the visits menu' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('asks for the camera of the next visit too when it is an Installation again: the form comes back as the first time', async () => {
    mockedApi.listVisits.mockResolvedValue({ results: [] })
    mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001', { name: 'Ridge', latitude: 49.2, longitude: 20.1 }), location('TATR_0002')] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    await pickWhen()
    await pickAction('Installation')
    await pickCamera()
    await openSection('SD card')
    await userEvent.click(screen.getByLabelText('SD card left in the camera'))
    await userEvent.click(await screen.findByRole('option', { name: 'B2' }))
    await fillInstallation()
    await addVisit()
    await userEvent.click(await screen.findByRole('button', { name: 'Add another visit' }))
    expect(screen.queryByText('1 visit added')).not.toBeInTheDocument()   // what was added is out of the way

    await pickWhere('TATR_0002')
    await pickWhen('2026-10-03T09:00:00')
    await openSection('Camera'); await openSection('SD card')
    expect(screen.getByLabelText('Which camera will be installed?')).toBeEnabled()
    expect(screen.getByLabelText('SD card left in the camera')).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Which camera will be installed?'))
    expect(await screen.findByRole('option', { name: 'X1' })).toBeInTheDocument()   // a camera can be picked
  })

  it('offers to add a new location by hand, and picks it as the site of the visit', async () => {
    mockedApi.saveLocalLocation.mockImplementation(async (_rp, l) => l)
    await chooseByHand()
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))

    await userEvent.click(await screen.findByRole('button', { name: /add a new location/i }))
    // the first "By hand" is the source of the visits, kept (hidden) in the step above
    await userEvent.click(screen.getAllByRole('button', { name: /by hand/i }).at(-1)!)
    await userEvent.type(screen.getByLabelText(/location id/i), 'TATR_0007')
    await userEvent.type(screen.getByLabelText(/^latitude/i), '37.1')
    await userEvent.type(screen.getByLabelText(/^longitude/i), '-3.4')
    await userEvent.click(screen.getByRole('button', { name: 'Save location' }))

    expect(mockedApi.saveLocalLocation).toHaveBeenCalledWith('TATR', expect.objectContaining({ location_id: 'TATR_0007', latitude: 37.1, longitude: -3.4 }))
    expect(await screen.findByText(/TATR · TATR_0007/)).toBeInTheDocument()
  })

  it('says which revision the visit is of: the first when none is kept', async () => {
    await chooseByHand()
    await pickWhere()

    expect(await screen.findByText(/Revision R0001\b/)).toBeInTheDocument()
    expect(mockedApi.listVisits).toHaveBeenCalledWith('TATR', 'TATR_0001')
  })

  it('counts the visits kept to the location, and says when the last was', async () => {
    const kept = (date: string, action: 'Installation' | 'Revision') => ({ ...toStored({ ...BLANK, session: 'R0011', when: `${date}T09:00:00`, site: 'TATR_0001', actions: [action] }) })
    mockedApi.listVisits.mockResolvedValue({ results: [kept('2026-08-05', 'Revision'), kept('2026-06-10', 'Installation')] })
    await chooseByHand()
    await pickWhere()

    expect(await screen.findByText(/Revision R0012 — the last was on 5 Aug 2026, \d\d:\d\d \(Revision\)/)).toBeInTheDocument()
  })

  it('puts the visit in the latest revision when the location is still planned in it, and in the next one — which the others must finish — when it is not', async () => {
    const at = (site: string, session: string, date: string) => toStored({ ...BLANK, session, when: `${date}T09:00:00`, site, actions: [session === 'R0001' ? 'Installation' : 'Revision'] })
    const kept = [at('TATR_0001', 'R0001', '2026-06-10'), at('TATR_0002', 'R0001', '2026-06-10'), at('TATR_0002', 'R0002', '2026-08-05')]
    mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: kept.filter((v) => !site || v.location_id === site) }))
    mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001'), location('TATR_0002')] })
    await chooseByHand()
    await pickWhere()

    expect(await screen.findByText(/Revision R0002\b/)).toBeInTheDocument()   // TATR_0001 has no visit in R0002, the latest: it is still planned there
  })

  it('keeps nothing and says why when the visit cannot be saved', async () => {
    withCamera()
    mockedApi.saveVisit.mockRejectedValue(new Error('The research project is not there.'))
    await chooseByHand()
    await pickWhere()

    await pickWhen()
    await pickAction('Revision')
    await typePhotos()
    await addVisit()

    expect(await screen.findByText('The research project is not there.')).toBeInTheDocument()
    expect(screen.queryByText(/visits? added/)).not.toBeInTheDocument()
  })

  it('asks who went from the trappers of the settings, picked as a research project is, and puts back whoever is taken out', async () => {
    await chooseByHand()
    await pickWhere()

    await pickTrapper('Ana Pérez')
    await pickTrapper('Luis')
    const who = within(screen.getByRole('list', { name: 'Who went' }))
    expect(who.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ana Pérez×', 'Luis×'])

    // the ones on the visit are marked in the list
    await userEvent.clear(screen.getByLabelText('Filter the trappers'))
    await userEvent.type(screen.getByLabelText('Filter the trappers'), 'Luis')
    expect(await screen.findByRole('option', { name: /Luis/ })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Ana Pérez' }))
    expect(who.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Luis×'])
    await userEvent.clear(screen.getByLabelText('Filter the trappers'))
    await userEvent.type(screen.getByLabelText('Filter the trappers'), 'Ana')
    expect(await screen.findByRole('option', { name: /Ana Pérez/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('does not ask who set the camera up again: it is who went, which was asked first', async () => {
    await chooseByHand()
    await pickWhere()
    await pickTrapper('Ana Pérez')
    await pickWhen()
    await pickAction('Installation')
    await openSection('Camera'); await openSection('Site')
    expect(screen.queryByLabelText('Set up by')).not.toBeInTheDocument()
  })

  it('asks the browser for the current position, and puts it in the GPS coordinates — or says why it could not', async () => {
    const getCurrentPosition = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
    await chooseByHand()
    await pickWhere()
    await pickTrapper('Ana Pérez')

    getCurrentPosition.mockImplementationOnce((ok: (p: unknown) => void) => ok({ coords: { latitude: 37.0123456, longitude: -6.4412 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my current position' }))
    expect(screen.getByLabelText('Latitude', { selector: '#visit-latitude' })).toHaveValue(37.012346)
    expect(screen.getByLabelText('Longitude', { selector: '#visit-longitude' })).toHaveValue(-6.4412)

    getCurrentPosition.mockImplementationOnce((_: unknown, fail: (e: unknown) => void) => fail({ code: 1, PERMISSION_DENIED: 1 }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my current position' }))
    expect(await screen.findByText(/was not allowed to tell where you are/)).toBeInTheDocument()
  })

  it('has buttons to put the time of the visit as now or a few minutes ago, on the clock of the location', async () => {
    expect(wallClockAgo('UTC', 0, new Date('2026-11-03T22:48:05Z'))).toBe('2026-11-03T22:48:05')
    expect(wallClockAgo('UTC', 15, new Date('2026-11-03T22:48:05Z'))).toBe('2026-11-03T22:33:05')
    expect(wallClockAgo('Europe/Madrid', 5, new Date('2026-11-03T22:48:05Z'))).toBe('2026-11-03T23:43:05') // one hour on in winter
    expect(wallClockAgo('UTC', 10, new Date('2026-01-01T00:05:00Z'))).toBe('2025-12-31T23:55:00')   // across midnight and the year

    await chooseByHand()
    await pickWhere()
    await userEvent.click(screen.getByRole('button', { name: '10 min ago' }))
    const filled = (screen.getByLabelText(/date and time of the visit/i) as HTMLInputElement).value
    expect(filled).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/)   // the input drops the seconds when they are 00
    const was = new Date(filled.slice(0, 19)).getTime()   // the location of the tests has no timezone: it is the clock of the browser
    expect(Math.abs(Date.now() - 10 * 60000 - was)).toBeLessThan(60000)
  })

  it('summarises a visit in groups: the visit, the hardware and where the camera is — only what was filled in', () => {
    const v = { ...BLANK, site: 'TATR_0001', trappers: 'Ana Pérez', when: '2026-11-03T22:19:48', actions: ['Installation'], sd: '2', card: 'OK', batteries: 'OK', dateTimeOK: 'Yes', latitude: '37.0258', longitude: '-6.4527',
      details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'RE5699252753', camera_model: 'Reconyx-PC800', setup_by: 'Ana Pérez', camera_height: 1, camera_interval: 20, camera_tilt: 0, camera_heading: 45, bait_use: false } }
    const summary = visitSummary(v as never, 'R0001', 'Europe/Madrid')
    const of = (rows: { label: string; value: string }[]) => Object.fromEntries(rows.map((r) => [r.label, r.value]))
    const section = (key: string) => of(summary.sections.find((x) => x.key === key)!.rows)
    expect(of(summary.overview)).toEqual({ Location: 'TATR_0001', 'Revision code': 'R0001', When: '3 Nov 2026, 22:19 (Europe/Madrid)', 'Who went': 'Ana Pérez', 'Action performed': 'Installation' })
    expect(summary.gps).toBe('37.0258, -6.4527')
    expect(section('camera')).toMatchObject({ 'Camera id': 'RE5699252753', 'Camera model': 'Reconyx-PC800', 'Mounting height': '1 m', Tilt: '0°', Heading: '45°', 'Camera trigger delay': '20 s' })
    expect(section('sd')).toMatchObject({ 'SD card left': '2' })
    expect(section('site')).toEqual({ 'Bait used': 'No' })
    expect(section('notes')).toEqual({})
  })

  it('says there are no trappers yet when the settings have none, and has a button to add a new one there', async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: APP_SETTINGS.FIELDWORK })
    const onOpenSettings = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()

    expect(await screen.findByText('The settings have no trappers yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'go to Settings › Trappers' }))
    expect(onOpenSettings).toHaveBeenCalledWith('trappers')
  })

  it('points to the settings to create a new trapper under the list also when there are some', async () => {
    const onOpenSettings = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()

    await userEvent.click(await screen.findByRole('button', { name: 'go to Settings › Trappers' }))
    expect(onOpenSettings).toHaveBeenCalledWith('trappers')
  })

  it('reads the trappers again when the settings are closed', async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: APP_SETTINGS.FIELDWORK })
    const view = render(<VisitsPage onBack={vi.fn()} onOpenSettings={vi.fn()} settingsOpen />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    expect(await screen.findByText('The settings have no trappers yet.')).toBeInTheDocument()

    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, FIELDWORK: { ...APP_SETTINGS.FIELDWORK, trappers: [{ username: 'marta', name: 'Marta', affiliation: null }] } })
    view.rerender(<VisitsPage onBack={vi.fn()} onOpenSettings={vi.fn()} settingsOpen={false} />)

    await userEvent.type(await screen.findByLabelText('Filter the trappers'), 'Mar')
    expect(await screen.findByRole('option', { name: /Marta/ })).toBeInTheDocument()
  })

  it('goes back to the menu', async () => {
    const onBack = vi.fn()
    render(<VisitsPage onBack={onBack} />)

    await userEvent.click(screen.getByRole('button', { name: /^back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})

const BLANK = { trappers: '', session: '', when: '', site: '', actions: [] as string[], status: '', card: '' as const, batteries: '' as const, numPhotos: '', sd: '', dateTimeOK: '', longitude: '', latitude: '', details: EMPTY_DEPLOYMENT_FIELDS }

describe('batteryStatus and cardStatus', () => {
  it('say each of the batteries and the card in a field of its own — nothing when it is not said', () => {
    expect([batteryStatus(''), batteryStatus('OK'), batteryStatus('Missing')]).toEqual([null, 'OK', 'NoBatteries'])
    expect([cardStatus(''), cardStatus('OK'), cardStatus('Full')]).toEqual([null, 'OK', 'CardFull'])
  })
})

describe('sessionOf', () => {
  it('numbers the visits to a location from R0001', () => {
    expect(sessionOf(0)).toBe('R0001')
    expect(sessionOf(2)).toBe('R0003')
    expect(sessionOf(12)).toBe('R0013')
  })
})

describe('sessionName', () => {
  it('writes the session as the datasheet does', () => {
    expect(sessionName('13')).toBe('R0013')
    expect(sessionName('r13')).toBe('R0013')
    expect(sessionName(' R0013 ')).toBe('R0013')
    expect(sessionName('trip 3')).toBeNull()
  })
})

describe('the visit filled in from the last one', () => {
  const last = () => toStored({
    ...BLANK, trappers: 'Ana Pérez', session: 'R0001', when: '2026-06-10T09:00:00', site: 'TATR_0001', actions: ['Revision'], status: 'OK', card: 'Full', batteries: 'Missing',
    numPhotos: '1620', sd: 'A13', dateTimeOK: 'No', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: 'P800HG08192031', camera_model: 'Reconyx-PC800', setup_by: 'Ana', camera_height: 1.2, tags: ['ridge'], comments: 'Batteries changed' },
  })

  async function start() {
    mockedApi.listVisits.mockResolvedValue({ results: [last()] })
    await chooseByHand()
    await pickWhere()
    await pickWhen()
  }

  it('offers it when this is not the first visit to the location, and not when it is the first', async () => {
    await start()

    expect(screen.getByText(/This is not the first visit to/)).toHaveTextContent('the last was R0001, on 10 Jun 2026, 09:00 (Revision)')
    expect(screen.getByRole('button', { name: 'Fill in from R0001' })).toBeInTheDocument()
  })

  it('does not offer it for the first visit', async () => {
    await chooseByHand()
    await pickWhere()
    await pickWhen()

    expect(screen.queryByRole('button', { name: /Fill in from/ })).not.toBeInTheDocument()
  })

  describe('where a site starts', () => {
    const earlier = (session: string, date: string) => toStored({ ...BLANK, session, when: `${date}T09:00:00`, site: 'TATR_0001', actions: ['Installation'], sd: 'A13' })
    const withVisitsToAnotherSite = (sessions: [string, string][]) => {
      const kept = sessions.map(([session, date]) => earlier(session, date))
      mockedApi.listVisits.mockImplementation(async (_project, site) => ({ results: kept.filter((v) => !site || v.location_id === site) }))
      mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001'), location('TATR_0002')] })
    }
    const checkbox = () => screen.queryByRole('checkbox', { name: /This is where TATR_0002 starts/ })

    it('asks whether it is where the site starts, for the first visit ever to a site in a revision after the first', async () => {
      withVisitsToAnotherSite([['R0001', '2026-06-10'], ['R0002', '2026-08-05']])
      await chooseByHand()
      await pickWhere('TATR_0002')
      await pickWhen()

      const box = await screen.findByRole('checkbox', { name: /This is where TATR_0002 starts/ })
      expect(box).not.toBeChecked()                                    // off: the site may have been there before, with its earlier visits not here
      await userEvent.click(box)
      expect(box).toBeChecked()
    })

    it('does not ask for a site that is pending: its first visit starts it, and says so', async () => {
      withVisitsToAnotherSite([['R0001', '2026-06-10'], ['R0002', '2026-08-05']])
      mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001'), location('TATR_0002', { status: 'pending' })] })
      await chooseByHand()
      await pickWhere('TATR_0002')
      await pickWhen()

      expect(await screen.findByText(/TATR_0002 is pending: its first visit starts it/)).toBeInTheDocument()
      expect(screen.getByText('Site start + Installation', { selector: 'strong' })).toBeInTheDocument()   // the start comes first, before the Installation
      expect(checkbox()).not.toBeInTheDocument()
    })

    it('does not ask for the first visit of the first revision — nothing came before', async () => {
      mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001'), location('TATR_0002')] })
      await chooseByHand()
      await pickWhere('TATR_0002')
      await pickWhen()

      expect(await screen.findByText(/This is the first visit to TATR_0002/)).toBeInTheDocument()
      expect(checkbox()).not.toBeInTheDocument()
    })

    it('does not ask for a site that has visits already', async () => {
      mockedApi.listVisits.mockResolvedValue({ results: [earlier('R0001', '2026-06-10')] })
      await chooseByHand()
      await pickWhere('TATR_0001')
      await pickWhen()

      expect(await screen.findByText(/This is not the first visit to/)).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: /starts/ })).not.toBeInTheDocument()
    })
  })

  it('fills in the Camera, Site and Grouping sections, not the notes nor the card, and keeps only what the actions then ask', async () => {
    await start()
    await userEvent.click(screen.getByRole('button', { name: 'Fill in from R0001' }))

    expect(screen.getByRole('status')).toHaveTextContent('The Camera, Site and Grouping sections are filled in from the visit R0001, except the notes')
    expect(screen.queryByRole('list', { name: 'Who went' })).not.toBeInTheDocument() // who went is asked above
    expect(screen.getByRole('radio', { name: 'Yes, I see it' })).not.toBeChecked() // what was done is of this visit: it is asked again

    await pickAction('Revision')
    await openSection('SD card'); await openSection('Camera'); await openSection('Site'); await openSection('Grouping and notes')
    expect(screen.getByLabelText('SD card left in the camera')).toHaveValue('') // the card collected is the last one's, so it is not left back
    expect(screen.getByLabelText('Photos on the card collected')).toHaveValue('')
    expect(screen.queryByLabelText('Which camera will be installed?')).not.toBeInTheDocument()   // a revision is of the camera that was there, which the visit before says: it is not asked
    expect(screen.getByLabelText('Comments')).toHaveValue('') // the notes of the last visit are not this one's
    expect(screen.getByRole('switch', { name: 'Batteries OK' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Card OK' })).toHaveAttribute('aria-checked', 'true')

    // a Desinstallation leaves no card: what was typed for the Revision is left out
    await userEvent.type(screen.getByLabelText('Photos on the card collected'), '10')
    await pickAction('Desinstallation')
    for (const name of ['Mounting and placement', 'Where does it point?', 'How does it detect?']) expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()   // a camera taken away has no set-up asked
    await addVisit()

    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalled())
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({
      actions: ['Revision', 'Desinstallation'], sd: null, num_photos: 10, camera_id: null, camera_height: null, battery_status: 'NoBatteries', date_time_ok: 'No', comments: null,
    })
  })

  it('starts empty again when asked', async () => {
    await start()
    await userEvent.click(screen.getByRole('button', { name: 'Fill in from R0001' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start empty' }))

    expect(screen.getByRole('button', { name: 'Fill in from R0001' })).toBeInTheDocument()
    await pickAction('Revision')
    await openSection('SD card')
    expect(screen.getByLabelText('SD card left in the camera')).toHaveValue('')
  })
})

describe('VisitsPage from a CSV file', () => {
  const visit = (over: Record<string, unknown> = {}) => ({ ...toStored({ ...BLANK, session: 'R0001', when: '2026-10-02T08:14:05', site: 'TATR_0001', actions: ['Installation'], sd: 'A13' }), ...over })
  const file = new File(['Lugar,Dia,Hora,Tarea,Fotos\nTATR_0001,02/10/2026,08:14,Revision,1620\n'], 'visits.csv', { type: 'text/csv' })
  const COLUMNS = {
    columns: ['Lugar', 'Dia', 'Hora', 'Tarea', 'Fotos'], sample: [['TATR_0001', '02/10/2026', '08:14', 'Revision', '1620']],
    mapping: { location_id: 'Lugar', date: 'Dia', time: 'Hora', actions: 'Tarea' },
    fields: [
      { field: 'location_id', label: 'Site (a location of the research project)', required: true }, { field: 'actions', label: 'Actions', required: true },
      { field: 'date', label: 'Date', required: false }, { field: 'time', label: 'Time', required: false }, { field: 'num_photos', label: 'Photos on the card collected', required: false },
    ],
  }
  const MAPPING = { location_id: 'Lugar', date: 'Dia', time: 'Hora', actions: 'Tarea', num_photos: 'Fotos' }
  const MAPPING_WITHOUT_PHOTOS = { location_id: 'Lugar', date: 'Dia', time: 'Hora', actions: 'Tarea' }   // what the file matched by itself

  /** The file step stays open, with what it can create, until Continue. */
  async function continueFromTheFile() {
    const button = await screen.findByRole('button', { name: 'Continue' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
  }

  const onMainMenu = vi.fn()
  async function start(option = /custom csv/i) {
    mockedApi.visitsCsvColumns.mockResolvedValue(COLUMNS)
    render(<VisitsPage onBack={vi.fn()} onMainMenu={onMainMenu} />)
    await userEvent.click(screen.getByRole('button', { name: option }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()
  }

  it('shows the columns of the file with the ones that match already picked, and an example of each', async () => {
    await start()

    expect(await screen.findByLabelText('Site (a location of the research project)')).toHaveValue('Lugar')
    expect(screen.getByLabelText('Date')).toHaveValue('Dia')
    expect(screen.getByLabelText('Photos on the card collected')).toHaveValue('')
    expect(screen.getByLabelText('Example of Date')).toHaveTextContent('02/10/2026')
    expect(mockedApi.importVisitsCsv).not.toHaveBeenCalled()
  })

  it('offers to take the CSV from the Epicollect5 project when it is used, and goes on to the columns as a file does', async () => {
    mockedApi.getSettings.mockResolvedValue({ ...APP_SETTINGS, EPICOLLECT5: { ...APP_SETTINGS.EPICOLLECT5, enabled: true } })
    mockedApi.epicollectVisitsDownload.mockResolvedValue({ csv: 'Lugar,Dia\nTATR_01,02/10/2026\n', count: 1 })
    mockedApi.visitsCsvColumns.mockResolvedValue(COLUMNS)
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /custom csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Epicollect5 project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download the entries' }))
    await continueFromTheFile()

    expect(await screen.findByLabelText('Date')).toHaveValue('Dia')
    expect(mockedApi.visitsCsvColumns).toHaveBeenCalledWith('Lugar,Dia\nTATR_01,02/10/2026\n')
  })

  it('keeps the step of the file open when the file is chosen, with what can be created, until Continue — and Back goes to the research project', async () => {
    mockedApi.visitsCsvColumns.mockResolvedValue(COLUMNS)
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /custom csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)

    expect(await screen.findByText('Create what does not exist yet')).toBeVisible()      // the step did not move on
    expect(screen.queryByLabelText('Columns of the file and fields of the visit')).not.toBeInTheDocument()   // the matching waits for Continue
    const next = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(next).toBeEnabled())
    await userEvent.click(next)
    expect(await screen.findByLabelText('Columns of the file and fields of the visit')).toBeInTheDocument()
  })

  it('groups the fields of the matching, and each group can be folded away', async () => {
    await start()

    expect(await screen.findByLabelText('Site (a location of the research project)')).toBeInTheDocument()
    const where = screen.getByRole('button', { name: /^Where, \d+ of \d+ matched$/ })
    expect(where).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(where)
    expect(where).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Site (a location of the research project)')).not.toBeInTheDocument()
    await userEvent.click(where)
    expect(screen.getByLabelText('Site (a location of the research project)')).toBeInTheDocument()
  })

  it('asks for more fields when what does not exist is to be created, takes a default for a field with no column, and sends both', async () => {
    mockedApi.visitsCsvColumns.mockResolvedValue({
      ...COLUMNS, fields: [...COLUMNS.fields,
        { field: 'latitude', label: 'Latitude', required: false, required_with: ['locations'] }, { field: 'longitude', label: 'Longitude', required: false, required_with: ['locations'] },
        { field: 'timezone', label: 'Timezone of the location (IANA, e.g. Europe/Madrid)', required: false, entity: 'locations', required_with: ['locations'] },
        { field: 'camera_model', label: 'Camera model', required: false, entity: 'cameras', required_with: [] }, { field: 'sd_brand', label: 'Brand of the SD card', required: false, entity: 'sd_cards', required_with: [] },
      ],
    } as never)
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /custom csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    // what to create is chosen with the file, before it is read
    await userEvent.click(screen.getByRole('switch', { name: 'Create the locations that do not exist' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Create the cameras that do not exist' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    await screen.findByLabelText('Site (a location of the research project)')
    expect(screen.getByLabelText('Timezone of the location (IANA, e.g. Europe/Madrid)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Brand of the SD card')).not.toBeInTheDocument()          // the SD cards are not created
    expect(screen.getByRole('button', { name: 'Read the visits' })).toBeDisabled()               // the coordinates are required
    expect(screen.getByRole('status')).toHaveTextContent('match also latitude, longitude')

    // a default is as good as a column
    await userEvent.type(screen.getByLabelText('Default for Latitude'), '40.1')
    await userEvent.type(screen.getByLabelText('Default for Longitude'), '-3.2')
    // the timezone and the summer time start as UTC, following summer time; the model of a camera is not needed
    expect(screen.getByLabelText('Default for Timezone of the location (IANA, e.g. Europe/Madrid)')).toHaveValue('UTC')
    expect(screen.getByRole('button', { name: 'Read the visits' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Read the visits' }))
    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', expect.any(String), false, 'mapped', MAPPING_WITHOUT_PHOTOS, {
      create: { locations: true, cameras: true, sd_cards: false, trappers: false },
      defaults: { latitude: '40.1', longitude: '-3.2', timezone: 'UTC', daylight_saving: 'yes' },
    }))
  })

  it('reads the file downloaded from the new WildINTEL Epicollect project, as its own source', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /legacy/i })).not.toBeInTheDocument() // the old form is not a source any more
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv'))
    expect(await screen.findByText(/to add/)).toBeInTheDocument()
  })

  it('can create what does not exist from the file of the new WildINTEL Epicollect form, asking only the timezone and the summer time of the new locations', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))

    expect(screen.queryByLabelText('Timezone of the new locations')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Create the locations that do not exist' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Create the cameras that do not exist' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Create the SD cards that do not exist' }))
    expect(screen.getByLabelText('Timezone of the new locations')).toHaveValue('UTC')
    await userEvent.clear(screen.getByLabelText('Timezone of the new locations'))
    await userEvent.type(screen.getByLabelText('Timezone of the new locations'), 'Europe/Madrid')
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv', undefined,
      { create: { locations: true, cameras: true, sd_cards: true, trappers: false }, defaults: { timezone: 'Europe/Madrid', daylight_saving: 'yes' } }))
  })

  it('can ask to create the trappers the file says went, sends it, and says which are made', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [],
      create: { locations: [], cameras: [], sd_cards: [], trappers: [{ username: 'luis.gomez', name: 'Luis Gómez' }] } })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Create the trappers that do not exist' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv', undefined, { create: { locations: false, cameras: false, sd_cards: false, trappers: true } }))
    expect(within(await screen.findByRole('list', { name: 'What is created' })).getByText(/1 trapper: Luis Gómez/)).toBeInTheDocument()
  })

  it('can say that the photos were not counted, and sends it with the file — off by default', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    const toggle = screen.getByRole('switch', { name: 'The photos were not counted' })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv', undefined, { photos_not_counted: true }))
  })

  it('takes the coordinates of the location for a row that has none, unless it is turned off — then it sends so', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    const toggle = screen.getByRole('switch', { name: 'Use the coordinates of the location when a row has none' })
    expect(toggle).toBeChecked()                                    // on by default: nothing is sent for it
    await userEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv', undefined, { coordinates_from_location: false }))
  })

  it('can ask to close the revision before the ones of the file, and sends it with the file', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /^wildintel epicollect csv\s*read the visits of a field trip from the csv downloaded from the new/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Close the revision before when it has locations still planned' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['locationID,Date\n'], 'new.csv', { type: 'text/csv' }))
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', 'locationID,Date\n', false, 'epicollect-csv', undefined, { close_revisions: true }))
  })

  it('reads the visits with the columns as they are mapped, says what it found, and keeps them with the same mapping', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit(), visit({ session: 'R0002', date: '2026-11-05', actions: ['Revision', 'Installation'] })], problems: [{ row: 4, message: "'many' is not a whole number." }], skipped: 1, saved: null, new_sites: [{ site: 'X', session: null, actions: ['Revision'], date: '2026-10-02', time: '08:00:00', latitude: 37.1, longitude: -6.4, visits: 1, nearest: { location_id: 'DONA_01', distance_m: 40 }, similar: ['DONA_01'] }], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: 2, new_sites: [], warnings: [] })
    await start()
    await userEvent.selectOptions(await screen.findByLabelText('Photos on the card collected'), 'Fotos')
    await userEvent.click(screen.getByRole('button', { name: 'Read the visits' }))

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', expect.stringContaining('TATR_0001,02/10/2026'), false, 'mapped', MAPPING))
    expect(await screen.findByText(/to add/)).toHaveTextContent('2 visits to add · 1 already kept · 1 row with a problem')
    expect(screen.getByRole('list', { name: 'Rows with a problem' })).toHaveTextContent("Row 4: 'many' is not a whole number.")

    await userEvent.click(screen.getByRole('button', { name: 'Add 2 visits' }))
    expect(mockedApi.importVisitsCsv).toHaveBeenLastCalledWith('TATR', expect.any(String), true, 'mapped', MAPPING)
    // what was done, as a summary: the success, a table of what was kept and then the buttons
    expect(await screen.findByText('Visits saved')).toBeInTheDocument()
    const summary = await screen.findByRole('table', { name: 'Summary' })
    expect(summary).toHaveTextContent('Visits added2')
    expect(summary).toHaveTextContent('RevisionsR0001')
    expect(screen.queryByRole('region', { name: 'Deployments' })).not.toBeInTheDocument()   // no visit was closed by them
    expect(screen.queryAllByRole('table').map((t) => t.getAttribute('aria-label'))).not.toContain('Rows') // no table of rows is shown: just the matching, in groups
    expect(screen.getByRole('region', { name: 'Where' })).toHaveTextContent('of') // the visits are kept: the list of them goes, the mapping stays
    expect(screen.getByRole('button', { name: 'Back to the visits menu' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the main menu' }))
    expect(onMainMenu).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Register more visits' }))
    expect(screen.getByText('Where do the visits come from?')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says which revision is not finished when the rows of the next are refused, and closes it — marking the locations as not visited — and reads the file again with one button', async () => {
    const refused = 'R0002 cannot start: R0001 is not finished, 2 location(s) still to be visited in it: TATR_0002, TATR_0003.'
    mockedApi.importVisitsCsv
      .mockResolvedValueOnce({ visits: [], problems: [{ row: 2, message: refused }, { row: 3, message: refused }], skipped: 0, saved: null, new_sites: [], warnings: [] })
      .mockResolvedValueOnce({ visits: [visit(), visit({ session: 'R0002', date: '2026-11-05' })], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [], closed: [{ location_id: 'TATR_0002', session: 'R0001' }, { location_id: 'TATR_0003', session: 'R0001' }] })
    await start()
    await userEvent.selectOptions(await screen.findByLabelText('Photos on the card collected'), 'Fotos')
    await userEvent.click(screen.getByRole('button', { name: 'Read the visits' }))

    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('R0001 is not finished, so the rows of R0002 are not added')
    expect(notice).toHaveTextContent('2 locations are still to be visited there (TATR_0002, TATR_0003)')
    expect(notice).toHaveTextContent('closes that revision, which cannot be changed afterwards')
    expect(mockedApi.importVisitsCsv).toHaveBeenCalledTimes(1)

    await userEvent.click(within(notice).getByRole('button', { name: 'Mark them as not visited and read again' }))

    expect(await screen.findByRole('button', { name: 'Add 2 visits' })).toBeInTheDocument()
    expect(mockedApi.importVisitsCsv).toHaveBeenCalledTimes(2)
    expect(mockedApi.importVisitsCsv).toHaveBeenLastCalledWith('TATR', expect.any(String), false, 'mapped', MAPPING, expect.objectContaining({ close_revisions: true }))
    expect(screen.queryByText(/is not finished, so the rows/)).not.toBeInTheDocument()
  })

  it('waits while the visits are saved: the button says so and cannot be pressed again', async () => {
    let finish: (value: unknown) => void = () => {}
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit(), visit({ session: 'R0002', date: '2026-11-05' })], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    mockedApi.importVisitsCsv.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
    await start()
    await userEvent.selectOptions(await screen.findByLabelText('Photos on the card collected'), 'Fotos')
    await userEvent.click(screen.getByRole('button', { name: 'Read the visits' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 visits' }))

    const saving = await screen.findByRole('button', { name: /Saving 2 visits… this can take some minutes/ })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')
    expect(saving.querySelector('.animate-spin')).not.toBeNull()          // something moves: it is working
    expect(screen.getAllByRole('button', { name: 'Back' }).at(-1)).toBeDisabled()   // and the page cannot be left half way
    await userEvent.click(saving)
    expect(mockedApi.importVisitsCsv).toHaveBeenCalledTimes(2)   // the read and one save, not two
    finish({ visits: [visit()], problems: [], skipped: 0, saved: 2, new_sites: [], warnings: [] })
    expect(await screen.findByText('Visits saved')).toBeInTheDocument()
  })

  it('does not read the visits until the site, the actions and when are mapped', async () => {
    await start()

    await userEvent.selectOptions(await screen.findByLabelText('Time'), '')
    expect(screen.getByRole('button', { name: 'Read the visits' })).toBeDisabled()
    expect(screen.getByText('To read the visits, match also the time.')).toBeInTheDocument()   // it says what is missing: the date and the time are needed too
    await userEvent.selectOptions(screen.getByLabelText('Date'), '')
    expect(screen.getByText('To read the visits, match also the date and the time (or one column with both).')).toBeInTheDocument()
    expect(screen.getAllByText('required')).toHaveLength(4)   // the site, the actions, the date and the time
    await userEvent.selectOptions(screen.getByLabelText('Time'), 'Hora')
    await userEvent.selectOptions(screen.getByLabelText('Date'), 'Dia')
    expect(screen.getByRole('button', { name: 'Read the visits' })).toBeEnabled()
    expect(screen.queryByText(/To read the visits, match also/)).not.toBeInTheDocument()
  })

  it('says why a file cannot be read, and offers nothing to map', async () => {
    mockedApi.visitsCsvColumns.mockRejectedValue(new Error('The file is empty.'))
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /custom csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty.')
    expect(screen.queryByRole('button', { name: 'Read the visits' })).not.toBeInTheDocument()
  })

  it('says the locations can be created when the sites of the file are not there, and checks the file again when the settings close', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [], problems: [], skipped: 0, saved: null, new_sites: [{ site: 'TATR_0001', session: null, actions: ['Revision'], date: '2026-10-02', time: '08:00:00', latitude: 37.1, longitude: -6.4, visits: 1, nearest: { location_id: 'DONA_01', distance_m: 40 }, similar: ['DONA_01'] }], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    const onOpenSettings = vi.fn()
    const { rerender } = render(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    expect(await screen.findByText(/You can also create the locations/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Go to the locations of TATR' }))
    expect(onOpenSettings).toHaveBeenCalledWith('locations', 'TATR')

    rerender(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} settingsOpen />)
    rerender(<VisitsPage onBack={vi.fn()} onOpenSettings={onOpenSettings} settingsOpen={false} />)
    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/You can also create the locations/)).not.toBeInTheDocument())
  })

  it('says what is odd in the visits, and tells the sites that are not locations to create them with the option of the step, not to add them one by one', async () => {
    const site = (id: string) => ({ site: id, session: null, actions: ['Installation'], date: '2026-10-02', time: '08:00:00', latitude: 49.1, longitude: 20.2, visits: 2, nearest: null, similar: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [site('TATR_0011'), site('TATR_0099')],
      warnings: ['R0003: camera P800 is at 2 sites (TATR_0001, TATR_0002).'] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    expect(await screen.findByRole('list', { name: 'What to check' })).toHaveTextContent('camera P800 is at 2 sites')
    expect(screen.getByText(/2 sites are not a location of TATR/)).toBeInTheDocument()
    expect(screen.getByLabelText('Sites that are not locations yet')).toHaveTextContent('TATR_0011, TATR_0099')
    expect(screen.getByText(/Create the locations that do not exist/, { selector: 'em' })).toBeInTheDocument()
    // no site is added one by one from here: the option of the step creates them
    expect(screen.queryByRole('button', { name: /as a location/ })).not.toBeInTheDocument()
    expect(mockedApi.saveLocalLocation).not.toHaveBeenCalled()
  })

  it('tells what is worth knowing of the visits and names the report of the import', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [], notes: ['R0004: sites visited in R0003 and not on this trip, their cameras still out: TATR_0002.'] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: 1, new_sites: [], warnings: [], report: '20241012-090000_visits_TATR' })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    expect(await screen.findByRole('list', { name: 'Notes on the visits' })).toHaveTextContent('their cameras still out: TATR_0002')
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 visit' }))
    expect(await screen.findByRole('link', { name: 'Download report' })).toHaveAttribute('href', '/api/reports/20241012-090000_visits_TATR/download?format=csv')
  })

  it('checks the file again from the button of the step, with the same options', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [], problems: [], skipped: 1, saved: null, new_sites: [], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()
    expect(await screen.findByText(/to add/)).toHaveTextContent('0 visits to add · 1 already kept')

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/to add/)).toHaveTextContent('1 visit to add')
    expect(mockedApi.importVisitsCsv).toHaveBeenCalledTimes(2)
    expect(mockedApi.importVisitsCsv.mock.calls[1].slice(0, 4)).toEqual(mockedApi.importVisitsCsv.mock.calls[0].slice(0, 4))   // the same file and format
  })

  it('does not say again, in the notice, what is odd in the rows: only what no row has', async () => {
    const odd = 'R0002 TATR_0001: Revision with 0 photos; no deployment will be produced for it.'
    mockedApi.importVisitsCsv.mockResolvedValueOnce({
      visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [odd, 'R0001: the session before it is missing.'], loose_warnings: ['R0001: the session before it is missing.'],
      rows: [{ row: 2, site: 'TATR_0001', session: 'R0002', result: 'ok', label: '', message: '', warnings: [odd] }],
    })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    expect(await screen.findByRole('list', { name: 'What to check' })).toHaveTextContent('the session before it is missing')
    expect(screen.getByRole('list', { name: 'What to check' })).not.toHaveTextContent('0 photos')           // that one is in its row
    expect(screen.getByRole('table', { name: 'Problems of Row 2' })).toHaveTextContent('Revision with 0 photos')
  })

  it('forgets what the file before said when another is chosen — even one with the same name, edited', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [], problems: [{ row: 2, message: "'many' is not a whole number." }], skipped: 0, saved: null, new_sites: [{ site: 'X', session: null, actions: ['Revision'], date: '2026-10-02', time: '08:00:00', latitude: 37.1, longitude: -6.4, visits: 1, nearest: { location_id: 'DONA_01', distance_m: 40 }, similar: ['DONA_01'] }], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    const input = screen.getByLabelText('CSV file') as HTMLInputElement
    await userEvent.upload(input, file)
    await continueFromTheFile()
    expect(await screen.findByRole('list', { name: 'Rows with a problem' })).toBeInTheDocument()
    expect(input.value).toBe('') // so that the same file, once edited, can be chosen again

    await userEvent.upload(input, new File(['edited'], 'visits.csv', { type: 'text/csv' }))
    await continueFromTheFile()
    expect(await screen.findByText(/to add/)).toHaveTextContent('1 visit to add')
    expect(screen.queryByRole('list', { name: 'Rows with a problem' })).not.toBeInTheDocument()
  })

  it('says how many other visits the ones added closed, and sends to the visit dashboard for their deployments, with no notice for each of them', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: 1, new_sites: [], warnings: [] })
    mockedApi.closedVisits.mockResolvedValue({ results: [{ visit: visit({ session: 'R0001' }), end: visit() }] })
    render(<VisitsPage onBack={vi.fn()} onImportImages={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 1 visit' }))

    await waitFor(() => expect(screen.getByRole('region', { name: 'Deployments' })).toHaveTextContent('As a result of this new visit, 1 other visit is now closed'))
    expect(screen.getByRole('table', { name: 'Summary' })).toHaveTextContent('Visits closed — their deployment can be created1')
    expect(screen.queryByRole('button', { name: /Create the deployment of the visit/ })).not.toBeInTheDocument()
  })

  it('links the closed visits to Import deployment on the research project, where their revision is picked', async () => {
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    mockedApi.importVisitsCsv.mockResolvedValueOnce({ visits: [visit()], problems: [], skipped: 0, saved: 1, new_sites: [], warnings: [] })
    mockedApi.closedVisits.mockResolvedValue({ results: [{ visit: visit({ session: 'R0001' }), end: visit() }] })
    const onImportImagesOf = vi.fn()
    render(<VisitsPage onBack={vi.fn()} onImportImagesOf={onImportImagesOf} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 1 visit' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Create deployment' }))
    expect(onImportImagesOf).toHaveBeenCalledWith('TATR')
  })

  it('reads a WildINTEL Epicollect download without asking for any column', async () => {
    mockedApi.importVisitsCsv.mockResolvedValue({ visits: [visit()], problems: [], skipped: 0, saved: null, new_sites: [], warnings: [] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^wildintel epicollect csv/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.upload(screen.getByLabelText('CSV file'), file)
    await continueFromTheFile()

    await waitFor(() => expect(mockedApi.importVisitsCsv).toHaveBeenCalledWith('TATR', expect.any(String), false, 'epicollect-csv'))
    expect(await screen.findByText(/to add/)).toHaveTextContent('1 visit to add')
    expect(mockedApi.visitsCsvColumns).not.toHaveBeenCalled()
    expect(screen.queryByText('Match the columns')).not.toBeInTheDocument()
  })
})

describe('a visit that is neither an Installation nor a Revision', () => {
  it('has nothing of the camera, the site or the grouping but its notes', () => {
    const v = { ...BLANK, actions: ['Stolen'], sd: 'A13', numPhotos: '12', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: '12', camera_height: 1, habitat: 'oak', deployment_groups: 'north', comments: 'the lock was cut' } }
    expect(withoutWhatIsNotAsked(v as never)).toMatchObject({ sd: '', numPhotos: '', details: { camera_id: null, camera_height: null, habitat: null, deployment_groups: null, comments: 'the lock was cut' } })
    expect(onlyNotes(['Stolen'])).toBe(true)
    expect(onlyNotes(['Stolen', 'Archive'])).toBe(true)
    expect(onlyNotes(['Revision', 'Desinstallation'])).toBe(false)
    expect(onlyNotes(['Stolen', 'Installation'])).toBe(false)
  })
})

describe('visitErrors', () => {
  const ok = { ...BLANK, session: 'R0013', when: '2026-10-02T08:14:05', site: 'TATR_0001', actions: ['Revision'], numPhotos: '1620', status: 'OK', sd: 'B2', details: { ...EMPTY_DEPLOYMENT_FIELDS, camera_id: '12' } }

  it('has nothing to say of a complete visit', () => {
    expect(visitErrors(ok)).toEqual({})
  })

  it('refuses any action but an Installation for the first visit to a site', () => {
    expect(visitErrors(ok, true)).toEqual({ actions: 'The first visit to a site can only be an Installation.' })
    expect(visitErrors({ ...ok, actions: ['Installation', 'Revision'] }, true).actions).toBeDefined()
    expect(visitErrors({ ...ok, actions: ['Installation'], sd: 'A13' }, true)).toEqual({})
  })

  it('lets the first visit to a site be its start — alone or with an Installation — and not a start with a Revision', () => {
    expect(visitErrors({ ...ok, actions: ['SiteStart'] }, true).actions).toBeUndefined()
    expect(visitErrors({ ...ok, actions: ['SiteStart', 'Installation'], sd: 'A13' }, true)).toEqual({})
    expect(visitErrors({ ...ok, actions: ['SiteStart', 'Revision'] }, true).actions).toBeDefined()
  })

  it('says Site start where the visit does', () => {
    expect(visitSummary({ ...BLANK, site: 'TATR_0002', when: '2026-10-02T08:14:05', actions: ['SiteStart', 'Installation'], trappers: 'Ana Pérez' } as never, 'R0004', 'UTC').overview.find((r) => r.label === 'Action performed')?.value).toBe('Site start + Installation')
  })

  it('does not require the number of photos when the card was full: it is not counted', () => {
    expect(visitErrors({ ...ok, numPhotos: '' }).numPhotos).toBe('Required.')
    expect(visitErrors({ ...ok, numPhotos: '', card: 'Full' }).numPhotos).toBeUndefined()
    expect(visitErrors({ ...ok, numPhotos: '12', card: 'Full' })).toEqual({}) // it may still be given
  })

  it('wants a whole number of photos', () => {
    expect(visitErrors({ ...ok, numPhotos: '1.5' })).toEqual({ numPhotos: 'A whole number.' })
  })

  it('wants the photos collected at a revision, but not the photos of an installation — and the camera only at an installation: a revision is of the one that was there', () => {
    expect(visitErrors({ ...ok, numPhotos: '', details: EMPTY_DEPLOYMENT_FIELDS })).toEqual({ numPhotos: 'Required.' })
    expect(visitErrors({ ...ok, actions: ['Installation'], details: EMPTY_DEPLOYMENT_FIELDS, sd: 'A13' }).camera).toBe('Required.')
    expect(visitErrors({ ...ok, actions: ['Installation'], numPhotos: '', sd: 'A13' })).toEqual({})
  })

  it('wants the card left at an installation', () => {
    expect(visitErrors({ ...ok, actions: ['Installation'], sd: '' })).toEqual({ sd: 'Required.' })
  })

  it('asks as strongly as any of the actions asks', () => {
    expect(fieldsFor(['Revision', 'Installation'])).toMatchObject({ sdLeft: 'required', photos: 'required', status: 'required', batteries: 'required', dateTime: 'required', card: 'required', calibration: 'required' })
    expect(fieldsFor(['Revision', 'Desinstallation', 'Installation'])).toMatchObject({ sdLeft: 'required', photos: 'required', calibration: 'required' })      // a replacement: the card of the new camera
    expect(fieldsFor(['Revision', 'Desinstallation'])).toMatchObject({ sdLeft: 'off', photos: 'required', status: 'required', batteries: 'required', calibration: 'off' })   // taken away: nothing is left in it
    expect(fieldsFor(['Stolen'])).toMatchObject({ camera: 'off', photos: 'off', sdLeft: 'off' })   // the camera is the one that was there
    expect(fieldsFor(['Revision'])).toMatchObject({ camera: 'off', sdLeft: 'required', photos: 'required', status: 'required', batteries: 'required', card: 'required', dateTime: 'required', calibration: 'required' })   // a revision asks it all but the set-up of the camera
    expect(fieldsFor(['Installation'])).toMatchObject({ batteries: 'off', dateTime: 'off', card: 'off', photos: 'off', status: 'off', calibration: 'required' })
    expect(fieldsFor([]).camera).toBe('off')
  })
})

describe('toStored', () => {
  it('keeps the numbers as numbers, what is left blank as none, and the details as the deployment names them', () => {
    const stored = toStored({
      ...BLANK, trappers: ' Ana ', session: '13', when: '2026-10-02T08:14:00', site: ' TATR_0001 ', actions: ['Revision'], numPhotos: '1620', latitude: '37.1', longitude: '-3.4',
      details: { ...EMPTY_DEPLOYMENT_FIELDS, setup_by: 'Ana', camera_id: '12', camera_height: 1.2, tags: ['forest edge'] },
    })

    expect(stored).toMatchObject({
      location_id: 'TATR_0001', session: 'R0013', date: '2026-10-02', time: '08:14:00', num_photos: 1620, latitude: 37.1, longitude: -3.4,
      trappers: 'Ana', setup_by: 'Ana', camera_id: '12', camera_height: 1.2, tags: ['forest edge'], camera_status: null, sd: null,
    })
    expect(stored).not.toHaveProperty('deployment_id')
    expect(stored).not.toHaveProperty('start_date')
  })
})

describe('detailsErrors', () => {
  it('has nothing to say when the details are empty', () => {
    expect(detailsErrors(EMPTY_DEPLOYMENT_FIELDS)).toEqual({})
  })

  it('says what is out of range in the camera details', () => {
    const errors = detailsErrors({ ...EMPTY_DEPLOYMENT_FIELDS, camera_tilt: 120, camera_heading: 400 })

    expect(errors.camera_tilt).toBeTruthy()
    expect(errors.camera_heading).toBeTruthy()
  })
})

describe('namesOf, addName and removeName', () => {
  it('read and write the names separated by commas', () => {
    expect(namesOf(' Ana ,, Luis ')).toEqual(['Ana', 'Luis'])
    expect(addName('Ana', 'Luis')).toBe('Ana, Luis')
    expect(addName('Ana', 'ana')).toBe('Ana')
    expect(addName('', 'Ana')).toBe('Ana')
    expect(removeName('Ana, Luis', 'ana')).toBe('Luis')
  })
})

describe('By hand: do you see the camera?', () => {
  async function start() {
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await pickWhere()
    await pickWhen()
  }

  it('asks nothing where no camera is known: the visit installs one', async () => {
    await start()

    const question = await screen.findByRole('group', { name: 'Do you see the camera?' })
    expect(within(question).getAllByRole('radio')).toHaveLength(2)
    expect(within(question).getByRole('radio', { name: /Of course not, I am going to install it/ })).toBeChecked()
    expect(within(question).getByRole('radio', { name: /No, I cannot make the visit/ })).not.toBeChecked()
    expect(screen.getByText('Site start + Installation', { selector: 'strong' })).toBeInTheDocument()   // the first camera at a site: the site starts, and it is said before the Installation
    expect(screen.queryByRole('checkbox', { name: 'Revision' })).not.toBeInTheDocument() // the actions are not asked as boxes
  })

  it('tells which camera was there, then asks how it is doing, then which camera is put up, and the calibration comes before how it was mounted — when it is replaced', async () => {
    withCamera()
    await chooseByHand()
    await pickWhere()
    await pickWhen()
    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Replace it with another' }))
    await openSection('Camera')

    const at = (text: string | RegExp) => (screen.getByText(text) as HTMLElement)
    const before = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const was = at(/According to the visit/)
    const doing = at('How did it go with the camera P800HG08192031?')
    const camera = screen.getByLabelText('Which camera will be installed?')
    const mounted = at('How was it mounted?')
    const calibration = screen.getByRole('switch', { name: 'Calibration done' })
    expect(was).toHaveTextContent('According to the visit R0001, the camera P800HG08192031 is installed at TATR_0001.')
    expect(before(was, doing) && before(doing, camera) && before(camera, calibration) && before(calibration, mounted)).toBe(true)
  })

  it('works the actions out from the answers when a camera is there', async () => {
    withCamera()
    await start()
    const hint = () => screen.getByText(/The visit is kept as/).closest('p')!

    expect(await screen.findByRole('radio', { name: 'Yes, I see it' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Yes, I see it' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
    expect(hint()).toHaveTextContent('The visit is kept as Revision')
    await userEvent.click(screen.getByRole('radio', { name: 'Replace it with another' }))
    expect(hint()).toHaveTextContent('The visit is kept as Revision + Desinstallation + Installation. The camera is looked at and taken away, with its card, and another is put up with a card of its own: it is replaced.')
    await userEvent.click(screen.getByRole('radio', { name: 'Take it away' }))
    expect(hint()).toHaveTextContent('The visit is kept as Revision + Desinstallation. The camera is looked at and taken away, with its card: nothing is left.')
    await userEvent.click(screen.getByRole('radio', { name: 'Take it away, and archive the location' }))
    expect(hint()).toHaveTextContent('Revision + Desinstallation')

    await userEvent.click(screen.getByRole('radio', { name: 'No, it was stolen' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Install a new camera' }))
    expect(hint()).toHaveTextContent('Stolen + Installation')
    await userEvent.click(screen.getByRole('radio', { name: 'Archive the location' }))
    expect(hint()).toHaveTextContent('The visit is kept as Stolen')
  })

  it('keeps a visit that could not be made as not visited, asking nothing of the camera, and asks again before keeping it', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    await start()
    await userEvent.click(await screen.findByRole('radio', { name: 'No, I cannot make the visit' }))

    expect(screen.getByText(/The visit is kept as/).closest('p')).toHaveTextContent('not visited')
    expect(screen.queryByRole('radio', { name: 'OK' })).not.toBeInTheDocument()   // nothing is asked of the camera
    await userEvent.type(screen.getByLabelText('Reason'), 'the road was flooded')
    await userEvent.click(screen.getByRole('button', { name: 'Review the visit' }))

    // a visit cannot be changed once it is created: it is asked again
    expect(await screen.findByText(/A visit cannot be changed once it is created/)).toBeInTheDocument()
    expect(mockedApi.saveVisit).not.toHaveBeenCalled()
    // step 5 says what is going to be kept
    const summary = within(screen.getByRole('group', { name: 'The visit' }))
    expect(summary.getByRole('region', { name: 'Visit overview' })).toBeInTheDocument()
    for (const name of ['Camera', 'SD card', 'Site', 'Grouping and notes']) expect(summary.getByRole('region', { name })).toBeInTheDocument()
    expect(summary.getByText('Location').nextElementSibling).toHaveTextContent('TATR_0001')
    expect(summary.getByText('Revision code').nextElementSibling).toHaveTextContent('R0002')   // the one the notice names
    expect(summary.getByText('Action performed').nextElementSibling).toHaveTextContent('Not visited')
    expect(screen.getByRole('button', { name: 'Edit Enter the visit' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the form' }))
    expect(screen.getByRole('button', { name: 'Review the visit' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Review the visit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, add the visit' }))

    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalledTimes(1))
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ actions: [], camera_status: 'Not revised', camera_id: null, num_photos: null, sd: null, comments: 'the road was flooded' })
  })

  it('archives the location, with the reason, when the camera was stolen and the site is given up', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    mockedApi.updateLocalLocation.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'No, it was stolen' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Archive the location' }))
    await addVisit()

    await waitFor(() => expect(mockedApi.updateLocalLocation).toHaveBeenCalledWith('TATR', 'TATR_0001', { status_note: 'Repeated thefts' }))
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ actions: ['Stolen', 'Archive'] })
  })

  it('says the camera and the card were stolen and will be archived, and does it when the visit is kept', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    mockedApi.setFieldItemStatus.mockResolvedValue({ updated: true })
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'No, it was stolen' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Archive the location' }))
    expect(screen.queryByRole('region', { name: 'Camera' })).not.toBeInTheDocument()     // a stolen camera has nothing of the camera, the card or the site: only its notes
    expect(screen.queryByRole('region', { name: 'SD card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Site' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Comments')).toBeInTheDocument()
    expect(document.body).toHaveTextContent('The camera P800HG08192031 was stolen and will be archived.')
    expect(document.body).toHaveTextContent('The SD card A13, which was in the camera, was stolen with it and will be archived.')

    await addVisit()
    await waitFor(() => expect(mockedApi.setFieldItemStatus).toHaveBeenCalledWith('TATR', 'cameras', 'P800HG08192031', 'stolen', '2026-10-02', 'Stolen'))
    expect(mockedApi.setFieldItemStatus).toHaveBeenCalledWith('TATR', 'sd_cards', 'A13', 'stolen', '2026-10-02', 'Stolen with the camera')
  })

  it('asks whether the camera was calibrated, in the Camera card, where a camera is left or put up, and keeps it with the visit', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))

    await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
    await openSection('Camera')
    expect(screen.getByRole('switch', { name: 'Calibration done' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('switch', { name: 'Calibration done' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Take it away, and archive the location' }))
    expect(screen.queryByRole('switch', { name: 'Calibration done' })).not.toBeInTheDocument() // nothing is left: no calibration
    await userEvent.click(screen.getByRole('radio', { name: 'Leave it where it is' }))
    expect(screen.getByRole('switch', { name: 'Calibration done' })).toBeInTheDocument()
  })

  it('asks the state of the camera, as cards, before what is done with it: OK and Altered (Knocked down and Damaged are no longer accepted)', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))
    const states = screen.getByRole('radiogroup', { name: 'What state is the camera in?' })
    expect(within(states).getAllByRole('radio').map((o) => o.getAttribute('aria-label'))).toEqual(['OK', 'Altered'])
    expect(screen.queryByRole('radiogroup', { name: 'What do you do with the camera?' })).not.toBeInTheDocument() // asked once the state is said
    await userEvent.click(within(states).getByRole('radio', { name: 'Altered' }))
    expect(screen.getByRole('radiogroup', { name: 'What do you do with the camera?' })).toBeInTheDocument()
    await openSection('Camera')
    expect(screen.queryByLabelText('Status of the camera')).not.toBeInTheDocument() // it is not asked twice
  })

  it('archives the location, for good, when the camera is taken away and no other is put up', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    mockedApi.updateLocalLocation.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))

    await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Take it away, and archive the location' }))
    expect(document.body).toHaveTextContent('An archived location is archived for good: it never goes back to active')
    await userEvent.clear(screen.getByLabelText('Why is it archived?'))
    await userEvent.type(screen.getByLabelText('Why is it archived?'), 'No cameras left')
    await openSection('SD card'); await openSection('Camera')
    await userEvent.type(screen.getByLabelText('Photos on the card collected'), '24')
    await addVisit()

    await waitFor(() => expect(mockedApi.updateLocalLocation).toHaveBeenCalledWith('TATR', 'TATR_0001', { status_note: 'No cameras left' }))
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ actions: ['Revision', 'Desinstallation', 'Archive'], camera_status: 'OK' }) // the state the camera was found in
  })

  it('takes the camera away and keeps the location active: no Archive, nor a reason asked', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'Yes, I see it' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'OK' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Take it away' }))
    expect(screen.queryByLabelText('Why is it archived?')).not.toBeInTheDocument()
    await openSection('SD card'); await openSection('Camera')
    await userEvent.type(screen.getByLabelText('Photos on the card collected'), '24')
    await addVisit()

    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalledTimes(1))
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ actions: ['Revision', 'Desinstallation'] })
    expect(mockedApi.updateLocalLocation).not.toHaveBeenCalled()
  })

  it('keeps only the theft when nothing is done after it yet — and does not ask to choose', async () => {
    withCamera()
    mockedApi.saveVisit.mockResolvedValue({} as never)
    await start()

    await userEvent.click(await screen.findByRole('radio', { name: 'No, it was stolen' }))
    expect(screen.getByRole('radio', { name: 'Nothing yet' })).toBeChecked()
    await addVisit()

    await waitFor(() => expect(mockedApi.saveVisit).toHaveBeenCalledTimes(1))
    expect(mockedApi.saveVisit.mock.calls[0][1]).toMatchObject({ actions: ['Stolen'] })
    expect(mockedApi.updateLocalLocation).not.toHaveBeenCalled()
  })

  it('does not offer an archived location', async () => {
    mockedApi.listLocalLocations.mockResolvedValue({ results: [location('TATR_0001', { name: 'Ridge', latitude: 49.2, longitude: 20.1 }), location('TATR_0002', { status: 'archived' })] })
    render(<VisitsPage onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^by hand/i }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'TATR — Tatra' }))
    await userEvent.click(await screen.findByLabelText('Location'))

    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['TATR_0001 — Ridge'])
  })
})

