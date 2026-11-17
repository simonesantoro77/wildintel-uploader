import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import SetupWizardPage from './SetupWizardPage'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), saveResearchProject: vi.fn(), setupTrappers: vi.fn(), setupRoles: vi.fn(), saveLocalLocation: vi.fn(), setupFieldItems: vi.fn() } }))
const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getSettings.mockResolvedValue({ FIELDWORK: { trappers: [] } } as never)
  mocked.saveResearchProject.mockResolvedValue({} as never)
  mocked.setupTrappers.mockResolvedValue({ added: ['ana'], skipped: [] })
  mocked.setupRoles.mockResolvedValue({ added: [] })
  mocked.saveLocalLocation.mockResolvedValue({} as never)
  mocked.setupFieldItems.mockResolvedValue({ added: ['x'], skipped: [] })
})

const form = (name: string) => within(screen.getByRole('form', { name }))

describe('SetupWizardPage', () => {
  it('asks for the research project first and will not go on while its acronym is not valid', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    const keep = screen.getByRole('button', { name: /Keep it and continue/ })
    expect(keep).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Acronym *'), 'a b')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    expect(keep).toBeDisabled()
    expect(screen.getByText(/Only letters, digits/)).toBeInTheDocument()
  })

  it('goes through the steps, keeping each thing as it is added, and says what was set up', async () => {
    const onBack = vi.fn()
    render(<SetupWizardPage onBack={onBack} />)

    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await userEvent.click(screen.getByRole('button', { name: /Keep it and continue/ }))
    expect(mocked.saveResearchProject).toHaveBeenCalledWith(expect.objectContaining({ acronym: 'DONA', name: 'Doñana' }))

    await userEvent.type(await screen.findByLabelText('Username *'), 'ana')
    await userEvent.type(screen.getByLabelText('Full name *'), 'Ana Pérez')
    await userEvent.click(screen.getByRole('button', { name: 'Add the trapper' }))
    expect(mocked.setupTrappers).toHaveBeenCalledWith([{ username: 'ana', name: 'Ana Pérez', affiliation: undefined, email: undefined }])
    expect(await screen.findByRole('list', { name: 'The trappers added' })).toHaveTextContent('Ana Pérez')
    await userEvent.click(screen.getByRole('button', { name: /^Continue/ }))

    await userEvent.click(await screen.findByRole('button', { name: 'Add the role' }))
    expect(mocked.setupRoles).toHaveBeenCalledWith('DONA', [{ trapper: 'Ana Pérez', role: 'contributor' }])
    await userEvent.click(screen.getByRole('button', { name: /^Continue/ }))

    await userEvent.type(await screen.findByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '37.1')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))
    expect(mocked.saveLocalLocation).toHaveBeenCalledWith('DONA', expect.objectContaining({ location_id: 'DONA_01', latitude: 37.1, longitude: -6.5, timezone: 'UTC' }))
    await userEvent.click(screen.getByRole('button', { name: /^Continue/ }))

    await userEvent.type(await screen.findByLabelText('Label *'), 'CAM-001')
    await userEvent.click(screen.getByRole('button', { name: 'Add the camera' }))
    expect(mocked.setupFieldItems).toHaveBeenCalledWith('DONA', 'cameras', [{ label: 'CAM-001', camera_id: undefined, camera_model: undefined }])
    await userEvent.click(screen.getByRole('button', { name: /^Continue/ }))

    await userEvent.click(await screen.findByRole('button', { name: 'Skip, I will do it later' }))
    expect(await screen.findByText(/is set up: 1 trappers, 1 roles, 1 sites, 1 cameras and 0 SD cards/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to Utilities' }))
    expect(onBack).toHaveBeenCalled()
    void form
  })

  it('says why a site is not kept when the coordinates are out of range', async () => {
    render(<SetupWizardPage onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Acronym *'), 'DONA')
    await userEvent.type(screen.getByLabelText('Name *'), 'Doñana')
    await userEvent.click(screen.getByRole('button', { name: /Keep it and continue/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Skip, I will do it later' }))   // trappers
    await userEvent.click(await screen.findByRole('button', { name: /^Continue/ }))                    // no one to give a role to

    await userEvent.type(await screen.findByLabelText('Site id *'), 'DONA_01')
    await userEvent.type(screen.getByLabelText('Latitude *'), '95')
    await userEvent.type(screen.getByLabelText('Longitude *'), '-6.5')
    await userEvent.click(screen.getByRole('button', { name: 'Add the site' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The coordinates must lie within')
    expect(mocked.saveLocalLocation).not.toHaveBeenCalled()
  })
})
