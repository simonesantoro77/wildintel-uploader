import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WelcomePage from './WelcomePage'

describe('WelcomePage', () => {
  it('says what the app does and starts the flow', async () => {
    const onStart = vi.fn()
    render(<WelcomePage onStart={onStart} />)

    expect(screen.getByText('1 · Field records')).toBeInTheDocument()
    expect(screen.getByText('5 · Upload to Trapper')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(onStart).toHaveBeenCalled()
  })
})
