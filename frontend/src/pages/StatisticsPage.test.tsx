import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StatisticsPage from './StatisticsPage'
import { api } from '../api'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { StatisticsCheck, StatisticsMetrics, StatisticsRow } from '../types'

vi.mock('../api', () => ({ api: { getSettings: vi.fn(), listResearchProjects: vi.fn(), repairCollections: vi.fn(), statisticsRevision: vi.fn(), fieldDeployments: vi.fn() } }))
const mockedApi = vi.mocked(api, true)

const metrics = (images: number, over: Partial<StatisticsMetrics> = {}): StatisticsMetrics => ({
  image_count: images, sequence_count: images / 5, sequence_length: 5, days: 10, images_per_day: images / 10, sequence_median: 5, sequence_max: 5, first_image: 0, last_image: 864000,
  daily: [{ date: '2024-09-01', images: 3 }, { date: '2024-09-02', images: 0 }, { date: '2024-09-03', images: 12 }],
  sequences_daily: [{ date: '2024-09-01', sequences: 3 }, { date: '2024-09-02', sequences: 0 }, { date: '2024-09-03', sequences: 1 }],
  sequence_lengths: [[5, images / 5]],
  longest_sequence: { images: 5, start: '2024-09-01T08:00:00', end: '2024-09-01T08:00:40', seconds: 40 }, ...over,
})
const check = (over: Partial<StatisticsCheck> = {}): StatisticsCheck => ({ ok: true, skipped: false, value: 100, previous: 2, reference: 100, lower: 50, upper: 150, message: 'fine', ...over })
const row = (id: string, status: StatisticsRow['status'], images: number, over: Partial<StatisticsRow> = {}, extra: Partial<StatisticsMetrics> = {}): StatisticsRow => ({
  deployment_id: id, location: id.slice(6), revision: 3, metrics: metrics(images, extra), status,
  checks: { image_count: check(), sequence_count: check(), sequence_length: check() },
  revisions: [
    { revision: 1, deployment_id: `R0001-${id.slice(6)}`, metrics: metrics(100, { daily: undefined, longest_sequence: undefined }) },
    { revision: 2, deployment_id: `R0002-${id.slice(6)}`, metrics: metrics(120, { daily: undefined, longest_sequence: undefined }) },
    { revision: 3, deployment_id: id, metrics: metrics(images, { ...extra, daily: undefined, longest_sequence: undefined }) },
  ], ...over,
})

const BURST = { images: 400, start: '2024-09-03T09:00:00', end: '2024-09-03T09:30:00', seconds: 1800 }

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getSettings.mockResolvedValue({ GENERAL: { default_research_project: 'DONA' } } as never)
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }] })
  mockedApi.repairCollections.mockResolvedValue({ results: [
    { name: 'R0002', path: '/c/DONA/R0002', deployments: [] },
    { name: 'R0003', path: '/c/DONA/R0003', deployments: [{ deployment_id: 'R0003-DONA_01', images: 3, files: {}, synced: false }] },
  ] } as never)
  mockedApi.fieldDeployments.mockResolvedValue({ results: [{ deployment_id: 'R0003-DONA_02', collection: 'R0003', site: 'DONA_02', card: '6', timezone: 'Europe/Madrid' }] } as never)
  mockedApi.statisticsRevision.mockResolvedValue({ results: [
    row('R0003-DONA_01', 'ok', 110),
    row('R0003-DONA_02', 'review', 1000, { checks: { image_count: check({ ok: false, message: 'The number of images (1000) is not similar to the median.' }), sequence_count: check(), sequence_length: check() } },
        { sequence_count: 200, sequence_lengths: [[1, 100], [5, 99], [400, 1]], longest_sequence: BURST, sequence_max: 400 }),
    row('R0003-DONA_03', 'insufficient_history', 50, { revisions: [{ revision: 3, deployment_id: 'R0003-DONA_03', metrics: metrics(50, { daily: undefined, longest_sequence: undefined }) }] },
        { daily: [{ date: '2024-10-02', images: 7 }], sequences_daily: [{ date: '2024-10-02', sequences: 2 }] }),
  ] })
})

afterEach(() => { vi.restoreAllMocks() })

const open = async () => { render(<StatisticsPage onBack={() => {}} />); await screen.findByRole('table', { name: 'Statistics of the deployments, one row each' }) }
const card = (name: string) => screen.getByRole('group', { name })
const table = () => screen.getByRole('table', { name: 'Statistics of the deployments, one row each' })

describe('StatisticsPage', () => {
  it('opens on the latest revision of the default research project, with the figures of all its deployments', async () => {
    await open()

    expect(mockedApi.repairCollections).toHaveBeenCalledWith('DONA')
    expect(mockedApi.statisticsRevision).toHaveBeenCalledWith('DONA', 'R0003')   // the latest, not the first
    expect(screen.getByText('All the deployments (3)')).toBeInTheDocument()
    expect(card('Images')).toHaveTextContent('1,160')                // 110 + 1000 + 50
    expect(card('Sequences')).toHaveTextContent('232')               // 22 + 200 + 10
    expect(card('Length')).toHaveTextContent('10')                   // the mean of the days
    expect(card('Longest sequence card')).toHaveTextContent('400')                  // the longest of all, and when it lasted
    expect(card('Longest sequence card')).toHaveTextContent('30m 00s')
    expect(card('Longest sequence card')).toHaveTextContent('R0003-DONA_02 · SD 6')
  })

  it('says in the table how many previous revisions each deployment has', async () => {
    await open()
    expect(within(within(table()).getByText('R0003-DONA_01').closest('tr')!).getByText('2 previous')).toBeInTheDocument()   // R0001 and R0002 of its location
    expect(within(within(table()).getByText('R0003-DONA_03').closest('tr')!).getByText('0 previous')).toBeInTheDocument()   // the first revision of its location
  })

  it('counts the deployments by how they compare with the previous revisions, and a card filters the table by it', async () => {
    await open()
    const region = screen.getByRole('region', { name: 'Comparison with the previous revisions' })
    expect(within(region).getByRole('button', { name: 'To review' })).toHaveTextContent('1')
    expect(within(region).getByRole('button', { name: 'Similar' })).toHaveTextContent('1')
    expect(within(region).getByRole('button', { name: 'Not enough history' })).toHaveTextContent('1')

    await userEvent.click(within(region).getByRole('button', { name: 'To review' }))
    expect(within(table()).getByText('R0003-DONA_02')).toBeInTheDocument()
    expect(within(table()).queryByText('R0003-DONA_01')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 deployments')).toBeInTheDocument()
  })

  it('isolates a deployment: the figures are then of that one alone, and it can be put back', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Isolate R0003-DONA_02' }))

    expect(screen.getByText('Only R0003-DONA_02')).toBeInTheDocument()
    expect(card('Images')).toHaveTextContent('1,000')
    expect(card('Sequences')).toHaveTextContent('200')
    expect(within(table()).getByText('R0003-DONA_01')).toBeInTheDocument()          // the table keeps all of the revision

    await userEvent.click(screen.getByRole('button', { name: 'Show the whole revision' }))
    expect(card('Images')).toHaveTextContent('1,160')
    await userEvent.click(within(table()).getByRole('button', { name: 'Isolate R0003-DONA_01 in the figures' }))   // the name in the table isolates it too
    expect(card('Images')).toHaveTextContent('110')
  })

  it('draws how the images of a day and the images of a sequence are distributed, with the scale and the ranges to choose', async () => {
    await open()
    const perDay = screen.getByRole('group', { name: 'Distribution of the images per day' })
    expect(within(perDay).getAllByRole('img')).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: '10 ranges' }))
    expect(within(screen.getByRole('group', { name: 'Distribution of the images per day' })).getAllByRole('img')).toHaveLength(10)

    const sizes = screen.getByRole('group', { name: 'Distribution of the images per sequence' })
    expect(within(sizes).getByRole('img', { name: '1 image per sequence: 100 sequences' })).toBeInTheDocument()
    expect(within(sizes).getByRole('img', { name: '101+ images per sequence: 1 sequence' })).toBeInTheDocument()   // the long tail
    await userEvent.click(screen.getByRole('button', { name: 'Logarithmic' }))
    expect(screen.getByRole('button', { name: 'Logarithmic' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Mean' }))
    expect(screen.getByRole('button', { name: 'Mean' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('inspects the longest sequence: when it began and ended on the wall clock of its location, how long and how far apart', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Inspect the sequence' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Longest sequence' }))
    expect(dialog.getByText('400')).toBeInTheDocument()
    expect(dialog.getByText('30m 00s')).toBeInTheDocument()
    expect(dialog.getByText('4.5 s')).toBeInTheDocument()                           // 1800 s over 399 gaps
    expect(dialog.getByText('3 Sep 2024, 09:00 (Europe/Madrid)')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(within(table()).getByRole('button', { name: 'Longest sequence of R0003-DONA_01' }))   // a row's own
    expect(within(await screen.findByRole('dialog', { name: 'Longest sequence' })).getByText('R0003-DONA_01')).toBeInTheDocument()
  })

  it('opens the images of each day and the sequences from their numbers in the table', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Images per day of R0003-DONA_02' }))
    const chart = await screen.findByRole('group', { name: 'Images per day of R0003-DONA_02' })
    expect(within(chart).getByRole('img', { name: '1 Sep 2024: 3 images' })).toBeInTheDocument()
    expect(within(chart).getByRole('img', { name: '2 Sep 2024: 0 images' })).toBeInTheDocument()   // a day with none is there, empty
    await userEvent.hover(within(chart).getByRole('img', { name: '3 Sep 2024: 12 images' }))
    expect(screen.getByText('12 images')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Images per day of R0003-DONA_02, as a table' })).toHaveTextContent('3 Sep 2024')

    await userEvent.click(screen.getByRole('button', { name: 'Sequences of R0003-DONA_02' }))     // another tab replaces it
    expect(screen.queryByRole('group', { name: 'Images per day of R0003-DONA_02' })).not.toBeInTheDocument()
    const perDay = screen.getByRole('group', { name: 'Sequences per day of R0003-DONA_02' })
    expect(within(perDay).getByRole('img', { name: '1 Sep 2024: 3 sequences' })).toBeInTheDocument()
    const sizes = screen.getByRole('group', { name: 'Sequences by size of R0003-DONA_02' })
    expect(within(sizes).getByRole('img', { name: '101+ images per sequence: 1 sequence' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sequences of R0003-DONA_02' }))     // pressed again, it closes
    expect(screen.queryByRole('group', { name: 'Sequences per day of R0003-DONA_02' })).not.toBeInTheDocument()
  })

  it('has no comparison in the row — the arrow opens the days and the sequences — and the comparison tells why a deployment is to review and compares it with any revision of its location', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Show the statistics of R0003-DONA_02' }))
    expect(screen.queryByRole('checkbox', { name: /Compare/ })).not.toBeInTheDocument()            // nothing to tick in the row
    expect(await screen.findByRole('group', { name: 'Images per day of R0003-DONA_02' })).toBeInTheDocument()

    await userEvent.click(within(table()).getByRole('button', { name: 'Compare R0003-DONA_02 with the earlier ones' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Compare R0003-DONA_02' }))
    expect(dialog.getByLabelText('Why R0003-DONA_02 is to review')).toHaveTextContent('The number of images (1000) is not similar to the median.')

    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'A revision of DONA_02 to compare with' }), 'R0001')   // any revision of the location
    const images = within(dialog.getByRole('table', { name: 'Comparison of R0003-DONA_02 with R0001-DONA_02' })).getByText('Images').closest('tr')!
    expect(images).toHaveTextContent('1,000')
    expect(images).toHaveTextContent('100')
    expect(images).toHaveTextContent('+900%')
    expect(dialog.getByRole('button', { name: /Previous revision/ })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(dialog.getByRole('button', { name: 'R0002: 12. Compare with it' }))      // or pressing its bar of the evolution
    expect(dialog.getByRole('table', { name: 'Comparison of R0003-DONA_02 with R0002-DONA_02' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'R0002: 12. Compare with it' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.getByRole('button', { name: 'R0001: 10. Compare with it' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('searches the deployments by their SD card and saves them as a CSV', async () => {
    const create = vi.fn(() => 'blob:statistics'), revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await open()

    await userEvent.type(screen.getByRole('textbox', { name: 'Filter the deployments' }), '6')    // the SD card of DONA_02
    expect(within(table()).getByText('R0003-DONA_02')).toBeInTheDocument()
    expect(within(table()).queryByText('R0003-DONA_01')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    expect(create).toHaveBeenCalledTimes(1)
    const csv = await (create.mock.calls[0] as unknown as [Blob])[0].text()
    expect(csv.split('\n')).toHaveLength(4)                                                       // the head and every deployment of the revision, not only the ones searched
    expect(csv).toContain('R0003-DONA_02,3,1000,10,100,200,5,5,400,1800,2,review')
  })

  it('shows each day of a month in both diagrams, the images and the sequences, and goes to the month before and after', async () => {
    await open()
    await userEvent.click(within(screen.getByRole('group', { name: 'View of the images per day' })).getByRole('button', { name: 'By day' }))

    const september = await screen.findByRole('group', { name: 'Images each day of September 2024' })
    expect(within(september).getAllByRole('img')).toHaveLength(30)                                    // every day of the month
    expect(within(september).getByRole('img', { name: '1 Sep 2024: 6 images' })).toBeInTheDocument()   // 3 + 3 of the two deployments that have September
    expect(within(september).getByRole('img', { name: '3 Sep 2024: 24 images' })).toBeInTheDocument()
    expect(within(september).getByRole('img', { name: '2 Sep 2024: 0 images' })).toBeInTheDocument()   // a day with none is there
    expect(screen.getByRole('button', { name: 'Previous month of the images' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next month of the images' }))
    const october = await screen.findByRole('group', { name: 'Images each day of October 2024' })
    expect(within(october).getAllByRole('img')).toHaveLength(31)
    expect(within(october).getByRole('img', { name: '2 Oct 2024: 7 images' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month of the images' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous month of the images' }))
    expect(await screen.findByRole('group', { name: 'Images each day of September 2024' })).toBeInTheDocument()

    // the sequences have their own: the same views, and a month of their own
    await userEvent.click(within(screen.getByRole('group', { name: 'View of the sequences' })).getByRole('button', { name: 'By day' }))
    const sequences = await screen.findByRole('group', { name: 'Sequences each day of September 2024' })
    expect(within(sequences).getByRole('img', { name: '1 Sep 2024: 6 sequences' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next month of the sequences' }))
    expect(within(await screen.findByRole('group', { name: 'Sequences each day of October 2024' })).getByRole('img', { name: '2 Oct 2024: 2 sequences' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Images each day of September 2024' })).toBeInTheDocument()   // the other did not move

    await userEvent.click(within(screen.getByRole('group', { name: 'View of the images per day' })).getByRole('button', { name: 'Distribution' }))   // and back to the distribution
    expect(screen.getByRole('group', { name: 'Distribution of the images per day' })).toBeInTheDocument()
  })

  it('compares a deployment with its previous revisions: the six metrics, how the location evolved and the bursts', async () => {
    await open()
    expect(within(table()).getByRole('button', { name: 'Compare R0003-DONA_02 with the earlier ones' })).toHaveTextContent('Unusual peak')   // 100 an hour against 12
    await userEvent.click(within(table()).getByRole('button', { name: 'Compare R0003-DONA_02 with the earlier ones' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Compare R0003-DONA_02' }))
    expect(dialog.getByText('Unusual peak', { exact: false })).toBeInTheDocument()
    const perDay = within(dialog.getByRole('table', { name: 'Comparison of R0003-DONA_02 with R0002-DONA_02' })).getByText('Images per day').closest('tr')!
    expect(perDay).toHaveTextContent('100')                                                          // now
    expect(perDay).toHaveTextContent('12')                                                           // the revision before
    expect(perDay).toHaveTextContent('+733.3%')
    expect(dialog.getByRole('button', { name: /Previous revision/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(dialog.getByRole('button', { name: /Mean of the previous revisions/ }))   // against all the earlier ones: (10 + 12) / 2
    const history = within(dialog.getByRole('table', { name: 'Comparison of R0003-DONA_02 with Mean of the previous revisions' })).getByText('Images per day').closest('tr')!
    expect(history).toHaveTextContent('11')
    expect(history).toHaveTextContent('+809.1%')

    const evolution = dialog.getByRole('group', { name: 'Images per day of DONA_02, by revision' })
    expect(within(evolution).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['R0001: 10. Compare with it', 'R0002: 12. Compare with it'])   // the earlier ones can be pressed
    expect(within(evolution).getByRole('img', { name: 'R0003: 100' })).toBeInTheDocument()                                                                        // this one is the deployment
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Metric of the evolution' }), 'Images')
    const images = dialog.getByRole('group', { name: 'Images of DONA_02, by revision' })
    expect(within(images).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['R0001: 100. Compare with it', 'R0002: 120. Compare with it'])
    expect(within(images).getByRole('img', { name: 'R0003: 1,000' })).toBeInTheDocument()

    const bursts = dialog.getByRole('group', { name: 'Profile of the bursts' })
    expect(within(bursts).getByRole('img', { name: '1 images: 50% now, 0% in the reference' })).toBeInTheDocument()
    expect(within(bursts).getByRole('img', { name: '4–10 images: 49.5% now, 100% in the reference' })).toBeInTheDocument()

    await userEvent.click(dialog.getByRole('button', { name: 'Next deployment' }))                // the deployment after it
    expect(await screen.findByRole('dialog', { name: 'Compare R0003-DONA_03' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rest of the revision/ })).toHaveAttribute('aria-pressed', 'true')   // the first revision of a location has none before it
    expect(screen.queryByRole('button', { name: /Previous revision/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next deployment' })).toBeDisabled()                // the last one
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on the revision and the deployment it is sent to, with the deployment isolated in the figures', async () => {
    mockedApi.statisticsRevision.mockImplementation(async (_rp, collection) => ({ results: [row(`${collection}-DONA_01`, 'ok', 110), row(`${collection}-DONA_02`, 'review', 1000)] }))
    render(<StatisticsPage onBack={() => {}} focus={{ collection: 'R0002', deploymentId: 'R0002-DONA_02' }} />)

    expect(await screen.findByText('Only R0002-DONA_02')).toBeInTheDocument()
    expect(mockedApi.statisticsRevision).toHaveBeenCalledWith('DONA', 'R0002')
    expect(mockedApi.statisticsRevision).not.toHaveBeenCalledWith('DONA', 'R0003')     // not the latest: the one it was sent to
    expect(card('Images')).toHaveTextContent('1,000')
  })

  it('prints the report: every row of the table and not only a page, on white paper, and gives the dark theme back after', async () => {
    const print = vi.fn()
    Object.assign(window, { print })
    document.documentElement.classList.add('dark')
    mockedApi.statisticsRevision.mockResolvedValue({ results: Array.from({ length: 10 }, (_, i) => row(`R0003-DONA_${String(i + 1).padStart(2, '0')}`, 'ok', 100 + i)) })
    await open()
    expect(screen.queryByRole('button', { name: 'Isolate R0003-DONA_10 in the figures' })).not.toBeInTheDocument()     // the table has pages: 8 of the 10

    await userEvent.click(screen.getByRole('button', { name: /Print the report/ }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('dark')).toBe(false)                         // white paper while it prints
    expect(screen.getByRole('button', { name: 'Isolate R0003-DONA_10 in the figures' })).toBeInTheDocument()   // all of them are on it
    expect(screen.getByRole('button', { name: /Print the report/ })).toBeDisabled()

    window.dispatchEvent(new Event('afterprint'))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Isolate R0003-DONA_10 in the figures' })).not.toBeInTheDocument()   // back to its pages
    expect(screen.getByRole('button', { name: /Print the report/ })).toBeEnabled()
  })

  it('picks the revision among squares, the latest first, and has a help panel', async () => {
    await open()
    const squares = within(screen.getByRole('group', { name: 'Revision' })).getAllByRole('button')
    expect(squares.map((b) => b.textContent)).toEqual(['R00031 deployment', 'R00020 deployments'])
    expect(squares[0]).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(squares[1])
    expect(mockedApi.statisticsRevision).toHaveBeenLastCalledWith('DONA', 'R0002')

    await userEvent.click(screen.getByRole('button', { name: /Help & Legend/ }))
    expect(await screen.findByRole('dialog', { name: /legend and help/i })).toHaveTextContent('Not enough history')
    await userEvent.click(screen.getByRole('button', { name: 'Got it, close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says so when the research project has no revisions, and goes back', async () => {
    mockedApi.repairCollections.mockResolvedValue({ results: [] })
    const onBack = vi.fn()
    render(<StatisticsPage onBack={onBack} />)

    expect(await screen.findByText('No revisions yet.')).toBeInTheDocument()
    expect(mockedApi.statisticsRevision).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: /back/i })[0])
    await waitFor(() => expect(onBack).toHaveBeenCalled())
  })

  it('shows the error when the statistics cannot be read', async () => {
    mockedApi.statisticsRevision.mockRejectedValue(new Error('The collection is not there.'))
    render(<StatisticsPage onBack={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('The collection is not there.')
  })
})
