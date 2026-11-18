import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Navbar from './Navbar'

describe('Navbar', () => {
  it('takes you back to the welcome screen when the title is pressed', async () => {
    const onHome = vi.fn()
    render(<Navbar version="0.1.0" onHome={onHome} onOpenSettings={() => {}} settingsOpen={false} />)

    const title = screen.getByRole('button', { name: 'Go to the welcome screen' })
    expect(title).toHaveAttribute('title', 'Go to the welcome screen')
    expect(screen.getByText('WildINTEL Uploader')).toBeInTheDocument()
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
    await userEvent.click(title)

    expect(onHome).toHaveBeenCalledTimes(1)
  })

  it('has the logo — the lynx, which goes home — at the left of the title', () => {
    render(<Navbar version="0.1.0" onHome={() => {}} onOpenSettings={() => {}} settingsOpen={false} />)

    const home = screen.getByRole('button', { name: 'Go to the welcome screen' })
    expect(home.querySelector('img')).toHaveAttribute('src', '/logo.svg')
  })

  it('shows the title as the way home even without a version', async () => {
    const onHome = vi.fn()
    render(<Navbar version={null} onHome={onHome} onOpenSettings={() => {}} settingsOpen={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Go to the welcome screen' }))
    expect(onHome).toHaveBeenCalled()
  })
})

describe('Navbar language', () => {
  it('has a button that lists the languages and remembers the one chosen', async () => {
    localStorage.clear()
    render(<Navbar version={null} onHome={() => {}} onOpenSettings={() => {}} settingsOpen={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Language' }))
    const english = screen.getByRole('option', { name: /English/ })
    expect(english).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(english)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(localStorage.getItem('wildintel.language')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
