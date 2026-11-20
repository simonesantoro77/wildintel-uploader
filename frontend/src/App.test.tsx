import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from './api'
import App from './App'
import type { SessionSummary } from './types'

vi.mock('./api', () => ({ api: { checkHealth: vi.fn(), checkVersion: vi.fn(), listSessions: vi.fn(), listResearchProjects: vi.fn(), getSettings: vi.fn() } }))
vi.mock('./pages/SetupWizardPage', () => ({ default: ({ onRegisterVisit }: { onRegisterVisit?: () => void }) => <><p>the initial setup</p><button type="button" onClick={onRegisterVisit}>register the first visit</button></> }))
vi.mock('./pages/VisitsHomePage', () => ({ default: ({ startBook }: { startBook?: boolean }) => <p>visits — {startBook ? 'dashboard' : 'register'}</p> }))
vi.mock('./pages/ImportDeploymentsPage', () => ({
  default: ({ onUpload }: { onUpload?: (t: { researchProjectId: string; collection: string }) => void }) => (
    <button type="button" onClick={() => onUpload?.({ researchProjectId: 'DONA', collection: 'R0003' })}>finish the import</button>
  ),
}))
vi.mock('./pages/StatisticsPage', () => ({ default: () => <p>the statistics</p> }))
vi.mock('./pages/DeploymentStatusPage', () => ({ default: () => <p>the deployments dashboard</p> }))
vi.mock('./pages/UploadStatusPage', () => ({ default: () => <p>the uploads dashboard</p> }))

// The pages are stand-ins: what is looked at is how the app moves between them.
vi.mock('./pages/ImportDeploymentPage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pages/ImportDeploymentPage')>()),
  default: ({ onUpload }: { onUpload?: (t: { researchProjectId: string; collection: string }) => void }) => (
    <button type="button" onClick={() => onUpload?.({ researchProjectId: 'DONA', collection: 'R0003' })}>finish the import</button>
  ),
}))
vi.mock('./pages/UploadDeploymentPage', () => ({
  default: ({ initial }: { initial?: { researchProjectId: string; collection: string } }) => (
    <p>Upload page — {initial ? `${initial.researchProjectId} / ${initial.collection}` : 'nothing chosen'}</p>
  ),
}))

const mockedApi = vi.mocked(api)

const UNFINISHED = [{ task_id: 't1', task: 'deployment', phase: 'scanned', created_at: '2026-01-01T00:00:00Z', source_dir: '/x', scan: {} }] as unknown as SessionSummary[]

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.checkHealth.mockResolvedValue(true)
  mockedApi.checkVersion.mockResolvedValue({ current: '0.1.0' } as Awaited<ReturnType<typeof api.checkVersion>>)
  mockedApi.listSessions.mockResolvedValue([])
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ acronym: 'DONA', name: 'Doñana' }] } as never)
  mockedApi.getSettings.mockResolvedValue({ GENERAL: {} } as never)
})

// Get started when there is no research project, or when it cannot be told; with one, the button to go on with it
const getStarted = async () => userEvent.click(await screen.findByRole('button', { name: /^(get started|continue)/i }))
const title = () => screen.findByRole('button', { name: 'Go to the welcome screen' })

describe('App', () => {
  it('starts with the initial setup when there is no research project', async () => {
    mockedApi.listResearchProjects.mockResolvedValue({ results: [] } as never)
    render(<App />)
    await getStarted()

    expect(await screen.findByText('the initial setup')).toBeInTheDocument()
    expect(screen.queryByText('What do you want to do?')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'register the first visit' }))   // the setup leads to Register visits
    expect(await screen.findByText('visits — register')).toBeInTheDocument()
  })

  it('opens on the menu, with no welcome page, when it is turned off in the settings — and the title goes to the menu', async () => {
    mockedApi.getSettings.mockResolvedValue({ GENERAL: { show_welcome: false } } as never)
    render(<App />)

    expect(await screen.findByText('What do you want to do?')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Do not show this page again' })).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /^register the visits/i }))
    await userEvent.click(await title())
    expect(await screen.findByText('What do you want to do?')).toBeInTheDocument()      // not the welcome page
  })

  it('starts the initial setup from the welcome screen when there is a research project too, with the button that creates a new one', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create a new research project' }))

    expect(await screen.findByText('the initial setup')).toBeInTheDocument()
    expect(screen.queryByText('What do you want to do?')).not.toBeInTheDocument()
  })

  it('opens each action and each dashboard from the menu, with no menu of its own between', async () => {
    render(<App />)
    await getStarted()

    await userEvent.click(await screen.findByRole('button', { name: /^register the visits/i }))
    expect(await screen.findByText('visits — register')).toBeInTheDocument()
    await userEvent.click(await title()); await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^dashboards and statistics/i }))   // folded away until opened
    await userEvent.click(await screen.findByRole('button', { name: /^visit dashboard/i }))
    expect(await screen.findByText('visits — dashboard')).toBeInTheDocument()
    await userEvent.click(await title()); await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^dashboards and statistics/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^deployments dashboard/i }))
    expect(await screen.findByText('the deployments dashboard')).toBeInTheDocument()
    await userEvent.click(await title()); await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^dashboards and statistics/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^uploads dashboard/i }))
    expect(await screen.findByText('the uploads dashboard')).toBeInTheDocument()
    await userEvent.click(await title()); await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^dashboards and statistics/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^statistics/i }))
    expect(await screen.findByText('the statistics')).toBeInTheDocument()
  })

  it('goes to the menu when there are research projects, or when they cannot be told', async () => {
    render(<App />)
    await getStarted()
    expect(await screen.findByText('What do you want to do?')).toBeInTheDocument()

    await userEvent.click(await title())
    mockedApi.listResearchProjects.mockRejectedValue(new Error('down'))
    await getStarted()
    expect(await screen.findByText('What do you want to do?')).toBeInTheDocument()
  })

  it('goes back to the welcome screen when the title is pressed, from wherever you are', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^upload the images/i }))
    expect(await screen.findByText(/Upload page — nothing chosen/)).toBeInTheDocument()

    await userEvent.click(await title())

    expect(await screen.findByRole('button', { name: /^(get started|continue)/i })).toBeInTheDocument()
    expect(screen.queryByText(/Upload page/)).not.toBeInTheDocument()
    expect(screen.queryByText('What do you want to do?')).not.toBeInTheDocument()
  })

  it('goes on to the menu from the welcome screen reached again', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await title())
    await getStarted()
    expect(await screen.findByText('What do you want to do?')).toBeInTheDocument()
  })

  it('shows the welcome screen, not the unfinished sessions, when the title is pressed — and the sessions after Get Started', async () => {
    mockedApi.listSessions.mockResolvedValue(UNFINISHED)
    render(<App />)
    await userEvent.click(await title()) // the sessions are offered first when the app starts

    expect(await screen.findByRole('button', { name: /^(get started|continue)/i })).toBeInTheDocument()
    await getStarted()
    expect(await screen.findByRole('heading', { name: 'Unfinished run' })).toBeInTheDocument()
  })

  it('takes a finished import to the upload page, on the collection it went into', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^import the images/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'finish the import' }))

    expect(await screen.findByText('Upload page — DONA / R0003')).toBeInTheDocument()
  })

  it('opens the upload page empty when it is chosen from the menu, whatever was imported before', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^import the images/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'finish the import' }))
    await userEvent.click(await title())
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /^upload the images/i }))

    expect(await screen.findByText('Upload page — nothing chosen')).toBeInTheDocument()
  })
})
