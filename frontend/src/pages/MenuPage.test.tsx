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

  it('has its title at 22 px, semibold, with what it says under it and a subtle line after', () => {
    renderMenu()
    const title = screen.getByRole('heading', { name: 'What do you want to do?' })
    expect(title).toHaveClass('text-[22px]', 'font-semibold')
    expect(title.nextElementSibling).toHaveTextContent('Choose one of the following.')
    expect(title.closest('header')).toHaveClass('border-b')                                        // the line under the heading
  })

  it('has the three actions in three columns, and the dashboards under them as a bar of their own, as the utilities are', async () => {
    renderMenu()
    const actions = screen.getByRole('button', { name: /^Register visits/ }).parentElement!
    expect(actions).toHaveClass('md:grid-cols-3')                                                  // the three in a row
    expect([...actions.children].map((c) => c.querySelector('strong')?.textContent)).toEqual(['Register visits', 'Create deployments', 'Upload deployment'])

    const bar = screen.getByRole('region', { name: 'Dashboards and statistics' })
    expect(actions.contains(bar)).toBe(false)                                                      // not one of the cards: under them, full width
    expect(actions.nextElementSibling).toBe(bar)
    expect(bar).toHaveClass('w-full')
    expect(within(bar).getByText('Open dashboards')).toBeInTheDocument()                           // with its button at the right, as Open utilities
    expect(screen.getByRole('button', { name: /Open utilities/ })).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: /Dashboards and statistics/ }))
    expect(within(bar).getByText('Hide dashboards')).toBeInTheDocument()
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
