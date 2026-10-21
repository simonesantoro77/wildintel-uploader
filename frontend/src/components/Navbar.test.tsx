import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Navbar from './Navbar'

describe('Navbar', () => {
  it('takes you back to the menu when the title is pressed', async () => {
    const onHome = vi.fn()
    render(<Navbar version="0.1.0" onHome={onHome} onOpenSettings={() => {}} settingsOpen={false} />)

    const title = screen.getByRole('button', { name: /WildINTEL Uploader\s*v0\.1\.0/ })
    expect(title).toHaveAttribute('title', 'Go to the menu')
    await userEvent.click(title)

    expect(onHome).toHaveBeenCalledTimes(1)
  })

  it('shows the title as the way home even without a version', async () => {
    const onHome = vi.fn()
    render(<Navbar version={null} onHome={onHome} onOpenSettings={() => {}} settingsOpen={false} />)

    await userEvent.click(screen.getByRole('button', { name: /WildINTEL Uploader/ }))
    expect(onHome).toHaveBeenCalled()
  })
})
