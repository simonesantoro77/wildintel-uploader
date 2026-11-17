import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import { APP_SETTINGS } from '../test/fixtures'
import WelcomePage from './WelcomePage'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), trapperTestConnection: vi.fn(), trapperGetConfig: vi.fn() } }))

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue({ ...APP_SETTINGS, GENERAL: { ...APP_SETTINGS.GENERAL, default_research_project: 'WICP_01' } })
  vi.mocked(api.trapperTestConnection).mockResolvedValue({ ok: true, research_projects_count: 3 })
  vi.mocked(api.trapperGetConfig).mockResolvedValue({ base_url: 'https://trap.example.org/', user_name: 'alice', has_password: true })
})

describe('WelcomePage', () => {
  it('says what the app does, with a line for each task, and starts the flow', async () => {
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} />)

    for (const title of ['Manage visits', 'Manage deployments', 'Manage uploads']) expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(/see how far the uploads are/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(onStart).toHaveBeenCalled()
  })

  it('says which Trapper it is connected to and the default project', async () => {
    render(<WelcomePage onStart={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Connected to trap.example.org\s*·\s*Default project WICP_01/))
  })

  it('leaves out the connection when Trapper can not be reached', async () => {
    vi.mocked(api.trapperTestConnection).mockRejectedValue(new Error('no'))
    render(<WelcomePage onStart={vi.fn()} />)

    expect(await screen.findByRole('status')).toHaveTextContent('Default project WICP_01')
    expect(screen.queryByText(/Connected to/)).not.toBeInTheDocument()
  })
})
