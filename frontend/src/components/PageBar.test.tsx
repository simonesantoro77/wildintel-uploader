import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardBar, PAGE_CLASS, PageTitle } from './PageBar'
import { TrailProvider } from './Trail'

describe('PageTitle', () => {
  it('is the title of every page: 22 px semibold, what it says under it, its buttons at the right and a subtle line under all', () => {
    render(<PageTitle title="Visit dashboard" description="How far the visits are" actions={<button type="button">Register visits</button>} />)

    const title = screen.getByRole('heading', { name: 'Visit dashboard' })
    expect(title).toHaveClass('text-[22px]', 'font-semibold')
    expect(title.nextElementSibling).toHaveTextContent('How far the visits are')
    const header = title.closest('header')!
    expect(header).toHaveClass('border-b', 'pb-4', 'mb-6')
    expect(header).toContainElement(screen.getByRole('button', { name: 'Register visits' }))
  })

  it('is the one the pages with a header use: the same classes, so that the titles are laid out alike', () => {
    render(<TrailProvider><DashboardBar title="Utilities" parent="Menu" description="Maintenance" /></TrailProvider>)

    const title = screen.getByRole('heading', { name: 'Utilities' })
    expect(title).toHaveClass('text-[22px]', 'font-semibold')
    expect(title.closest('header')).toHaveClass('border-b', 'pb-4', 'mb-6')
  })

  it('has one space for the pages around it: the same distance from the header of the application', () => {
    expect(PAGE_CLASS).toBe('mx-auto max-w-[1100px] px-4 py-8')
  })
})
