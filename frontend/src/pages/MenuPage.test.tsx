import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MenuPage from './MenuPage'

describe('MenuPage', () => {
  it('offers the steps of the workflow, numbered, in the order they are done', () => {
    render(<MenuPage onChoose={vi.fn()} />)

    const steps = screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
    expect(steps).toEqual(['Field records', 'Copy SD cards', 'Process collection', 'Upload to Trapper'])
    // Fixing dates and times is reached from Copy SD cards, or from the utilities: not a step of its own.
    expect(screen.queryByRole('button', { name: /^.*Check and fix dates and times$/ })).not.toBeInTheDocument()
  })

  it('opens each step, and a single deployment beside the collection', async () => {
    const onChoose = vi.fn()
    render(<MenuPage onChoose={onChoose} />)

    for (const [name, task] of [[/Field records/, 'fieldlog'], [/Copy SD cards/, 'cards'], [/^Process collection/, 'session'], [/Upload to Trapper/, 'upload'], [/Process deployment/, 'deployment']] as const) {
      await userEvent.click(screen.getByRole('button', { name }))
      expect(onChoose).toHaveBeenLastCalledWith(task)
    }
  })

  it('offers the utilities apart', async () => {
    const onChoose = vi.fn()
    render(<MenuPage onChoose={onChoose} />)

    await userEvent.click(screen.getByRole('button', { name: /utils/i }))
    expect(onChoose).toHaveBeenCalledWith('utils')
  })
})
