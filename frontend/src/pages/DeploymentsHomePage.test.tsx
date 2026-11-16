import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DeploymentsHomePage from './DeploymentsHomePage'

describe('DeploymentsHomePage', () => {
  it('offers to import a deployment, to import one or several from their visits, or to show the status of the deployments', async () => {
    const onChoose = vi.fn(), onBack = vi.fn()
    render(<DeploymentsHomePage onChoose={onChoose} onBack={onBack} />)

    expect(screen.getByRole('heading', { name: 'Manage deployments' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Organize a folder/ }))
    expect(onChoose).toHaveBeenLastCalledWith('import')
    await userEvent.click(screen.getByRole('button', { name: /Pick one or several closed visits/ }))
    expect(onChoose).toHaveBeenLastCalledWith('many')
    await userEvent.click(screen.getByRole('button', { name: /deployments dashboard/i }))
    expect(onChoose).toHaveBeenLastCalledWith('status')
    await userEvent.click(screen.getByRole('button', { name: /Compare the deployments of a revision/ }))
    expect(onChoose).toHaveBeenLastCalledWith('statistics')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
