import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import SetupWizardPage from './SetupWizardPage'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), listResearchProjects: vi.fn(), saveResearchProject: vi.fn(), setupTrappers: vi.fn(), setupRoles: vi.fn(), saveLocalLocation: vi.fn(), setupFieldItems: vi.fn(), setDefaultResearchProject: vi.fn(), setDataDir: vi.fn(), browseFolder: vi.fn() } }))
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getSettings.mockResolvedValue({ FIELDWORK: { trappers: [] }, DATA: { dir: '/home/ana/wildintel-uploader' } } as never)
  mocked.setDataDir.mockResolvedValue({ dir: '/data/wild' })
  mocked.listResearchProjects.mockResolvedValue({ results: [] } as never)
  mocked.saveResearchProject.mockResolvedValue({} as never)
  mocked.setupTrappers.mockResolvedValue({ added: ['ana'], skipped: [] })
  mocked.setupRoles.mockResolvedValue({ added: [['Ana Pérez', 'contributor']] })
  mocked.saveLocalLocation.mockResolvedValue({} as never)
  mocked.setupFieldItems.mockResolvedValue({ added: ['CAM-001'], skipped: [] })
  mocked.setDefaultResearchProject.mockResolvedValue({ default_research_project: 'DONA' })
})

const next = () => userEvent.click(screen.getByRole('button', { name: /^Continue|^Review/ }))
const skip = async () => userEvent.click(await screen.findByRole('button', { name: 'Skip this step' }))

async function project() {
  await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
  await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
  if (!screen.queryByRole('button', { name: /^Configure optional entities/ })) {   // with the first research project, the data folder comes first: kept as it is
    await next()
    await screen.findByLabelText('Data folder')
  }
  await userEvent.click(await screen.findByRole('button', { name: /^Configure optional entities/ }))
}

describe('SetupWizardPage', () => {
  it('asks for the research project first and will not go on while its acronym is not valid', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Continue/ })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Acronym *'), 'a b')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    expect(screen.getByRole('button', { name: /^Continue/ })).toBeDisabled()
    expect(screen.getByText(/Only letters, digits/)).toBeInTheDocument()
  })

  it('collects everything without keeping anything, says what is going to be done, does it and says what was done', async () => {
    const onRegisterVisit = vi.fn(), onBack = vi.fn(), onMainMenu = vi.fn()
    render(<SetupWizardPage onBack={onBack} onMainMenu={onMainMenu} onRegisterVisit={onRegisterVisit} />)
    await project()

    await userEvent.type(await screen.findByLabelText('Username *'), 'ana')
    await userEvent.type(screen.getByLabelText('Full name *'), 'Ana Pérez')
    await userEvent.click(screen.getByRole('button', { name: 'Add the trapper' }))
    expect(screen.getByRole('list', { name: 'The trappers entered' })).toHaveTextContent('Ana Pérez')
    await next()

    await userEvent.click(await screen.findByRole('button', { name: 'Add the role' }))
    await next()

    await userEvent.type(await screen.findByLabelText('Location id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    await next()

    await userEvent.type(await screen.findByLabelText('Label *'), 'CAM-001')
    await userEvent.click(screen.getByRole('button', { name: 'Add the camera' }))
    await next()
    await skip()   // the SD cards

    // the review: nothing was kept yet
    const plan = await screen.findByRole('table', { name: 'Plan' })
    expect(plan).toHaveTextContent('DONA — Doñana')
    expect(plan).toHaveTextContent('Ana Pérez · Contributor')
    expect(plan).toHaveTextContent('DONA_01')
    expect(mocked.saveResearchProject).not.toHaveBeenCalled()
    expect(mocked.setupTrappers).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Create it' }))

    expect(await screen.findByText('The initial setup is done')).toBeInTheDocument()
    expect(mocked.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ acronym: 'DONA', name: 'Doñana' }))
    expect(mocked.setupTrappers).toHaveBeenCalledWith([{ username: 'ana', name: 'Ana Pérez', affiliation: undefined, email: undefined }])
    expect(mocked.setupRoles).toHaveBeenCalledWith('DONA', [{ trapper: 'Ana Pérez', role: 'contributor' }])
    expect(mocked.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_01', latitude: 37.1, longitude: -6.5, timezone: 'UTC', status: 'pending' }))
    expect(mocked.setupFieldItems).toHaveBeenCalledWith('DONA', 'cameras', [{ label: 'CAM-001', camera_id: undefined, camera_model: undefined }])
    expect(mocked.setDefaultResearchProject).toHaveBeenCalledWith('DONA')
    const summary = screen.getByRole('table', { name: 'Summary' })
    expect(summary).toHaveTextContent('DONA created')
    expect(summary).toHaveTextContent('Trappers addedAna Pérez')
    expect(summary).toHaveTextContent('Locations addedDONA_01')

    await userEvent.click(screen.getByRole('button', { name: 'Register the first visit' }))
    expect(onRegisterVisit).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back to Utilities' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back to the main menu' }))
    expect(onBack).toHaveBeenCalled(); expect(onMainMenu).toHaveBeenCalled()
  })

  it('leaves as it is a research project that is kept already, and says the things that could not be kept', async () => {
    mocked.listResearchProjects.mockResolvedValue({ results: [{ acronym: 'dona', name: 'Old' }] } as never)
    mocked.saveLocalLocation.mockRejectedValue(new Error('The location DONA_01 is kept already.'))
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    await skip(); await next()   // trappers; and there is no one for the roles
    await userEvent.type(await screen.findByLabelText('Location id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    await next(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    expect(await screen.findByText('The initial setup is done, with some problems')).toBeInTheDocument()
    expect(mocked.saveResearchProject).not.toHaveBeenCalled()
    expect(screen.getByRole('table', { name: 'Summary' })).toHaveTextContent('DONA was kept already — left as it is')
    expect(screen.getByRole('list', { name: 'Problems' })).toHaveTextContent('DONA_01: The location DONA_01 is kept already.')
  })

  it('stops when the research project cannot be kept: nothing hangs from it', async () => {
    mocked.saveResearchProject.mockRejectedValue(new Error('The collections folder cannot be written.'))
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    await userEvent.type(await screen.findByLabelText('Username *'), 'ana')
    await userEvent.type(screen.getByLabelText('Full name *'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Add the trapper' }))
    await next(); await next(); await skip(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    expect(await screen.findByText('The research project could not be kept')).toBeInTheDocument()
    expect(mocked.setupTrappers).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the review' }))
    expect(await screen.findByRole('button', { name: 'Create it' })).toBeInTheDocument()
  })

  it('imports the trappers from a CSV file and lets one that was entered be taken out', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    const csv = new File(['username,full name,affiliation\nana,Ana Pérez,UHU\nluis,Luis,\n,Nobody,\n'], 'trappers.csv', { type: 'text/csv' })
    await userEvent.upload(await screen.findByLabelText('CSV file of trappers'), csv)

    expect(await screen.findByText('2 trappers entered from trappers.csv.')).toBeInTheDocument()
    expect(screen.getByText(/Row 4: no username/)).toBeInTheDocument()
    expect(mocked.setupTrappers).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Luis' }))
    expect(screen.getByRole('list', { name: 'The trappers entered' })).not.toHaveTextContent('Luis')
  })

  it('refuses a site with coordinates out of range, and one entered twice', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project(); await skip(); await next()
    await userEvent.type(await screen.findByLabelText('Location id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '95')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The coordinates must lie within')

    await userEvent.clear(screen.getByLabelText('Latitude *'))
    await userEvent.type(screen.getByLabelText('Latitude *'), '37')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    await userEvent.type(screen.getByLabelText('Location id *'), 'dona_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is a location dona_01 already.')
  })

  it('asks whether the cameras of a site ignore summer time — not when the timezone is UTC, which has none', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project(); await skip(); await next()
    const ignore = await screen.findByLabelText(/The cameras here ignore summer time/)
    expect(ignore).toBeDisabled()                                   // UTC, the default
    expect(screen.getByText('Summer time is not applied in UTC.')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Timezone *'))
    await userEvent.type(screen.getByLabelText('Timezone *'), 'Europe/Madrid')
    expect(ignore).toBeEnabled()
    await userEvent.click(ignore)
    await userEvent.type(screen.getByLabelText('Location id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the location' }))
    await next(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    await screen.findByText('The initial setup is done')
    expect(mocked.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_01', timezone: 'Europe/Madrid', ignore_dst: true }))
  })

  it('asks for the data folder after the research project: keeping the current one changes nothing, another is kept before the project', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await next()
    await waitFor(() => expect(screen.getByLabelText('Data folder')).toHaveValue('/home/ana/wildintel-uploader'))   // the one the app proposes, already there

    await userEvent.clear(screen.getByLabelText('Data folder'))
    expect(screen.getByRole('button', { name: /^Finish setup/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Configure optional entities/ })).toBeDisabled()   // a folder is needed
    await userEvent.type(screen.getByLabelText('Data folder'), 'relative/folder')
    expect(screen.getByText('An absolute path (or one starting with ~).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Finish setup/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Configure optional entities/ })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Data folder'))
    await userEvent.type(screen.getByLabelText('Data folder'), '/data/wild')
    await userEvent.click(screen.getByRole('button', { name: /^Configure optional entities/ }))
    await skip(); await next()   // trappers; and there is no one for the roles
    await skip(); await skip(); await skip()   // locations, cameras, cards
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    expect(await screen.findByText('The initial setup is done')).toBeInTheDocument()
    expect(mocked.setDataDir).toHaveBeenCalledWith('/data/wild')
    expect(mocked.setDataDir.mock.invocationCallOrder[0]).toBeLessThan(mocked.saveResearchProject.mock.invocationCallOrder[0])
    expect(screen.getByRole('table', { name: 'Summary' })).toHaveTextContent('Data folder/data/wild')
  })

  it('does not touch the data folder when it is left as it is', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    await skip(); await next()
    await skip(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))
    await screen.findByText('The initial setup is done')
    expect(mocked.setDataDir).not.toHaveBeenCalled()
  })

  it('says that the research project and the data folder are required, and no other step', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    expect(screen.getAllByText('Required')).toHaveLength(2)
    for (const title of [/The research project/, /The data folder/]) expect(screen.getByRole('heading', { name: title }).parentElement).toHaveTextContent('Required')
  })

  it('lets the optional steps be skipped from the data folder: it goes to the review, and nothing optional is kept', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await next()
    await screen.findByLabelText('Data folder')
    expect(screen.getByText(/Steps 3–7 are optional/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Finish setup/ }))

    expect(await screen.findByRole('table', { name: 'Plan' })).toHaveTextContent('Data folder/home/ana/wildintel-uploader')
    await userEvent.click(screen.getByRole('button', { name: 'Create it' }))
    expect(await screen.findByText('The initial setup is done')).toBeInTheDocument()
    expect(mocked.saveResearchProject).toHaveBeenCalledTimes(1)
    for (const call of [mocked.setupTrappers, mocked.setupRoles, mocked.saveLocalLocation, mocked.setupFieldItems, mocked.setDataDir]) expect(call).not.toHaveBeenCalled()
  })

  it('goes back from the review to where it came from: the data folder when the optional steps were skipped, the last of them when they were not', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await next()
    await screen.findByLabelText('Data folder')
    await userEvent.click(screen.getByRole('button', { name: /^Finish setup/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Data folder')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Configure optional entities/ }))
    await skip(); await next()
    await skip(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('button', { name: 'Skip this step' })).toBeInTheDocument()   // the SD cards, the last of the optional steps
  })

  it('says of each optional step that it is optional, and where else it can be given', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    expect(screen.getByRole('heading', { name: 'The trappers' }).parentElement).toHaveTextContent('Optional · From visits CSV or Settings')
    expect(screen.getAllByText(/^Optional · /)).toHaveLength(5)
    expect(screen.getByRole('heading', { name: 'Their roles in the research project' }).parentElement).toHaveTextContent('Optional · In Settings')
    expect(screen.queryByText('Required')).not.toBeInTheDocument()   // the research project and the data folder are done
  })

  it('does not ask for the data folder when there are research projects already: it is the same for all of them', async () => {
    mocked.listResearchProjects.mockResolvedValue({ results: [{ acronym: 'TATR' }] } as never)
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')

    expect(await screen.findByText(/the same for every research project/)).toHaveTextContent('/home/ana/wildintel-uploader')
    expect(screen.queryByLabelText('Data folder')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'The data folder' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Configure optional entities \(2–6\)/ })).toBeInTheDocument()   // the steps are numbered without it
    await userEvent.click(screen.getByRole('button', { name: /^Finish setup/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    expect(await screen.findByText('The initial setup is done')).toBeInTheDocument()
    expect(mocked.setDataDir).not.toHaveBeenCalled()
    expect(mocked.saveResearchProject).toHaveBeenCalledTimes(1)
  })

  it('opens again a step already passed, with what was entered, until the setup is made: the review comes back after going through the steps', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await next()
    await screen.findByLabelText('Data folder')
    await userEvent.click(screen.getByRole('button', { name: /^Finish setup/ }))
    expect(await screen.findByRole('table', { name: 'Plan' })).toHaveTextContent('DONA — Doñana')

    await userEvent.click(screen.getByRole('button', { name: 'Edit The research project' }))
    expect(screen.queryByRole('table', { name: 'Plan' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Acronym *')).toHaveValue('DONA')   // what was entered is there
    await userEvent.clear(screen.getByLabelText('Name *'))
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana Park')
    await next()
    await userEvent.click(await screen.findByRole('button', { name: /^Finish setup/ }))

    expect(await screen.findByRole('table', { name: 'Plan' })).toHaveTextContent('DONA — Doñana Park')
    await userEvent.click(screen.getByRole('button', { name: 'Create it' }))
    await screen.findByText('The initial setup is done')
    expect(mocked.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Doñana Park' }))
    expect(screen.queryByRole('button', { name: 'Edit The research project' })).not.toBeInTheDocument()   // once it is made, it is not changed from here
  })

  it('opens again an optional step passed, and keeps what it had', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await project()
    await skip(); await next()   // trappers; and there is no one for the roles
    await userEvent.click(await screen.findByRole('button', { name: 'Edit The trappers' }))
    expect(await screen.findByLabelText('Username *')).toBeInTheDocument()
    expect(screen.queryByLabelText('Location id *')).not.toBeInTheDocument()   // the ones after it wait again
  })

  it('says Skipped, not Completed, of an optional step that was left out', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await next()
    await screen.findByLabelText('Data folder')
    await userEvent.click(screen.getByRole('button', { name: /^Finish setup/ }))
    await screen.findByRole('table', { name: 'Plan' })

    expect(screen.getAllByText('Skipped')).toHaveLength(5)   // the trappers, the roles, the locations, the cameras and the SD cards
    expect(screen.getAllByText('Completed')).toHaveLength(2)   // the research project and the data folder
  })
})
