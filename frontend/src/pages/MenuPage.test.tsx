import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MenuPage from './MenuPage'

const renderMenu = () => {
  const props = { onAction: vi.fn(), onDashboard: vi.fn(), onChoose: vi.fn() }
  render(<MenuPage {...props} />)
  return props
}

describe('MenuPage', () => {
  it('offers the actions one click away: register visits, create deployments and upload a deployment', async () => {
    const { onAction } = renderMenu()

    await userEvent.click(screen.getByRole('button', { name: /register visits/i }))
    await userEvent.click(screen.getByRole('button', { name: /create deployments/i }))
    await userEvent.click(screen.getByRole('button', { name: /upload deployment/i }))
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['register', 'import', 'upload'])
  })

  it('offers the actions in that order, and no longer the three Manage menus', () => {
    renderMenu()

    const titles = screen.getAllByRole('button').map((b) => b.textContent ?? '').map((t) => t.match(/Register visits|Create deployments|Upload deployment/)?.[0]).filter(Boolean)
    expect(titles).toEqual(['Register visits', 'Create deployments', 'Upload deployment'])
    for (const old of [/manage visits/i, /manage deployments/i, /manage uploads/i]) expect(screen.queryByRole('button', { name: old })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import collection/i })).not.toBeInTheDocument()
  })

  it('shows the typical workflow: register visits, create deployments and upload deployment, in that order', () => {
    renderMenu()
    const workflow = screen.getByRole('navigation', { name: 'Typical workflow' })

    expect(workflow).toHaveTextContent('Typical workflow')
    expect(within(workflow).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Register visits', '2Create deployments', '3Upload deployment'])
    expect(screen.getByText(/Who went, when, to which site and what was done\./)).toBeInTheDocument()   // the visits are not said to be by hand or from a file
    expect(screen.queryByText(/by hand or from a file/i)).not.toBeInTheDocument()
  })

  it('has a card with the dashboards and the statistics', async () => {
    const { onDashboard } = renderMenu()
    const card = screen.getByRole('region', { name: 'Dashboards and statistics' })
    const toggle = within(card).getByRole('button', { name: /Dashboards and statistics/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')                                       // folded away at first
    expect(within(card).queryByRole('button', { name: /^Visit dashboard/ })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    for (const name of ['Visit dashboard', 'Deployments dashboard', 'Uploads dashboard', 'Statistics']) await userEvent.click(within(card).getByRole('button', { name: new RegExp(`^${name}`) }))
    expect(onDashboard.mock.calls.map((c) => c[0])).toEqual(['visits', 'deployments', 'uploads', 'statistics'])
  })

  it('offers the utilities, with the repair and the sync inside them rather than in the menu', async () => {
    const { onChoose } = renderMenu()

    expect(screen.queryByRole('button', { name: /^🛠️/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^🔄/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reports/i })).not.toBeInTheDocument() // the reports are in the settings now

    await userEvent.click(screen.getByRole('button', { name: /utils/i }))
    expect(onChoose).toHaveBeenCalledWith('utils')
  })
})
