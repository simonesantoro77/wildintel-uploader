import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckFailures, { pageNumbers } from './CheckFailures'
import type { Report, ReportEntry } from '../types'

vi.mock('../api', () => ({
  api: { reportImageUrl: (id: string, path: string, size = 'thumb') => `/api/reports/${id}/image?path=${path}&size=${size}` },
}))

const failure = (n: number, over: Partial<ReportEntry> = {}): ReportEntry => ({
  identifier: `IMG_${String(n).padStart(4, '0')}.JPG`, check: 'exif', status: 'failed', message: 'no date', tag: 'No date', taken: `2024-09-${String(n % 28 + 1).padStart(2, '0')}T10:00:00`, ...over,
})

const report = (entries: ReportEntry[], scope: 'images' | 'deployment' = 'images'): Report => ({
  id: 'r1', kind: 'validation', title: 'Validation of X', created_at: '2026-10-06T09:00:00+00:00', source_dir: '/x', deployment_id: null, checked: 100, parameters: {},
  checks: { exif: { label: 'Required EXIF fields', scope, ok: 100 - entries.length, failed: entries.length } },
  totals: { entries: 100, ok: 100 - entries.length, failed: entries.length, images_with_issues: entries.length }, entries,
})

describe('CheckFailures', () => {
  it('shows how many images failed, each with its picture, what is wrong with it and when it was taken', () => {
    render(<CheckFailures report={report([failure(1), failure(2, { tag: 'No camera model', message: 'no camera model' })])} check="exif" onBack={vi.fn()} />)

    expect(screen.getByText('2 failures')).toBeInTheDocument()
    expect(screen.getByAltText('IMG_0001.JPG')).toHaveAttribute('src', '/api/reports/r1/image?path=IMG_0001.JPG&size=thumb')
    expect(screen.getAllByText('No camera model').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2024-09-02 10:00:00').length).toBeGreaterThan(0)
  })

  it('goes back to the tests by its breadcrumb', async () => {
    const onBack = vi.fn()
    render(<CheckFailures report={report([failure(1)])} check="exif" onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: '← Validation' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('searches by file name, filters by the error and sorts', async () => {
    const entries = [failure(1), failure(2, { tag: 'No camera model' }), failure(10), failure(3, { taken: '2020-01-01T00:00:00' })]
    render(<CheckFailures report={report(entries)} check="exif" onBack={vi.fn()} />)
    const names = () => screen.getAllByText(/^IMG_\d{4}\.JPG$/).map((e) => e.textContent)

    expect(names()).toEqual(['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0010.JPG'])  // by name, numbers in order
    await userEvent.type(screen.getByLabelText('Search by filename'), '0010')
    expect(names()).toEqual(['IMG_0010.JPG'])
    await userEvent.clear(screen.getByLabelText('Search by filename'))

    await userEvent.selectOptions(screen.getByLabelText('Filter by error'), 'No camera model')
    expect(names()).toEqual(['IMG_0002.JPG'])
    await userEvent.selectOptions(screen.getByLabelText('Filter by error'), '')

    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Oldest first')
    expect(names()[0]).toBe('IMG_0003.JPG')
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'Name Z–A')
    expect(names()[0]).toBe('IMG_0010.JPG')
  })

  it('says so when nothing matches the search', async () => {
    render(<CheckFailures report={report([failure(1)])} check="exif" onBack={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Search by filename'), 'zzz')
    expect(screen.getByText('No image matches.')).toBeInTheDocument()
  })

  it('pages the failures — 8 pictures at a time', async () => {
    render(<CheckFailures report={report(Array.from({ length: 20 }, (_, i) => failure(i + 1)))} check="exif" onBack={vi.fn()} />)

    expect(screen.getAllByText(/^IMG_\d{4}\.JPG$/)).toHaveLength(8)
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(screen.getAllByText(/^IMG_\d{4}\.JPG$/).map((e) => e.textContent)).toEqual(['IMG_0017.JPG', 'IMG_0018.JPG', 'IMG_0019.JPG', 'IMG_0020.JPG'])
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  })

  it('can be seen as a list', async () => {
    render(<CheckFailures report={report([failure(1)])} check="exif" onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(screen.queryByAltText('IMG_0001.JPG')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('IMG_0001.JPG')
    expect(screen.getByRole('table')).toHaveTextContent('no date')
  })

  it('opens everything the report says of an image, with a bigger picture, and closes it', async () => {
    const entries = [failure(1), { identifier: 'IMG_0001.JPG', check: 'corrupted', status: 'ok' as const, message: 'can be read' }]
    const r = report(entries)
    r.checks.corrupted = { label: 'Corrupted images', scope: 'images', ok: 1, failed: 0 }
    render(<CheckFailures report={r} check="exif" onBack={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'View details of IMG_0001.JPG' }))

    const dialog = screen.getByRole('dialog', { name: 'Details of IMG_0001.JPG' })
    expect(within(dialog).getByAltText('IMG_0001.JPG')).toHaveAttribute('src', expect.stringContaining('size=large'))
    expect(dialog).toHaveTextContent('Required EXIF fields — no date')
    expect(dialog).toHaveTextContent('Corrupted images — can be read')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists the problems of a check of the whole folder as messages, with no pictures', () => {
    const entry: ReportEntry = { identifier: '(deployment)', check: 'exif', status: 'failed', message: 'images in subfolders: backup' }
    render(<CheckFailures report={report([entry], 'deployment')} check="exif" onBack={vi.fn()} />)

    expect(screen.getByText(/images in subfolders: backup/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Search by filename')).not.toBeInTheDocument()
  })
})

describe('pageNumbers', () => {
  it('shows the first pages, the neighbours of the current one and the last, with gaps', () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3])
    expect(pageNumbers(1, 16)).toEqual([1, 2, null, 16])
    expect(pageNumbers(8, 16)).toEqual([1, 2, null, 7, 8, 9, null, 16])
    expect(pageNumbers(16, 16)).toEqual([1, 2, null, 15, 16])
  })
})
