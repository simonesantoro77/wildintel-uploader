import { renderWithHeader } from '../test/renderWithHeader'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UtilsPage from './UtilsPage'

vi.mock('./RepairPage', () => ({ default: ({ onBack }: { onBack: () => void }) => <><p>the repair page</p><button onClick={onBack}>Back</button></> }))
vi.mock('./SyncCollectionsPage', () => ({ default: ({ onBack }: { onBack: () => void }) => <><p>the sync page</p><button onClick={onBack}>Back</button></> }))

describe('UtilsPage', () => {
  it('offers to repair the local deployments and to sync the local collections', () => {
    render(<UtilsPage onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: /repair local deployments/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /sync local collections/i })).toBeEnabled()
  })

  it('opens the one chosen, and goes back to the list from it', async () => {
    render(<UtilsPage onBack={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /repair local deployments/i }))
    expect(screen.getByText('the repair page')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: /sync local collections/i }))
    expect(screen.getByText('the sync page')).toBeInTheDocument()
  })

  it('goes back to the menu from the list', async () => {
    const onBack = vi.fn()
    render(<UtilsPage onBack={onBack} />)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('has the header of the other pages: the way back to the menu, the icon, the title and the active research project', async () => {
    const onBack = vi.fn()
    renderWithHeader(<UtilsPage onBack={onBack} />)

    expect(screen.getByRole('navigation', { name: 'You are here' })).toHaveTextContent('Menu›Utilities')
    expect(screen.getByRole('heading', { name: 'Utilities' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('offers backup and restore too', () => {
    render(<UtilsPage onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: /backup and restore/i })).toBeEnabled()
  })
})

