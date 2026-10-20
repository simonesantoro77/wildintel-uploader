import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CardsPage, { size } from './CardsPage'
import { api } from '../api'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { CardDeployment, CardInspection, CardsStatus } from '../types'

vi.mock('../api', () => ({
  api: {
    listResearchProjects: vi.fn(), ingestCollections: vi.fn(), ingestPrepare: vi.fn(), ingestStatus: vi.fn(), ingestInspect: vi.fn(),
    ingestCopy: vi.fn(), ingestScanTree: vi.fn(), browseFolder: vi.fn(),
  },
}))
const mockedApi = vi.mocked(api, true)

const dep = (id: string, over: Partial<CardDeployment> = {}): CardDeployment => ({
  deployment_id: id, site: id.slice(6), state: 'to_copy', start: '2026-06-01T08:17:00Z', end: '2026-09-30T14:53:00Z', card: '7B', camera_id: '47',
  photos_counted: 3, copy: null, ...over,
})
const STATUS: CardsStatus = {
  collection: 'R0042', cards_dir: '/data/cards/DONA/R0042', has_fieldwork_log: true,
  deployments: [dep('R0042-DONA_0007_B'), dep('R0042-DONA_0072', { state: 'out', card: '72b' })], unexpected: [], counts: { out: 1, to_copy: 1, copied: 0 },
}
const SEEN: CardInspection = {
  source: '/media/SD', file_count: 3, image_count: 3, video_count: 0, other_count: 0, total_bytes: 3_000_000, subfolders: 1,
  first: '2026-06-02T11:00:00', last: '2026-09-29T18:00:00', undated: 0, camera_models: ['Browning BTC-8E'], fingerprint: 'x', already_copied: [],
  candidates: [{ ...dep('R0042-DONA_0007_B'), score: 160, fits: ['Card 7B, as noted in the field.'], problems: [] }], collection: 'R0042',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.listResearchProjects.mockResolvedValue({ results: [{ ...EMPTY_RESEARCH_PROJECT, name: 'Doñana', acronym: 'DONA', trapper_pk: 2 }] })
  mockedApi.ingestCollections.mockResolvedValue({ results: ['R0042'] })
  mockedApi.ingestPrepare.mockResolvedValue(STATUS)
  mockedApi.ingestInspect.mockResolvedValue(SEEN)
  mockedApi.ingestStatus.mockResolvedValue({ ...STATUS, deployments: [dep('R0042-DONA_0007_B', { state: 'copied' }), STATUS.deployments[1]], counts: { out: 1, to_copy: 0, copied: 1 } })
  mockedApi.ingestCopy.mockImplementation(async (_p, _c, _s, _l, _d, onEvent) => {
    onEvent({ type: 'copy', index: 1, total: 3, name: 'IMG_0001.JPG' })
    onEvent({ type: 'done', record: { card_label: '7B', copied_at: '2026-10-20T18:00:00Z', copied_by: 'me', file_count: 3, total_bytes: 3, source: '/media/SD', first: null, last: null, deployment_id: 'R0042-DONA_0007_B', path: '/x' } })
  })
})

async function chooseProject() {
  render(<CardsPage />)
  await userEvent.click(await screen.findByLabelText('Research project'))
  await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
  await screen.findByText('Cards of R0042')
}

async function lookAtCard() {
  await chooseProject()
  await userEvent.type(screen.getByLabelText('The card'), '/media/SD')
  await userEvent.type(screen.getByLabelText('Label on the card'), '7B')
  await userEvent.click(screen.getByRole('button', { name: 'Look at the card' }))
}

describe('CardsPage', () => {
  it('prepares the newest collection with field records and lists its cards', async () => {
    await chooseProject()

    expect(mockedApi.ingestPrepare).toHaveBeenCalledWith('DONA', 'R0042')
    expect(screen.getByText('Card to copy')).toBeInTheDocument()
    expect(screen.getByText('Camera still out')).toBeInTheDocument()
  })

  it('proposes the deployment of the card and copies it there', async () => {
    await lookAtCard()

    expect(mockedApi.ingestInspect).toHaveBeenCalledWith('DONA', 'R0042', '/media/SD', '7B')
    expect(await screen.findByText('✓ Card 7B, as noted in the field.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy into R0042-DONA_0007_B' }))

    expect(mockedApi.ingestCopy).toHaveBeenCalledWith('DONA', 'R0042', '/media/SD', '7B', 'R0042-DONA_0007_B', expect.any(Function))
    expect(await screen.findByText(/Card copied into R0042-DONA_0007_B/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('✔ Copied')).toBeInTheDocument())
  })

  it('does not offer to copy a card that was copied already', async () => {
    mockedApi.ingestInspect.mockResolvedValue({ ...SEEN, already_copied: [{ deployment_id: 'R0042-DONA_0007_B', collection: 'R0042', copied_at: '2026-10-20', card_label: '7B' }] })
    await lookAtCard()

    expect(await screen.findByRole('alert')).toHaveTextContent('This card was copied already')
    expect(screen.queryByRole('button', { name: /Copy into/ })).not.toBeInTheDocument()
  })

  it('copies folders from elsewhere with the deployment given to each', async () => {
    mockedApi.ingestScanTree.mockResolvedValue({ root: '/old', folders: [
      { path: '/old/a', relative: 'TATR_0001/R0002', image_count: 4, file_count: 4, collection: 'R0002', site: 'TATR_0001', deployment_id: 'R0002-TATR_0001' },
      { path: '/old/misc', relative: 'misc', image_count: 2, file_count: 2, collection: null, site: null, deployment_id: null },
    ] })
    render(<CardsPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Folders from elsewhere' }))
    await userEvent.click(await screen.findByLabelText('Research project'))
    await userEvent.click(await screen.findByRole('option', { name: 'DONA — Doñana' }))
    await userEvent.type(screen.getByLabelText('Folder'), '/old')
    await userEvent.click(screen.getByRole('button', { name: 'Find the folders with images' }))
    await userEvent.type(await screen.findByLabelText('Collection of misc'), 'R0002')
    await userEvent.type(screen.getByLabelText('Site of misc'), 'TATR_0009')
    await userEvent.click(screen.getByLabelText('Copy misc'))
    await userEvent.click(screen.getByRole('button', { name: 'Copy 2 folder(s)' }))

    await waitFor(() => expect(mockedApi.ingestCopy).toHaveBeenCalledTimes(2))
    expect(mockedApi.ingestCopy).toHaveBeenLastCalledWith('DONA', 'R0002', '/old/misc', '', 'R0002-TATR_0009', expect.any(Function), true)
  })
})

describe('size', () => {
  it('says a size in kB, MB or GB', () => {
    expect(size(3_000_000)).toBe('3.0 MB')
    expect(size(2_500_000_000)).toBe('2.5 GB')
    expect(size(10)).toBe('1 kB')
  })
})
