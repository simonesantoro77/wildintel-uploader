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

    await userEvent.click(screen.getByRole('button', { name: /register the visits/i }))
    await userEvent.click(screen.getByRole('button', { name: /import the images/i }))
    await userEvent.click(screen.getByRole('button', { name: /upload the images/i }))
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['register', 'import', 'upload'])
  })

  it('offers the actions in that order, and no longer the three Manage menus', () => {
    renderMenu()

    const titles = screen.getAllByRole('button').map((b) => b.textContent ?? '').map((t) => t.match(/Register the visits|Import the images|Upload the images/)?.[0]).filter(Boolean)
    expect(titles).toEqual(['Register the visits', 'Import the images', 'Upload the images'])
    for (const old of [/manage visits/i, /manage deployments/i, /manage uploads/i]) expect(screen.queryByRole('button', { name: old })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import collection/i })).not.toBeInTheDocument()
  })

  it('numbers the three actions in the order of the work, 1 to 3, in a tab behind their icon — and has no bar of the typical workflow', () => {
    renderMenu()

    expect(screen.queryByRole('navigation', { name: 'Typical workflow' })).not.toBeInTheDocument()
    expect(screen.queryByText('Typical workflow')).not.toBeInTheDocument()
    const cards = ['Register the visits', 'Import the images', 'Upload the images'].map((name) => screen.getByRole('button', { name: new RegExp(`^${name}`) }))
    expect(cards.map((c) => c.querySelector('[aria-hidden="true"]')?.textContent)).toEqual(['1', '2', '3'])
    expect(screen.getByText(/Who went, when, to which site and what was done\./)).toBeInTheDocument()   // the visits are not said to be by hand or from a file
    expect(screen.queryByText(/by hand or from a file/i)).not.toBeInTheDocument()
  })

  it('has a Glossary button beside the Quick guide that opens a panel with what each word means — and shuts with its cross or Escape', async () => {
    renderMenu()
    const header = screen.getByRole('heading', { name: 'What do you want to do?' }).closest('header')!
    const button = within(header).getByRole('button', { name: 'Glossary' })
    expect(header.lastElementChild).toContainElement(button)
    expect(header.lastElementChild).toContainElement(within(header).getByRole('button', { name: 'Quick guide' }))
    expect(screen.queryByRole('dialog', { name: 'Glossary' })).not.toBeInTheDocument()

    await userEvent.click(button)
    const panel = within(screen.getByRole('dialog', { name: 'Glossary' }))
    const words = within(panel.getByRole('region', { name: 'Words' })).getAllByRole('term').map((t) => t.textContent)
    expect(words).toEqual([...words].sort())   // in alphabetical order
    expect(words).toEqual(expect.arrayContaining(['Collection', 'Deployment', 'Location', 'Revision', 'Visit']))
    expect(panel.getByText(/from the visit that put the card in to the visit that collected it/)).toBeInTheDocument()

    await userEvent.click(panel.getByRole('button', { name: 'Close the glossary panel' }))
    expect(screen.queryByRole('dialog', { name: 'Glossary' })).not.toBeInTheDocument()
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Glossary' })).not.toBeInTheDocument()
  })

  it('has a Quick guide button at the right of the title that opens a panel with the work from end to end — and shuts with its cross or Escape', async () => {
    renderMenu()
    const header = screen.getByRole('heading', { name: 'What do you want to do?' }).closest('header')!
    const button = within(header).getByRole('button', { name: 'Quick guide' })                    // in the header of the title, at the right
    expect(header.lastElementChild).toContainElement(button)
    expect(screen.queryByRole('dialog', { name: 'Quick guide' })).not.toBeInTheDocument()

    await userEvent.click(button)
    const panel = within(screen.getByRole('dialog', { name: 'Quick guide' }))
    expect(panel.getByText('End-to-end workflow')).toBeInTheDocument()
    expect(panel.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Create a research project', 'Register the visits', 'Import the images', 'Upload the images'])
    expect(panel.getByText('Define trappers, sites, cameras and SD cards once, or switch anytime from the top bar.')).toBeInTheDocument()
    expect(panel.getByText('Send curated local deployments to your remote repository (e.g., TRAPPER).')).toBeInTheDocument()
    expect(panel.getByText('Dashboards')).toBeInTheDocument()
    expect(panel.getByText('Utils')).toBeInTheDocument()

    await userEvent.click(panel.getByRole('button', { name: 'Close the quick guide' }))
    expect(screen.queryByRole('dialog', { name: 'Quick guide' })).not.toBeInTheDocument()
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Quick guide' })).not.toBeInTheDocument()
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
    const actions = screen.getByRole('button', { name: /^Register the visits/ }).parentElement!
    expect(actions).toHaveClass('md:grid-cols-3')                                                  // the three in a row
    expect([...actions.children].map((c) => c.querySelector('strong')?.textContent)).toEqual(['Register the visits', 'Import the images', 'Upload the images'])

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
