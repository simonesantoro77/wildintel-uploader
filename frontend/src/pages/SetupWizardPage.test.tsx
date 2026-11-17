import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import SetupWizardPage from './SetupWizardPage'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), listResearchProjects: vi.fn(), saveResearchProject: vi.fn(), setupTrappers: vi.fn(), setupRoles: vi.fn(), saveLocalLocation: vi.fn(), setupFieldItems: vi.fn(), setDefaultResearchProject: vi.fn() } }))
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getSettings.mockResolvedValue({ FIELDWORK: { trappers: [] } } as never)
  mocked.listResearchProjects.mockResolvedValue({ results: [] } as never)
  mocked.saveResearchProject.mockResolvedValue({} as never)
  mocked.setupTrappers.mockResolvedValue({ added: ['ana'], skipped: [] })
  mocked.setupRoles.mockResolvedValue({ added: [['Ana Pérez', 'contributor']] })
  mocked.saveLocalLocation.mockResolvedValue({} as never)
  mocked.setupFieldItems.mockResolvedValue({ added: ['CAM-001'], skipped: [] })
  mocked.setDefaultResearchProject.mockResolvedValue({ default_research_project: 'DONA' })
})

const next = () => userEvent.click(screen.getByRole('button', { name: /^Continue|^Review/ }))
const skip = async () => userEvent.click(await screen.findByRole('button', { name: 'Skip, I will do it later' }))

async function project() {
  await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
  await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
  await next()
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

    await userEvent.type(await screen.findByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
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
    expect(summary).toHaveTextContent('Sites addedDONA_01')

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
    await userEvent.type(await screen.findByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
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
    await userEvent.type(await screen.findByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '95')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The coordinates must lie within')

    await userEvent.clear(screen.getByLabelText('Latitude *'))
    await userEvent.type(screen.getByLabelText('Latitude *'), '37')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
    await userEvent.type(screen.getByLabelText('Site id *'), 'dona_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is a site dona_01 already.')
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
    await userEvent.type(screen.getByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
    await next(); await skip(); await skip()
    await userEvent.click(await screen.findByRole('button', { name: 'Create it' }))

    await screen.findByText('The initial setup is done')
    expect(mocked.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_01', timezone: 'Europe/Madrid', ignore_dst: true }))
  })
})
