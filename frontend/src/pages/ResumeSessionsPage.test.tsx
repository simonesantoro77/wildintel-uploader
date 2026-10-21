import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import ResumeSessionsPage from './ResumeSessionsPage'
import { READY_SESSION, SELECTED_SESSION, SESSION } from '../test/fixtures'

vi.mock('../api', () => ({ api: { discardSession: vi.fn() } }))

describe('ResumeSessionsPage', () => {
  it('shows a scanned-only session by its source folder', () => {
    render(<ResumeSessionsPage sessions={[SESSION]} onResume={vi.fn()} onDiscarded={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.getByText('Process deployment: /home/me/DONA_01')).toBeInTheDocument()
    expect(screen.getByText('Source folder scanned')).toBeInTheDocument()
    expect(screen.queryByText('Research project')).not.toBeInTheDocument()
  })

  it('shows what a session with a chosen location had picked, and resumes or discards it', async () => {
    const onResume = vi.fn()
    const onDiscarded = vi.fn()
    vi.mocked(api.discardSession).mockResolvedValue({ status: 'discarded' })
    render(<ResumeSessionsPage sessions={[SELECTED_SESSION]} onResume={onResume} onDiscarded={onDiscarded} onSkip={vi.fn()} />)

    expect(screen.getByText('Process deployment: DONA_01')).toBeInTheDocument()
    expect(screen.getByText('Doñana')).toBeInTheDocument()
    expect(screen.getByText('Project and location chosen')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    expect(onResume).toHaveBeenCalledWith(SELECTED_SESSION)

    await userEvent.click(screen.getByRole('button', { name: /discard/i }))
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledWith('task-1'))
  })

  it('shows the deployment id once the run got that far', () => {
    render(<ResumeSessionsPage sessions={[READY_SESSION]} onResume={vi.fn()} onDiscarded={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.getByText('Process deployment: DONA-DONA_01')).toBeInTheDocument()
    expect(screen.getByText('Ready to import')).toBeInTheDocument()
  })

  it('lets the user skip and start a new run instead', async () => {
    const onSkip = vi.fn()
    render(<ResumeSessionsPage sessions={[SESSION]} onResume={vi.fn()} onDiscarded={vi.fn()} onSkip={onSkip} />)
    await userEvent.click(screen.getByRole('button', { name: /start a new run instead/i }))
    expect(onSkip).toHaveBeenCalled()
  })
})
