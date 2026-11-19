import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import { APP_SETTINGS } from '../test/fixtures'
import WelcomePage from './WelcomePage'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), trapperTestConnection: vi.fn(), trapperGetConfig: vi.fn(), listResearchProjects: vi.fn(), setDefaultResearchProject: vi.fn() } }))

beforeEach(() => {
  vi.mocked(api.listResearchProjects).mockResolvedValue({ results: [{ acronym: 'WICP_01', name: 'Doñana' }] } as never)   // a research project is kept, unless a test says otherwise
  vi.mocked(api.getSettings).mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, default_research_project: 'WICP_01' } })
  vi.mocked(api.trapperTestConnection).mockResolvedValue({ ok: true, research_projects_count: 3 })
  vi.mocked(api.trapperGetConfig).mockResolvedValue({ base_url: 'https://trap.example.org/', user_name: 'alice', has_password: true })
})

describe('WelcomePage', () => {
  it('says what the app does — from the field to a curated, standard dataset — with its four points, and starts the flow', async () => {
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} onNewProject={vi.fn()} />)

    expect(screen.getByText(/From the field to a curated, standard dataset: field data and camera-trap images checked, curated and organized into deployments described in/)).toHaveTextContent('described in Camtrap DP, ready for the remote repository (e.g. TRAPPER).')
    expect(screen.getByText('Camtrap DP', { selector: 'strong' })).toBeInTheDocument()
    const points = screen.getAllByRole('listitem').slice(0, 4)
    expect(points.map((li) => li.querySelector('strong')?.textContent)).toEqual(['Validated', 'Traceable', 'Standard', 'Organized'])
    expect(points[1]).toHaveTextContent('Each deployment sealed with the checks it passed and a SHA-256 fingerprint of every image')
    expect(points[3]).toHaveTextContent('Hierarchically: research project › collection › deployment')

    await userEvent.click(await screen.findByRole('button', { name: 'Continue with WICP_01' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('has two buttons when there is a research project: to go on with the default one and to create a new one', async () => {
    const onStart = vi.fn()
    const onNewProject = vi.fn()
    render(<WelcomePage onStart={onStart} onNewProject={onNewProject} />)

    expect(await screen.findByRole('button', { name: 'Continue with WICP_01' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get started/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create a new research project' }))
    expect(onNewProject).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('has only Get started when there is no research project, and it goes to the initial setup', async () => {
    vi.mocked(api.listResearchProjects).mockResolvedValue({ results: [] } as never)
    const onStart = vi.fn()
    const onNewProject = vi.fn()
    render(<WelcomePage onStart={onStart} onNewProject={onNewProject} />)

    await userEvent.click(await screen.findByRole('button', { name: /get started/i }))
    expect(onNewProject).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create a new research project' })).not.toBeInTheDocument()
  })

  it('shows no button until it is known whether there is a research project, and goes on as Get started when it cannot be told', async () => {
    vi.mocked(api.listResearchProjects).mockRejectedValue(new Error('no'))
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} onNewProject={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /get started/i })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /get started/i }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('lists the research projects from the button to go on, marks the default one, and picking another makes it the one to continue with', async () => {
    vi.mocked(api.listResearchProjects).mockResolvedValue({ results: [
      { acronym: 'WICP_01', name: 'Sierra de Aracena', status: 'active' }, { acronym: 'DONA', name: 'Doñana Camtrap', status: 'active' }, { acronym: 'OLD', name: 'Finished', status: 'archived' },
    ] } as never)
    vi.mocked(api.setDefaultResearchProject).mockResolvedValue(undefined as never)
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} onNewProject={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Pick the research project' }))

    const list = screen.getByRole('listbox', { name: 'Research projects' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['✓WICP_01Default', 'DONADoñana Camtrap'])   // the ones that are worked on; the default one marked
    await userEvent.click(within(list).getByRole('option', { name: /DONA/ }))

    expect(api.setDefaultResearchProject).toHaveBeenCalledWith('DONA')
    expect(await screen.findByRole('button', { name: 'Continue with DONA' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue with DONA' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('says Continue when the research project has no default', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, default_research_project: '' } })
    render(<WelcomePage onStart={vi.fn()} onNewProject={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('says which Trapper it is connected to and the default project', async () => {
    render(<WelcomePage onStart={vi.fn()} onNewProject={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Connected to trap.example.org\s*·\s*Default project WICP_01/))
  })

  it('leaves out the connection when Trapper can not be reached', async () => {
    vi.mocked(api.trapperTestConnection).mockRejectedValue(new Error('no'))
    render(<WelcomePage onStart={vi.fn()} onNewProject={vi.fn()} />)

    expect(await screen.findByRole('status')).toHaveTextContent('Default project WICP_01')
    expect(screen.queryByText(/Connected to/)).not.toBeInTheDocument()
  })
})
