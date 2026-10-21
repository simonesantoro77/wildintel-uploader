import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from './api'
import App from './App'
import type { SessionSummary } from './types'

vi.mock('./api', () => ({ api: { checkHealth: vi.fn(), checkVersion: vi.fn(), listSessions: vi.fn() } }))

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
})

const getStarted = async () => userEvent.click(await screen.findByRole('button', { name: 'Get Started' }))
const title = () => screen.findByRole('button', { name: /WildINTEL Uploader\s*v0\.1\.0/ })

describe('App', () => {
  it('goes back to the welcome screen when the title is pressed, from wherever you are', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /upload to trapper/i }))
    expect(await screen.findByText(/Upload page — nothing chosen/)).toBeInTheDocument()

    await userEvent.click(await title())

    expect(await screen.findByRole('button', { name: 'Get Started' })).toBeInTheDocument()
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

    expect(await screen.findByRole('button', { name: 'Get Started' })).toBeInTheDocument()
    await getStarted()
    expect(await screen.findByRole('heading', { name: 'Unfinished run' })).toBeInTheDocument()
  })

  it('takes a finished import to the upload page, on the collection it went into', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /process deployment/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'finish the import' }))

    expect(await screen.findByText('Upload page — DONA / R0003')).toBeInTheDocument()
  })

  it('opens the upload page empty when it is chosen from the menu, whatever was imported before', async () => {
    render(<App />)
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /process deployment/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'finish the import' }))
    await userEvent.click(await title())
    await getStarted()
    await userEvent.click(await screen.findByRole('button', { name: /upload to trapper/i }))

    expect(await screen.findByText('Upload page — nothing chosen')).toBeInTheDocument()
  })
})
